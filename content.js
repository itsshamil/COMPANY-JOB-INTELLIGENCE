/**
 * Company Job Intelligence – Content Script
 * Universal smart career page detection, DOM job scraping & floating notification banner
 * Works on ANY company website, not just known ones
 */

(() => {
  const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();

  // Skip non-company sites (search engines, social media feeds, common tools, etc.)
  const SKIP_DOMAINS = [
    'google.com/search', 'bing.com', 'yahoo.com', 'duckduckgo.com',
    'youtube.com', 'reddit.com', 'wikipedia.org', 'stackoverflow.com',
    'github.com', 'localhost', 'chrome.google.com', 'extensions',
    'web.whatsapp.com', 'mail.google.com', 'docs.google.com',
    'drive.google.com', 'maps.google.com', 'translate.google.com',
    'calendar.google.com', 'photos.google.com'
  ];

  // Check if this domain should be skipped
  function shouldSkip() {
    const fullUrl = window.location.href.toLowerCase();
    for (const skip of SKIP_DOMAINS) {
      if (fullUrl.includes(skip)) return true;
    }
    if (/^(\d+\.){3}\d+$/.test(hostname)) return true;
    if (hostname === 'localhost' || hostname === '') return true;
    if (window.location.protocol === 'chrome:' || window.location.protocol === 'chrome-extension:') return true;
    return false;
  }

  // Extract company name from any domain
  function extractCompanyName(host) {
    let name = host
      .replace(/^(www|app|portal|dashboard|cloud|api|dev|staging|blog|shop|store|mail|my|support|help|docs|career|careers|jobs)\./i, '')
      .replace(/\.(com|org|net|io|co|ai|dev|app|tech|cloud|us|uk|de|fr|in|ca|au|jp|eu|gov|edu|mil)(\.[a-z]{2})?$/i, '');

    name = name.split(/[-_.]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    return name;
  }

  // Create dynamic entry for ANY company website
  function detectCompany() {
    const companyName = extractCompanyName(hostname);
    if (companyName && companyName.length > 1) {
      return {
        key: '__dynamic__',
        name: companyName,
        domain: hostname,
        isKnown: false
      };
    }
    return null;
  }

  // ========================================================================
  //  DOM SCRAPER: Extract job listings directly from the current page
  // ========================================================================
  function scrapeJobsFromPage() {
    const jobs = [];
    const text = document.body?.innerText || '';
    const pageUrl = window.location.href;

    // Strategy 1: Look for structured job listing containers
    // Common selectors used by career pages, ATS platforms (Greenhouse, Lever, Workday, etc.)
    const jobSelectors = [
      // Greenhouse
      '.opening', '.job-post', '[data-mapped="true"]',
      // Lever
      '.posting', '.posting-title',
      // Workday
      '[data-automation-id="jobTitle"]',
      // Generic career page patterns
      '.job-listing', '.job-card', '.job-item', '.job-row',
      '.career-listing', '.career-item', '.position-item',
      '.vacancy', '.vacancy-item', '.job-opportunity',
      '[class*="job-card"]', '[class*="job-list"]', '[class*="job-item"]',
      '[class*="career"]', '[class*="position"]', '[class*="vacancy"]',
      '[class*="opening"]', '[class*="apply"]', '[class*="application"]',
      // Job action elements
      '[data-testid*="apply"]', '[data-testid*="job"]',
      // List items inside career/job containers
      '.jobs-list li', '.job-listings li', '.openings-list li',
      '.apply-section', '.apply-now', '.job-actions',
      // Apply buttons and action links
      'button[class*="apply"]', 'button[aria-label*="apply"]',
      'a[class*="apply"]', 'a[aria-label*="apply"]',
      // Table rows in job boards
      'table.jobs tr', '.job-table tr',
      // Indeed-style
      '.jobsearch-ResultsList .job_seen_beacon',
      '.tapItem', '.resultContent',
      // LinkedIn-style
      '.jobs-search-results__list-item',
      // Job board external links with apply keywords
      'a[href*="/jobs/"]', 'a[href*="/careers/"]', 'a[href*="/positions/"]',
      'a[href*="/apply"]', 'a[href*="/application"]',
      'a[href*="greenhouse.io"]', 'a[href*="lever.co"]',
      'a[href*="workday.com"]', 'a[href*="myworkday"]'
    ];

    const seen = new Set();

    for (const selector of jobSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const title = el.querySelector('h2, h3, h4, .title, [class*="title"], a')?.textContent?.trim()
            || el.textContent?.trim().split('\n')[0]?.trim();

          if (!title || title.length < 3 || title.length > 120 || seen.has(title.toLowerCase())) return;
          seen.add(title.toLowerCase());

          // Try to extract location
          const location = el.querySelector('[class*="location"], [class*="loc"], .location')?.textContent?.trim()
            || '';

          // Try to extract department
          const department = el.querySelector('[class*="department"], [class*="dept"], [class*="team"], .department')?.textContent?.trim()
            || '';

          // Try to extract a link
          let url = '';
          const link = el.tagName === 'A' ? el : el.querySelector('a');
          if (link && link.href) {
            url = link.href;
          }

          jobs.push({
            title: title.substring(0, 100),
            department: department.substring(0, 60) || 'General',
            location: location.substring(0, 60) || '',
            type: 'Full-time',
            url: url || pageUrl,
            source: 'page-scrape'
          });
        });
      } catch (e) { /* skip invalid selectors */ }
    }

    // Strategy 2: If no structured jobs found, extract from text patterns
    if (jobs.length === 0) {
      // Look for common job title patterns in text
      const jobTitlePatterns = [
        /(?:^|\n)\s*(?:•|·|–|—|-|\*|►|▸|→)\s*(.+?(?:Engineer|Developer|Designer|Manager|Analyst|Specialist|Director|Lead|Architect|Consultant|Coordinator|Associate|Intern|VP|Head of).+?)(?:\n|$)/gi,
        /(?:^|\n)\s*(?:Senior|Junior|Lead|Staff|Principal|Sr\.|Jr\.)\s+(.+?)(?:\n|$)/gim,
      ];

      for (const pattern of jobTitlePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null && jobs.length < 20) {
          const title = match[1]?.trim();
          if (title && title.length > 5 && title.length < 100 && !seen.has(title.toLowerCase())) {
            seen.add(title.toLowerCase());
            jobs.push({
              title: title,
              department: 'General',
              location: '',
              type: 'Full-time',
              url: pageUrl,
              source: 'page-text'
            });
          }
        }
      }

      // Strategy 2b: Look for job content near "apply now", "apply here", "apply button", etc
      const applyKeywords = ['apply now', 'apply here', 'apply button', 'submit application', 'apply for', 'view job'];
      const applyPattern = new RegExp(
        `(.{0,100})(${applyKeywords.join('|')})(.{0,100})`,
        'gi'
      );
      
      let match;
      while ((match = applyPattern.exec(text)) !== null && jobs.length < 25) {
        const before = match[1].trim();
        const keyword = match[2].trim();
        const after = match[3].trim();
        
        // Extract potential job title from context
        const lines = before.split('\n');
        const possibleTitle = lines[lines.length - 1]?.substring(0, 80);
        
        if (possibleTitle && possibleTitle.length > 5 && possibleTitle.length < 100 && 
             !seen.has(possibleTitle.toLowerCase())) {
          
          // Check if it looks like a job title (has role keywords)
          if (/engineer|developer|designer|manager|analyst|specialist|director|lead|architect|consultant|coordinator|associate|intern|officer|clerk|technician|specialist/i.test(possibleTitle)) {
            seen.add(possibleTitle.toLowerCase());
            jobs.push({
              title: possibleTitle,
              department: 'General',
              location: '',
              type: 'Full-time',
              url: pageUrl,
              source: 'page-text-apply'
            });
          }
        }
      }
    }

    return jobs.slice(0, 30); // Cap at 30 results
  }

  // Scrape page text content for AI extraction
  function scrapePageContent() {
    const bodyText = document.body?.innerText || '';
    // Truncate to 15k chars to keep storage manageable
    return bodyText.substring(0, 15000);
  }

  // Check if career-related paths exist on this domain
  async function detectCareers() {
    const paths = ["/careers", "/jobs", "/careers/jobs", "/openings", "/join", "/work-with-us", "/career", "/hiring", "/join-us", "/open-positions"];
    const found = [];

    const checkPath = async (path) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(window.location.origin + path, {
          method: "HEAD",
          signal: controller.signal,
          mode: "no-cors"
        });
        clearTimeout(timeoutId);
        if (res.ok || res.status === 0 || res.status === 301 || res.status === 302) {
          found.push(path);
        }
      } catch (e) { /* ignore */ }
    };

    await Promise.allSettled(paths.map(checkPath));
    return found;
  }

  // Scan page for career signals
  function scanPageForCareerSignals() {
    const text = document.body?.innerText?.toLowerCase() || '';
    const links = Array.from(document.querySelectorAll('a[href]'));

    const signals = {
      hasCareerLinks: false,
      hasJobMentions: false,
      careerPaths: [],
      jobTitles: []
    };

    const careerPatterns = [/\/careers/i, /\/jobs/i, /\/openings/i, /\/hiring/i, /\/join/i, /\/work-with-us/i];
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      for (const pattern of careerPatterns) {
        if (pattern.test(href)) {
          signals.hasCareerLinks = true;
          signals.careerPaths.push(href);
          break;
        }
      }
    });

    const jobKeywords = ['we are hiring', 'join our team', 'open positions', 'career opportunities', 'job openings', 'work with us', 'view all jobs', 'apply now'];
    signals.hasJobMentions = jobKeywords.some(kw => text.includes(kw));

    return signals;
  }

  // Inject floating notification banner
  function injectBanner(companyName, isKnown, hasCareerSignals) {
    if (document.getElementById('cji-notification-banner')) return;

    const subtitle = isKnown
      ? 'We have career insights for this company • Click to explore'
      : hasCareerSignals
        ? 'Career opportunities detected • Click to explore insights'
        : 'Click to explore career insights for this company';

    const banner = document.createElement('div');
    banner.id = 'cji-notification-banner';
    banner.innerHTML = `
      <div id="cji-banner-inner">
        <div id="cji-banner-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 7H4C2.89543 7 2 7.89543 2 9V19C2 20.1046 2.89543 21 4 21H20C21.1046 21 22 20.1046 22 19V9C22 7.89543 21.1046 7 20 7Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 7V5C16 3.89543 15.1046 3 14 3H10C8.89543 3 8 3.89543 8 5V7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="14" r="2" fill="#00F5D4" stroke="#00F5D4" stroke-width="1"/>
            <circle cx="12" cy="14" r="4" stroke="#00F5D4" stroke-width="0.8" opacity="0.5"/>
            <circle cx="12" cy="14" r="6" stroke="#00F5D4" stroke-width="0.5" opacity="0.3"/>
          </svg>
        </div>
        <div id="cji-banner-content">
          <div id="cji-banner-title">🎯 ${isKnown ? 'Jobs Detected' : 'Company Detected'} – ${companyName}</div>
          <div id="cji-banner-subtitle">${subtitle}</div>
        </div>
        <button id="cji-banner-action">Open Dashboard →</button>
        <button id="cji-banner-close">✕</button>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #cji-notification-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        animation: cjiSlideDown 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        pointer-events: auto;
      }

      @keyframes cjiSlideDown {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      @keyframes cjiSlideUp {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-100%); opacity: 0; }
      }

      @keyframes cjiPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0, 245, 212, 0.4); }
        50% { box-shadow: 0 0 0 8px rgba(0, 245, 212, 0); }
      }

      #cji-banner-inner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.97), rgba(30, 41, 59, 0.97));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-bottom: 1px solid rgba(0, 245, 212, 0.3);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4), 0 0 40px rgba(0, 245, 212, 0.1);
      }

      #cji-banner-icon {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, rgba(0, 245, 212, 0.15), rgba(99, 102, 241, 0.15));
        border-radius: 10px;
        border: 1px solid rgba(0, 245, 212, 0.25);
        animation: cjiPulse 2s ease-in-out infinite;
      }

      #cji-banner-content {
        flex: 1;
        min-width: 0;
      }

      #cji-banner-title {
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: 0.2px;
      }

      #cji-banner-subtitle {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 2px;
      }

      #cji-banner-action {
        flex-shrink: 0;
        padding: 8px 18px;
        background: linear-gradient(135deg, #00F5D4, #6366F1);
        color: #0f172a;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s ease;
        letter-spacing: 0.3px;
      }

      #cji-banner-action:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 15px rgba(0, 245, 212, 0.4);
      }

      #cji-banner-close {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 0;
        line-height: 1;
      }

      #cji-banner-close:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(banner);

    // Close banner and open sidebar when action button clicked
    document.getElementById('cji-banner-action').addEventListener('click', () => {
      closeBanner(banner);
      chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    });

    // Close button handler
    document.getElementById('cji-banner-close').addEventListener('click', () => {
      closeBanner(banner);
    });

    // Listen for when sidebar opens and auto-close banner
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'SIDEBAR_OPENED') {
        closeBanner(banner);
      }
    });

    // Helper function to close banner
    function closeBanner(bannerEl) {
      if (bannerEl && bannerEl.parentNode) {
        bannerEl.style.animation = 'cjiSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => {
          if (bannerEl.parentNode) bannerEl.remove();
        }, 400);
      }
    }
  }

  // Main detection logic
  async function init() {
    if (shouldSkip()) return;

    const company = detectCompany();
    if (!company) return;

    // Get best available favicon
    function getFavicon() {
      const links = Array.from(document.querySelectorAll('link[rel~="icon"]'));
      if (links.length > 0) {
        links.sort((a, b) => {
          const sizeA = a.getAttribute('sizes') ? parseInt(a.getAttribute('sizes').split('x')[0]) : 0;
          const sizeB = b.getAttribute('sizes') ? parseInt(b.getAttribute('sizes').split('x')[0]) : 0;
          return sizeB - sizeA;
        });
        return links[0].href;
      }
      return `${window.location.origin}/favicon.ico`;
    }

    const faviconUrl = getFavicon();

    // Scan page for career signals
    const pageSignals = scanPageForCareerSignals();

    // ★ Scrape jobs directly from the current page DOM
    const scrapedJobs = scrapeJobsFromPage();
    console.log(`[CJI Content] Scraped ${scrapedJobs.length} jobs from page DOM`);

    // ★ Scrape the page text content for AI extraction
    const pageContent = scrapePageContent();

    // Check career paths in background
    const careerPaths = await detectCareers();
    const hasCareerSignals = pageSignals.hasCareerLinks || pageSignals.hasJobMentions || careerPaths.length > 0 || scrapedJobs.length > 0;

    // Send company data + scraped content to background (ONLY if there are career signals or jobs)
    if (hasCareerSignals) {
      chrome.runtime.sendMessage({
        type: "COMPANY_DETECTED",
        companyKey: company.key,
        companyName: company.name,
        hostname: hostname,
        domain: company.domain,
        faviconUrl: faviconUrl,
        isKnown: company.isKnown,
        hasCareerSignals: hasCareerSignals,
        careerPaths: careerPaths,
        pageUrl: window.location.href,
        // ★ NEW: scraped data from the page
        scrapedJobs: scrapedJobs,
        pageContent: pageContent
      });

      // Show the banner
      injectBanner(company.name, company.isKnown, hasCareerSignals);
    } else {
      console.log(`[CJI Content] No career signals found for ${company.name}, skipping extension activation.`);
    }
  }

  // Run after a small delay to not interfere with page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }

  // Listen for manual refresh requests from the sidebar
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "FORCE_REFRESH") {
      init();
      sendResponse({ status: 'ok' });
    }
    return true;
  });
})();