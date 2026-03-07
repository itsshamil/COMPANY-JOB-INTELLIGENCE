/**
 * ═══════════════════════════════════════════════════════════════════
 * JobBoardService.js
 * Real working scrapers for LinkedIn, Indeed, Naukri, Glassdoor,
 * Wellfound, Internshala, Foundit (Monster), TimesJobs, Shine
 *
 * Each board uses its own real internal/public API — no paid keys,
 * no Jina search (which gets blocked by these sites).
 * ═══════════════════════════════════════════════════════════════════
 */

class JobBoardService {

  // ─── Shared fetch with timeout + error handling ───────────────
  static async _fetch(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json, text/html, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          // Mimic a real browser to reduce bot detection
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(options.headers || {})
        }
      });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  // ─── Shared XML parser (for RSS feeds) ───────────────────────
  static _parseRSS(xmlText) {
    const jobs = [];
    const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
    let item;
    while ((item = itemPattern.exec(xmlText)) !== null) {
      const block = item[1];
      const get = (tag) => {
        const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i').exec(block);
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      jobs.push({
        title: get('title'),
        url: get('link') || get('guid'),
        location: get('location') || '',
        description: get('description').replace(/<[^>]+>/g, '').substring(0, 200),
      });
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. LINKEDIN — Guest Jobs API (no auth, public endpoint)
  // ═══════════════════════════════════════════════════════════════
  static async fetchLinkedIn(companyName, locationHint = '') {
    const jobs = [];
    try {
      // LinkedIn exposes a public guest API for job search
      // It requires a referer header to work correctly
      const keyword = encodeURIComponent(`${companyName}`);
      const location = encodeURIComponent(locationHint || '');

      // Step 1: Search for the company's LinkedIn ID via their company search
      const searchUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keyword}&location=${location}&start=0&count=25`;

      const res = await this._fetch(searchUrl, {
        headers: {
          'Referer': 'https://www.linkedin.com/jobs/search/',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/html, */*',
        }
      });

      if (!res.ok) {
        console.warn(`[LinkedIn] Response ${res.status}`);
        // Try alternate URL format
        return await this._fetchLinkedInAlternate(companyName);
      }

      const html = await res.text();
      // Parse job cards from LinkedIn's HTML response
      const cardPattern = /<li[^>]*>\s*<div[^>]*base-card[^>]*>[\s\S]*?<\/div>\s*<\/li>/gi;
      const titlePattern = /<h3[^>]*base-search-card__title[^>]*>\s*([\s\S]*?)\s*<\/h3>/i;
      const companyPattern = /<h4[^>]*base-search-card__subtitle[^>]*>\s*([\s\S]*?)\s*<\/h4>/i;
      const locationPattern = /<span[^>]*job-search-card__location[^>]*>\s*([\s\S]*?)\s*<\/span>/i;
      const urlPattern = /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"?]+)/i;
      const metaPattern = /<time[^>]*datetime="([^"]+)"/i;

      let card;
      while ((card = cardPattern.exec(html)) !== null) {
        const block = card[0];
        const title = (titlePattern.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
        const company = (companyPattern.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
        const location = (locationPattern.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
        const url = urlPattern.exec(block)?.[1] || '';
        const postedDate = metaPattern.exec(block)?.[1] || '';

        if (title && title.length > 3) {
          jobs.push({
            title,
            company,
            department: JobService._guessDepartment(title),
            location,
            type: 'Full-time',
            url,
            postedDate,
            source: 'linkedin'
          });
        }
      }

      // If HTML parsing yielded nothing, try JSON embed
      if (jobs.length === 0) {
        const jsonPattern = /window\.jobListings\s*=\s*(\{[\s\S]*?\});/;
        const jsonMatch = jsonPattern.exec(html);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            const listings = data?.jobs || data?.elements || [];
            listings.forEach(j => {
              if (j.title) {
                jobs.push({
                  title: j.title,
                  company: j.companyName || companyName,
                  department: JobService._guessDepartment(j.title),
                  location: j.formattedLocation || '',
                  type: 'Full-time',
                  url: j.jobPostingUrl || '',
                  source: 'linkedin-json'
                });
              }
            });
          } catch (_) { }
        }
      }

      console.log(`[LinkedIn] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[LinkedIn] Fetch failed:', e.message);
    }
    return jobs;
  }

  static async _fetchLinkedInAlternate(companyName) {
    // Alternate: scrape LinkedIn public company jobs page
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = `https://www.linkedin.com/company/${slug}/jobs/`;
    try {
      const res = await this._fetch(url, {
        headers: { 'Referer': 'https://www.linkedin.com/' }
      });
      if (!res.ok) return [];
      const html = await res.text();

      const jobs = [];
      // Extract from JSON-LD on the page
      const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = jsonLdPattern.exec(html)) !== null) {
        try {
          const data = JSON.parse(m[1]);
          const items = Array.isArray(data) ? data : [data];
          items.forEach(item => {
            if (item['@type'] === 'JobPosting') {
              jobs.push({
                title: item.title || '',
                department: JobService._guessDepartment(item.title || ''),
                location: item.jobLocation?.address?.addressLocality || '',
                type: 'Full-time',
                url: item.url || url,
                source: 'linkedin-jsonld'
              });
            }
          });
        } catch (_) { }
      }
      return jobs;
    } catch (e) {
      console.warn('[LinkedIn Alternate] Failed:', e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. INDEED — RSS Feed (public, no auth needed)
  // ═══════════════════════════════════════════════════════════════
  static async fetchIndeed(companyName, locationHint = 'India') {
    const jobs = [];
    try {
      // Indeed RSS is publicly accessible
      const q = encodeURIComponent(`"${companyName}"`);
      const l = encodeURIComponent(locationHint);

      // Try multiple Indeed regional domains
      const feeds = [
        `https://www.indeed.com/rss?q=${q}&l=${l}&sort=date&limit=25`,
        `https://in.indeed.com/rss?q=${q}&l=${l}&sort=date&limit=25`,
        `https://www.indeed.com/rss?q=${q}&sort=date&limit=25`,
      ];

      for (const feedUrl of feeds) {
        try {
          const res = await this._fetch(feedUrl, {
            headers: {
              'Accept': 'application/rss+xml, text/xml, */*',
              'Referer': 'https://www.indeed.com/'
            }
          });

          if (!res.ok) continue;
          const xml = await res.text();
          if (!xml.includes('<item>')) continue;

          const parsed = this._parseRSS(xml);
          parsed.forEach(item => {
            if (!item.title || item.title.length < 3) return;

            // Filter to company-relevant jobs
            const titleOrDesc = (item.title + ' ' + item.description).toLowerCase();
            if (!titleOrDesc.includes(companyName.toLowerCase().split(' ')[0])) {
              // Be lenient — include if it's a plausible job title
              if (!JobService._isJobTitle(item.title)) return;
            }

            jobs.push({
              title: JobService._cleanTitle(item.title),
              department: JobService._guessDepartment(item.title),
              location: item.location || locationHint,
              type: 'Full-time',
              url: item.url,
              source: 'indeed-rss'
            });
          });

          if (jobs.length > 0) break; // Stop at first working feed
        } catch (e) {
          console.warn(`[Indeed RSS] ${feedUrl} failed:`, e.message);
        }
      }

      // Fallback: Indeed's internal search API (used by their own frontend)
      if (jobs.length === 0) {
        const apiUrl = `https://www.indeed.com/jobs?q=${q}&l=${l}&format=json`;
        try {
          const res = await this._fetch(apiUrl);
          if (res.ok) {
            const text = await res.text();
            // Extract mosaic data from page
            const mosaicPattern = /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]+?\});\s*window/;
            const mm = mosaicPattern.exec(text);
            if (mm) {
              const data = JSON.parse(mm[1]);
              const results = data?.metaData?.mosaicProviderJobCardsModel?.results || [];
              results.forEach(j => {
                if (j.title) {
                  jobs.push({
                    title: JobService._cleanTitle(j.title),
                    department: JobService._guessDepartment(j.title),
                    location: j.formattedLocation || '',
                    type: j.jobTypes?.[0] || 'Full-time',
                    url: `https://www.indeed.com/viewjob?jk=${j.jobkey}`,
                    source: 'indeed-api'
                  });
                }
              });
            }
          }
        } catch (e) {
          console.warn('[Indeed API fallback] Failed:', e.message);
        }
      }

      console.log(`[Indeed] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Indeed] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. NAUKRI — Internal Search API (used by their own frontend)
  // ═══════════════════════════════════════════════════════════════
  static async fetchNaukri(companyName, locationHint = '') {
    const jobs = [];
    try {
      const keyword = encodeURIComponent(companyName);
      const location = encodeURIComponent(locationHint || '');

      // Naukri's internal search API — same one their site uses
      const apiUrl = `https://www.naukri.com/jobapi/v3/search?noOfResults=20&urlType=search_by_keyword&searchType=adv&keyword=${keyword}&location=${location}&pageNo=1&seoKey=${keyword}-jobs&src=jobsearchDesk&latLong=`;

      const res = await this._fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'Referer': `https://www.naukri.com/${encodeURIComponent(companyName.toLowerCase())}-jobs`,
          'appid': '109',
          'systemid': 'Naukri',
          'x-requested-with': 'XMLHttpRequest',
          'x-naukri-client': 'desktop',
        }
      });

      if (!res.ok) {
        console.warn(`[Naukri] API returned ${res.status}`);
        return await this._fetchNaukriAlternate(companyName);
      }

      const data = await res.json();
      const results = data?.jobDetails || data?.results || [];

      results.forEach(j => {
        if (!j.title && !j.jobTitle) return;
        const title = j.title || j.jobTitle || '';
        jobs.push({
          title: JobService._cleanTitle(title),
          department: JobService._guessDepartment(title),
          location: j.placeholders?.find(p => p.type === 'location')?.label
            || j.location || j.jobLocation || '',
          type: j.jobType || 'Full-time',
          salary: j.placeholders?.find(p => p.type === 'salary')?.label || '',
          url: j.jdURL || j.jobUrl || `https://www.naukri.com${j.staticUrl || ''}`,
          postedDate: j.footerPlaceholderLabel || '',
          source: 'naukri-api'
        });
      });

      console.log(`[Naukri] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Naukri] Fetch failed:', e.message);
    }
    return jobs;
  }

  static async _fetchNaukriAlternate(companyName) {
    // Naukri company page alternate
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = `https://www.naukri.com/companies/${slug}-jobs`;
    try {
      const res = await this._fetch(url, {
        headers: { 'Referer': 'https://www.naukri.com/' }
      });
      if (!res.ok) return [];
      const html = await res.text();

      const jobs = [];
      // Extract from Naukri's embedded JSON
      const jsonPattern = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/;
      const m = jsonPattern.exec(html);
      if (m) {
        try {
          const state = JSON.parse(m[1]);
          const listings = state?.jobData?.jobs || state?.jobs || [];
          listings.forEach(j => {
            if (j.title) {
              jobs.push({
                title: JobService._cleanTitle(j.title),
                department: JobService._guessDepartment(j.title),
                location: j.location || '',
                type: 'Full-time',
                url: j.jdURL || url,
                source: 'naukri-html'
              });
            }
          });
        } catch (_) { }
      }
      return jobs;
    } catch (e) {
      console.warn('[Naukri Alternate]', e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. GLASSDOOR — Internal Jobs API
  // ═══════════════════════════════════════════════════════════════
  static async fetchGlassdoor(companyName) {
    const jobs = [];
    try {
      // Glassdoor's internal API endpoint used by their own site
      const keyword = encodeURIComponent(companyName);
      const apiUrl = `https://www.glassdoor.com/graph`;

      const graphqlBody = JSON.stringify({
        operationName: "JobSearchResultsQuery",
        variables: {
          keyword: companyName,
          locationId: 0,
          locationType: "COUNTRY",
          numJobsToShow: 20,
          pageType: "SERP",
          employerName: companyName
        },
        query: `query JobSearchResultsQuery($keyword: String, $employerName: String, $locationId: Int, $numJobsToShow: Int) {
          jobListings(
            contextHolder: {
              searchParams: {
                keyword: $keyword
                employerName: $employerName
                locationId: $locationId
                numPerPage: $numJobsToShow
              }
            }
          ) {
            jobListings {
              jobview {
                header {
                  jobTitle
                  locationName
                  employerName
                  jobType
                  posted
                  indeedJobAttribute { salarySummary }
                }
                job { listingId }
              }
            }
          }
        }`
      });

      const res = await this._fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Referer': `https://www.glassdoor.com/Jobs/${keyword}-jobs-SRCH_KE0,${keyword.length}.htm`,
          'gd-csrf-token': 'undefined', // Public endpoint, token not enforced for reads
        },
        body: graphqlBody
      });

      if (res.ok) {
        const data = await res.json();
        const listings = data?.data?.jobListings?.jobListings || [];
        listings.forEach(item => {
          const h = item?.jobview?.header;
          if (!h?.jobTitle) return;
          jobs.push({
            title: JobService._cleanTitle(h.jobTitle),
            department: JobService._guessDepartment(h.jobTitle),
            location: h.locationName || '',
            type: h.jobType || 'Full-time',
            salary: h.indeedJobAttribute?.salarySummary || '',
            url: `https://www.glassdoor.com/job-listing/x-jl${item?.jobview?.job?.listingId}`,
            postedDate: h.posted || '',
            source: 'glassdoor-api'
          });
        });
      }

      // Fallback: scrape Glassdoor SERP HTML
      if (jobs.length === 0) {
        const serpUrl = `https://www.glassdoor.com/Jobs/${encodeURIComponent(companyName)}-jobs-SRCH_KO0,${companyName.length}.htm`;
        const serpRes = await this._fetch(serpUrl, {
          headers: { 'Referer': 'https://www.glassdoor.com/index.htm' }
        });
        if (serpRes.ok) {
          const html = await serpRes.text();
          // Extract from embedded Apollo/Redux state
          const statePattern = /window\['appCache'\]\s*=\s*(\{[\s\S]+?\});\s*window/;
          const apolloPattern = /"jobTitle":"([^"]+)","employer[^}]+"locationName":"([^"]+)"/g;
          let am;
          while ((am = apolloPattern.exec(html)) !== null) {
            const title = am[1];
            if (title && JobService._isJobTitle(title)) {
              jobs.push({
                title: JobService._cleanTitle(title),
                department: JobService._guessDepartment(title),
                location: am[2] || '',
                type: 'Full-time',
                url: serpUrl,
                source: 'glassdoor-html'
              });
            }
          }
        }
      }

      console.log(`[Glassdoor] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Glassdoor] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. WELLFOUND (AngelList) — Public GraphQL API
  // ═══════════════════════════════════════════════════════════════
  static async fetchWellfound(companyName) {
    const jobs = [];
    try {
      // Wellfound has a public search API
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      // Try direct company page API
      const apiUrl = `https://wellfound.com/company/${slug}/jobs`;
      const res = await this._fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://wellfound.com/jobs',
        }
      });

      if (res.ok) {
        const text = await res.text();
        // Extract JSON from Next.js page props
        const propsPattern = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/;
        const m = propsPattern.exec(text);
        if (m) {
          try {
            const data = JSON.parse(m[1]);
            const listings = data?.props?.pageProps?.jobs
              || data?.props?.pageProps?.startup?.jobs
              || [];
            listings.forEach(j => {
              if (!j.title) return;
              jobs.push({
                title: JobService._cleanTitle(j.title),
                department: j.roleType || JobService._guessDepartment(j.title),
                location: j.locationNames?.join(', ') || (j.remote ? 'Remote' : ''),
                type: j.jobType || 'Full-time',
                salary: j.compensation || '',
                url: `https://wellfound.com/jobs/${j.id}`,
                source: 'wellfound'
              });
            });
          } catch (_) { }
        }

        // Also try GraphQL endpoint
        if (jobs.length === 0) {
          const jobTitlePattern = /"title":"([^"]{5,100})","slug":"[^"]+","startupName"/g;
          const locationPattern = /"locationNames":\["([^"]+)"\]/;
          let jm;
          while ((jm = jobTitlePattern.exec(text)) !== null) {
            const title = jm[1];
            if (JobService._isJobTitle(title)) {
              jobs.push({
                title: JobService._cleanTitle(title),
                department: JobService._guessDepartment(title),
                location: locationPattern.exec(text)?.[1] || '',
                type: 'Full-time',
                url: `https://wellfound.com/company/${slug}/jobs`,
                source: 'wellfound-html'
              });
            }
          }
        }
      }

      console.log(`[Wellfound] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Wellfound] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. FOUNDIT (Monster India) — Internal API
  // ═══════════════════════════════════════════════════════════════
  static async fetchFoundit(companyName) {
    const jobs = [];
    try {
      const keyword = encodeURIComponent(companyName);
      const apiUrl = `https://www.foundit.in/srp/results?query=${keyword}&location=India&searchId=&limit=20&offset=0`;

      const res = await this._fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://www.foundit.in/',
        }
      });

      if (res.ok) {
        const data = await res.json();
        const results = data?.jobSearchResponse?.data?.jobResults || [];
        results.forEach(j => {
          if (!j.title) return;
          jobs.push({
            title: JobService._cleanTitle(j.title),
            department: JobService._guessDepartment(j.title),
            location: j.locations?.map(l => l.label).join(', ') || '',
            type: j.employmentTypes?.map(e => e.label).join(', ') || 'Full-time',
            salary: j.salary?.label || '',
            url: `https://www.foundit.in/job/${j.id}`,
            postedDate: j.postedDate || '',
            source: 'foundit'
          });
        });
      }

      console.log(`[Foundit] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Foundit] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. TIMESJOBS — RSS + Internal API
  // ═══════════════════════════════════════════════════════════════
  static async fetchTimesJobs(companyName) {
    const jobs = [];
    try {
      const keyword = encodeURIComponent(companyName);
      // TimesJobs RSS feed
      const rssUrl = `https://www.timesjobs.com/candidate/job-search.html?searchType=personalizedSearch&from=submit&txtKeywords=${keyword}&txtLocation=&sequence=1&startPage=1&rss=1`;

      const res = await this._fetch(rssUrl, {
        headers: {
          'Accept': 'application/rss+xml, text/xml',
          'Referer': 'https://www.timesjobs.com/'
        }
      });

      if (res.ok) {
        const xml = await res.text();
        const parsed = this._parseRSS(xml);
        parsed.forEach(item => {
          if (!item.title || !JobService._isJobTitle(item.title)) return;
          jobs.push({
            title: JobService._cleanTitle(item.title),
            department: JobService._guessDepartment(item.title),
            location: item.location || 'India',
            type: 'Full-time',
            url: item.url,
            source: 'timesjobs-rss'
          });
        });
      }

      // Fallback: TimesJobs JSON API
      if (jobs.length === 0) {
        const apiUrl = `https://www.timesjobs.com/jobsearchresult/api/search.json?searchType=personalizedSearch&txtKeywords=${keyword}&txtLocation=&sequence=1&startPage=1`;
        const apiRes = await this._fetch(apiUrl);
        if (apiRes.ok) {
          const data = await apiRes.json();
          (data?.jobSearchResult?.response?.docs || []).forEach(j => {
            if (j.designation) {
              jobs.push({
                title: JobService._cleanTitle(j.designation),
                department: JobService._guessDepartment(j.designation),
                location: j.jobLocations?.string?.join(', ') || '',
                type: 'Full-time',
                salary: j.salary || '',
                url: `https://www.timesjobs.com/job-detail/j${j.jobId}`,
                source: 'timesjobs-api'
              });
            }
          });
        }
      }

      console.log(`[TimesJobs] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[TimesJobs] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. SHINE — Internal API
  // ═══════════════════════════════════════════════════════════════
  static async fetchShine(companyName) {
    const jobs = [];
    try {
      const keyword = encodeURIComponent(companyName);
      const apiUrl = `https://www.shine.com/job-search/${encodeURIComponent(companyName.toLowerCase().replace(/\s+/g, '-'))}-jobs/?q=${keyword}&limit=20&offset=0`;

      const res = await this._fetch(apiUrl, {
        headers: { 'Referer': 'https://www.shine.com/' }
      });

      if (res.ok) {
        const html = await res.text();
        // Extract from Shine's embedded JSON data
        const jsonPattern = /window\.__STORE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/;
        const m = jsonPattern.exec(html);
        if (m) {
          try {
            const store = JSON.parse(m[1]);
            const results = store?.jobList?.jobs || store?.search?.jobs || [];
            results.forEach(j => {
              if (!j.job_title) return;
              jobs.push({
                title: JobService._cleanTitle(j.job_title),
                department: JobService._guessDepartment(j.job_title),
                location: j.location_name || '',
                type: j.job_type || 'Full-time',
                salary: j.ctc || '',
                url: `https://www.shine.com/job/${j.id}/${j.slug}/`,
                source: 'shine'
              });
            });
          } catch (_) { }
        }

        // Regex fallback from HTML
        if (jobs.length === 0) {
          const titlePattern = /"job_title":"([^"]{5,100})"/g;
          let tm;
          const seen = new Set();
          while ((tm = titlePattern.exec(html)) !== null) {
            const t = tm[1];
            if (!seen.has(t) && JobService._isJobTitle(t)) {
              seen.add(t);
              jobs.push({
                title: JobService._cleanTitle(t),
                department: JobService._guessDepartment(t),
                location: '',
                type: 'Full-time',
                url: apiUrl,
                source: 'shine-html'
              });
            }
          }
        }
      }

      console.log(`[Shine] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Shine] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. INTERNSHALA — Public API (for internships)
  // ═══════════════════════════════════════════════════════════════
  static async fetchInternshala(companyName) {
    const jobs = [];
    try {
      const keyword = encodeURIComponent(companyName);
      const apiUrl = `https://internshala.com/internships/keywords-${encodeURIComponent(companyName.toLowerCase().replace(/\s+/g, '-'))}/`;

      const res = await this._fetch(apiUrl, {
        headers: {
          'Accept': 'text/html',
          'Referer': 'https://internshala.com/',
          'X-Requested-With': 'XMLHttpRequest',
        }
      });

      if (res.ok) {
        const html = await res.text();
        // Internshala internship cards
        const cardPattern = /internship_meta[\s\S]*?<div class="company-name[^"]*">\s*([\s\S]*?)\s*<\/div>[\s\S]*?<a[^>]+href="(\/internship\/[^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/gi;
        let m;
        while ((m = cardPattern.exec(html)) !== null) {
          const title = m[3]?.replace(/<[^>]+>/g, '').trim();
          if (title && title.length > 3) {
            jobs.push({
              title: JobService._cleanTitle(title),
              department: JobService._guessDepartment(title),
              location: '',
              type: 'Internship',
              url: `https://internshala.com${m[2]}`,
              source: 'internshala'
            });
          }
        }

        // JSON-LD fallback
        if (jobs.length === 0) {
          const titlePat = /"title":"([^"]{5,100})","company_name":"[^"]*(?:internshala)/gi;
          let tm;
          const seen = new Set();
          while ((tm = titlePat.exec(html)) !== null) {
            if (!seen.has(tm[1])) {
              seen.add(tm[1]);
              jobs.push({
                title: JobService._cleanTitle(tm[1]),
                department: JobService._guessDepartment(tm[1]),
                location: '',
                type: 'Internship',
                url: apiUrl,
                source: 'internshala-json'
              });
            }
          }
        }
      }

      console.log(`[Internshala] Found ${jobs.length} jobs`);
    } catch (e) {
      console.warn('[Internshala] Fetch failed:', e.message);
    }
    return jobs;
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN: Fetch from all boards in parallel
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run all job board fetchers in parallel, deduplicate by title, return merged list.
   * @param {string} companyName
   * @param {object} options - { locationHint, includeInternships, boards }
   */
  static async fetchAll(companyName, options = {}) {
    const {
      locationHint = 'India',
      includeInternships = true,
      boards = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'wellfound', 'foundit', 'timesjobs', 'shine', 'internshala']
    } = options;

    console.log(`[JobBoardService] Fetching from ${boards.length} boards for "${companyName}"`);

    const boardMap = {
      linkedin: () => this.fetchLinkedIn(companyName, locationHint),
      indeed: () => this.fetchIndeed(companyName, locationHint),
      naukri: () => this.fetchNaukri(companyName, locationHint),
      glassdoor: () => this.fetchGlassdoor(companyName),
      wellfound: () => this.fetchWellfound(companyName),
      foundit: () => this.fetchFoundit(companyName),
      timesjobs: () => this.fetchTimesJobs(companyName),
      shine: () => this.fetchShine(companyName),
      internshala: () => includeInternships ? this.fetchInternshala(companyName) : Promise.resolve([]),
    };

    // Run selected boards in parallel; never let one failure kill others
    const promises = boards
      .filter(b => boardMap[b])
      .map(b => boardMap[b]().catch(e => {
        console.warn(`[JobBoardService] ${b} crashed:`, e.message);
        return [];
      }));

    const results = await Promise.allSettled(promises);
    const allJobs = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // ── Deduplicate by normalised title ──
    const seen = new Set();
    const unique = allJobs.filter(job => {
      if (!job?.title || job.title.length < 3) return false;
      const key = job.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Sort: ATS/direct sources first, then board sources ──
    const sourceScore = (s = '') => {
      if (s.includes('api')) return 0;
      if (s.includes('rss')) return 1;
      if (s.includes('json')) return 2;
      return 3;
    };
    unique.sort((a, b) => sourceScore(a.source) - sourceScore(b.source));

    console.log(`[JobBoardService] ✅ Total unique jobs: ${unique.length}`);
    return unique;
  }
}

/**
 * JobService Wrapper
 * Provides the main entry point and helper methods for job data.
 */
class JobService {
  /**
   * Main entry: tries board scrapers first, then falls back to page scraping.
   */
  static async getJobs(companyName, domain, scrapedJobs = [], pageContent = '', pageUrl = '') {
    console.log(`[JobService] Starting job collection for ${companyName}`);

    // 1. Return jobs already found by content script (if any)
    if (scrapedJobs && scrapedJobs.length > 0) {
      console.log(`[JobService] Found ${scrapedJobs.length} jobs from page scraping`);
      return { jobs: scrapedJobs, source: 'page-scrape' };
    }

    // 2. Try Jina Search for job postings (works in sidebar context)
    try {
      const jinaJobs = await this._searchJobsWithJina(companyName, domain);
      if (jinaJobs && jinaJobs.length > 0) {
        console.log(`[JobService] Found ${jinaJobs.length} jobs via Jina search`);
        return { jobs: jinaJobs, source: 'jina-search' };
      }
    } catch (e) {
      console.warn('[JobService] Jina search failed:', e.message);
    }

    // 3. Fallback: Sitemap discovery for career page
    if (!pageUrl || !/\/(careers|jobs|openings|positions|hiring|join)/i.test(pageUrl)) {
      const sitemapUrl = await this._findCareerUrlFromSitemap(domain);
      if (sitemapUrl) {
        try {
          const markdown = await WebScraperService.read(sitemapUrl);
          const parsed = this._parseJobsFromMarkdown(markdown, companyName, sitemapUrl);
          if (parsed.length > 0) {
            console.log(`[JobService] Found ${parsed.length} jobs from sitemap`);
            return { jobs: parsed, source: 'sitemap-reader' };
          }
        } catch (e) { console.warn('[JobService] Sitemap read failed:', e.message); }
      }
    }

    // 4. Last Resort: Extract from raw page text
    if (pageContent && pageContent.length > 200) {
      const parsed = this._parseJobsFromText(pageContent, companyName, pageUrl);
      if (parsed.length > 0) {
        console.log(`[JobService] Found ${parsed.length} jobs from page text`);
        return { jobs: parsed, source: 'page-text' };
      }
    }

    return { jobs: [], source: 'missing' };
  }

  /**
   * Search for jobs using Jina AI (works in sidebar context)
   */
  static async _searchJobsWithJina(companyName, domain) {
    try {
      const jobs = [];

      // Try multiple search queries for better coverage across job platforms
      const searchQueries = [
        // LinkedIn - company-specific job pages
        `site:linkedin.com/jobs "${companyName}" "${companyName} jobs"`,
        `site:linkedin.com/company/${companyName}/jobs`,

        // Indeed - company-specific searches
        `site:indeed.com "${companyName}" jobs company:${companyName}`,
        `site:indeed.com/cmp/${companyName}/jobs`,

        // Glassdoor - company-specific job listings
        `site:glassdoor.com/Job/${companyName}-Jobs`,
        `site:glassdoor.com "${companyName}" jobs`,

        // Naukri - company-specific searches
        `site:naukri.com "${companyName}" jobs`,
        `site:naukri.com/${companyName}-jobs`,

        // Monster - company-specific searches
        `site:monster.com "${companyName}" jobs`,
        `site:monster.com/jobs/search?q=${encodeURIComponent(companyName)}`,

        // Dice - company-specific searches
        `site:dice.com "${companyName}" jobs`,
        `site:dice.com/jobs?q=${encodeURIComponent(companyName)}`,

        // CareerBuilder - company-specific searches
        `site:careerbuilder.com "${companyName}" jobs`,
        `site:careerbuilder.com/jobs-company/${encodeURIComponent(companyName)}`,

        // SimplyHired - company-specific searches
        `site:simplyhired.com "${companyName}" jobs`,
        `site:simplyhired.com/search?q=${encodeURIComponent(companyName)}`,

        // ZipRecruiter - company-specific searches
        `site:ziprecruiter.com "${companyName}" jobs`,
        `site:ziprecruiter.com/c/${encodeURIComponent(companyName)}/Jobs`,

        // Company career pages - most specific
        `${companyName} careers site:${domain}`,
        `${companyName} jobs openings site:${domain}`
      ];

      for (const query of searchQueries) {
        try {
          const markdown = await WebScraperService.search(query);
          if (!markdown || markdown.length < 100) continue;

          // Parse markdown links that look like job postings
          const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/gi;
          let match;
          while ((match = linkPattern.exec(markdown)) !== null) {
            const title = match[1].trim();
            const url = match[2].trim();

            if (this._isJobTitle(title) && this._isValidJobUrl(url, companyName, domain) && !jobs.some(j => j.title.toLowerCase() === title.toLowerCase())) {
              jobs.push({
                title: this._cleanTitle(title),
                department: this._guessDepartment(title),
                location: '',
                type: 'Full-time',
                url: url.startsWith('http') ? url : `https://www.google.com/search?q=${encodeURIComponent(companyName + ' ' + title)}`,
                source: query.includes('linkedin.com') ? 'linkedin-jina' :
                       query.includes('indeed.com') ? 'indeed-jina' :
                       query.includes('naukri.com') ? 'naukri-jina' :
                       query.includes('glassdoor.com') ? 'glassdoor-jina' :
                       query.includes('monster.com') ? 'monster-jina' :
                       query.includes('dice.com') ? 'dice-jina' :
                       query.includes('careerbuilder.com') ? 'careerbuilder-jina' :
                       query.includes('simplyhired.com') ? 'simplyhired-jina' :
                       query.includes('ziprecruiter.com') ? 'ziprecruiter-jina' : 'jina-search'
              });
            }
          }

          // Also extract job titles from plain text lines
          const lines = markdown.split('\n');
          for (const line of lines) {
            const trimmed = line.replace(/^[-*•#]+\s*/, '').trim();
            if (trimmed.length > 20 && trimmed.length < 120 &&
                this._isJobTitle(trimmed) && this._isCompanyJob(trimmed, companyName) &&
                !jobs.some(j => j.title.toLowerCase().includes(trimmed.toLowerCase().split(' ')[0]))) {
              jobs.push({
                title: this._cleanTitle(trimmed),
                department: this._guessDepartment(trimmed),
                location: '',
                type: 'Full-time',
                url: `https://www.google.com/search?q=${encodeURIComponent(companyName + ' ' + trimmed)}`,
                source: 'jina-search'
              });
            }
          }

          // Limit per query to avoid too many duplicates
          if (jobs.length >= 50) break;
        } catch (e) {
          console.warn(`[Jina search] Query "${query}" failed:`, e.message);
        }
      }

      // Remove duplicates and limit total
      const seen = new Set();
      let unique = jobs.filter(job => {
        const key = job.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(key) || key.length < 3) return false;
        seen.add(key);
        return true;
      });

      // Final company validation: ensure jobs are actually for the target company
      unique = unique.filter(job => {
        const jobText = `${job.title} ${job.url}`.toLowerCase();
        const companyLower = companyName.toLowerCase();
        const domainLower = domain ? domain.toLowerCase() : '';

        // Must have some connection to the company
        return jobText.includes(companyLower) ||
               (domainLower && jobText.includes(domainLower)) ||
               job.url.includes('linkedin.com/company/') ||
               job.url.includes('indeed.com/cmp/') ||
               job.url.includes('glassdoor.com/Overview/');
      });

      console.log(`[Jina Search] Found ${unique.length} validated jobs for ${companyName} from ${searchQueries.length} queries`);
      return unique.slice(0, 100);
    } catch (e) {
      console.error('[JobService._searchJobsWithJina] Error:', e);
      return [];
    }
  }

  static _parseJobsFromMarkdown(markdown, companyName, pageUrl = null) {
    const jobs = [];
    const seen = new Set();
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/gi;
    let match;
    while ((match = linkPattern.exec(markdown)) !== null) {
      const title = match[1].trim();
      let url = match[2].trim();
      if (url.startsWith('/') && pageUrl) {
        try { url = new URL(pageUrl).origin + url; } catch (e) { }
      }
      if (this._isJobTitle(title) && !seen.has(title.toLowerCase())) {
        seen.add(title.toLowerCase());
        jobs.push({
          title: this._cleanTitle(title),
          department: this._guessDepartment(title),
          location: '',
          type: 'Full-time',
          url: url.startsWith('http') ? url : `https://www.google.com/search?q=${encodeURIComponent(companyName + ' ' + title)}`,
          source: 'markdown-link'
        });
      }
    }
    // Show all jobs found, no limit
    console.log(`[JobService] Parsed ${jobs.length} jobs from markdown`);
    return jobs;
  }

  static _parseJobsFromText(text, companyName, pageUrl) {
    const jobs = [];
    const seen = new Set();
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (this._isJobTitle(trimmed) && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        jobs.push({
          title: this._cleanTitle(trimmed),
          department: this._guessDepartment(trimmed),
          location: '',
          type: 'Full-time',
          url: pageUrl || '',
          source: 'page-text'
        });
      }
    }
    // Show all jobs found, no limit
    console.log(`[JobService] Parsed ${jobs.length} jobs from page text`);
    return jobs;
  }

  static _isJobTitle(text) {
    if (!text || text.length < 5 || text.length > 120) return false;
    const junkPattern = /logo|icon|find salaries|post job|employer|sign in|log in|apply|learn more|privacy|terms|contact|about/i;
    const jobKeywords = /engineer|developer|designer|manager|analyst|specialist|lead|architect|associate|intern|driver|vp|head|senior|junior/i;
    return jobKeywords.test(text) && !junkPattern.test(text);
  }

  static _isCompanyJob(title, companyName) {
    if (!title || !companyName) return false; // Be stricter - require validation

    const titleLower = title.toLowerCase();
    const companyLower = companyName.toLowerCase();

    // Check if company name appears in title (common for job postings)
    if (titleLower.includes(companyLower)) return true;

    // Check for common company abbreviations or variations
    const companyWords = companyLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);

    // If company has multiple words, check if any significant word matches
    if (companyWords.length > 1) {
      for (const word of companyWords) {
        if (word.length > 2 && titleWords.includes(word)) return true;
      }
    }

    // For single-word companies, be more lenient but still require some match
    if (companyWords.length === 1 && companyWords[0].length > 3) {
      return titleWords.some(word => word.includes(companyWords[0]) || companyWords[0].includes(word));
    }

    // Reject jobs that don't mention the company at all
    return false;
  }

  static _isValidJobUrl(url, companyName, domain) {
    if (!url) return false;

    const urlLower = url.toLowerCase();
    const companyLower = companyName.toLowerCase();
    const domainLower = domain ? domain.toLowerCase() : '';

    // Check if URL contains company name or domain (good sign)
    if (urlLower.includes(companyLower) || (domainLower && urlLower.includes(domainLower))) {
      return true;
    }

    // Allow URLs from known job boards that typically post company-specific jobs
    const trustedJobBoards = [
      'linkedin.com/jobs',
      'indeed.com',
      'glassdoor.com/Job',
      'naukri.com',
      'monster.com/jobs',
      'dice.com/jobs',
      'careerbuilder.com/jobs',
      'simplyhired.com',
      'ziprecruiter.com'
    ];

    // If it's from a trusted job board, allow it (we trust the search query specificity)
    for (const board of trustedJobBoards) {
      if (urlLower.includes(board)) {
        return true;
      }
    }

    // For company career pages, be more strict
    if (domainLower && urlLower.includes(domainLower)) {
      return true;
    }

    // Reject URLs that seem to be from other companies or unrelated sites
    const suspiciousPatterns = [
      'blog', 'news', 'article', 'forum', 'reddit', 'twitter', 'facebook',
      'youtube', 'medium', 'github', 'stackoverflow'
    ];

    for (const pattern of suspiciousPatterns) {
      if (urlLower.includes(pattern)) {
        return false;
      }
    }

    // Default: allow if we can't determine (trust the search)
    return true;
  }

  static _cleanTitle(title) {
    return title.replace(/^[\s\-•·*►▸→\d.]+/, '').trim().substring(0, 100);
  }

  static _guessDepartment(title) {
    const t = title.toLowerCase();
    if (/engineer|developer|software|backend|frontend|fullstack|devops/i.test(t)) return 'Engineering';
    if (/design|ux|ui/i.test(t)) return 'Design';
    if (/product|pm/i.test(t)) return 'Product';
    if (/market|growth|content/i.test(t)) return 'Marketing';
    if (/sales|account/i.test(t)) return 'Sales';
    if (/hr|recruit|people/i.test(t)) return 'People';
    if (/ops|operations|logistics|driver/i.test(t)) return 'Operations';
    return 'General';
  }

  static async _findCareerUrlFromSitemap(domain) {
    if (!domain) return null;
    try {
      const url = `https://${domain}/sitemap.xml`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const xml = await res.text();
      const locMatch = xml.match(/<loc>([^<]+(?:careers|jobs|positions)[^<]*)<\/loc>/i);
      return locMatch ? locMatch[1].trim() : null;
    } catch (e) { return null; }
  }
}