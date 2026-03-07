/**
 * Company Job Intelligence – Sidebar Dashboard Logic
 * AI-powered with offline fallback
 */

document.addEventListener('DOMContentLoaded', () => {
  // Settings link
  document.getElementById('open-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Check for detected company
  loadCompanyData();

  // Refresh button - manual reload only
  let isRefreshing = false;
  document.getElementById('refresh-dashboard')?.addEventListener('click', (e) => {
    e.preventDefault();
    isRefreshing = true;
    const btn = e.currentTarget;
    btn.style.opacity = '1';
    btn.style.animation = 'spin 1s linear infinite';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        showEmptyState();
        document.querySelector('.empty-title').textContent = "Scanning page...";
        document.querySelector('.empty-description').textContent = "Extracting live company data...";

        // Ask content script to re-detect
        chrome.tabs.sendMessage(tabs[0].id, { type: "FORCE_REFRESH" }, () => {
          if (chrome.runtime.lastError) {
            // Content script not ready or prohibited url
            isRefreshing = false;
            btn.style.animation = '';
            btn.style.opacity = '0.7';
            loadCompanyData();
          }
        });
      }
    });
  });

  // Listen for the explicit detection result from our refresh
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "COMPANY_DETECTED" && isRefreshing) {
      setTimeout(() => {
        loadCompanyData().finally(() => {
          isRefreshing = false;
          const btn = document.getElementById('refresh-dashboard');
          if (btn) {
            btn.style.animation = '';
            btn.style.opacity = '0.7';
          }
        });
      }, 200); // give background script time to save
    }
  });
});

async function loadCompanyData() {
  try {
    const result = await chrome.storage.local.get('detectedCompany');

    if (!result.detectedCompany) {
      showEmptyState();
      return;
    }

    const { key, name, hostname, domain, isKnown, faviconUrl, careerPaths, pageUrl, scrapedJobs, pageContent } = result.detectedCompany;
    const companyDomain = domain || hostname;

    // Try AI first, then fallback
    await loadWithAI(name, companyDomain, key, isKnown, faviconUrl, careerPaths, pageUrl, scrapedJobs, pageContent);

  } catch (err) {
    console.error('Error loading company data:', err);
    showEmptyState();
  }
}

async function loadWithAI(companyName, domain, key, isKnown, faviconUrl, careerPaths, pageUrl, scrapedJobs, pageContent) {
  showLoading(companyName);

  try {
    // Aggregator determines if AI is needed based on available API/local data
    const aggregatedData = await DataAggregator.getIntelligence(companyName, domain, faviconUrl, careerPaths, pageUrl, scrapedJobs, pageContent);

    hideLoading();

    // Determine badge to show based on data sources
    let source = 'offline';
    const ds = aggregatedData.dataSources;
    if (ds.jobs === 'jina-search' || ds.jobs === 'jina-reader' || ds.jobs === 'page-scrape' || ds.reviews === 'scraped' || ds.company === 'jina-search') {
      source = 'live'; // Jina AI scraped real data
    } else if (ds.company === 'wikipedia') {
      source = 'api'; // Used APIs like Wikipedia
    } else if (ds.company === 'curated') {
      source = 'cached'; // Curated offline data
    }

    showDashboard(aggregatedData, source);

    // Only show "no key" banner if ALL data sources are missing/defaults
    const allSources = Object.values(ds).filter(v => typeof v === 'string');
    const allMissing = allSources.every(s => s === 'missing' || s === 'defaults' || s === 'none');
    if (allMissing) {
      showNoKeyBanner();
    }

  } catch (err) {
    console.error('Data Aggregator failed:', err);
    hideLoading();
    showEmptyState();
  }
}

function showLoading(companyName) {
  const loader = document.getElementById('ai-loading');
  const sub = document.getElementById('ai-loading-sub');
  if (loader) {
    loader.classList.remove('hidden');
    if (sub) sub.textContent = `Analyzing ${companyName}`;
  }
}

function hideLoading() {
  const loader = document.getElementById('ai-loading');
  if (loader) loader.classList.add('hidden');
}

function showNoKeyBanner() {
  // Removed: No Gemini API key needed
}

function showEmptyState() {
  document.getElementById('empty-state').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loading-state').classList.add('hidden'); // Assuming 'loading-state' is another loading indicator
  hideLoading(); // Keep this for 'ai-loading'

  // Set default analyzing state instead of "No Company Detected"
  if (!isRefreshing) {
    document.querySelector('.empty-title').textContent = "Analyzing...";
    document.querySelector('.empty-description').textContent = "Looking for career intelligence insights...";
  }
}

function showDashboard(company, source) {
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  // Remove old no-key banner if AI was used
  if (source === 'ai' || source === 'cached') {
    document.getElementById('no-key-banner')?.remove();
  }

  renderHeader(company, source);
  renderStats(company);
  renderCultureTags(company);
  renderJobs(company);
  renderInterviewQuestions(company);
  renderReviews(company);
  renderAITips(company);
  initTabs();
}

/* ============================================
   Header
   ============================================ */
function renderHeader(company, source) {
  document.getElementById('company-logo').src = company.logo;
  document.getElementById('company-logo').alt = company.name;
  document.getElementById('company-name').textContent = company.name;
  document.getElementById('company-industry').textContent = company.industry;
  document.getElementById('company-hq').textContent = company.headquarters;
  document.getElementById('company-size').textContent = company.employeeCount + ' employees';

  // Description Toggle
  const descEl = document.getElementById('company-desc');
  const toggleBtn = document.getElementById('desc-toggle');

  if (company.description) {
    descEl.textContent = company.description;
    // Show toggle if description is long
    if (company.description.length > 90) {
      toggleBtn.classList.remove('hidden');
      toggleBtn.textContent = 'Show more';
      descEl.classList.add('collapsed');

      toggleBtn.onclick = () => {
        if (descEl.classList.contains('collapsed')) {
          descEl.classList.remove('collapsed');
          toggleBtn.textContent = 'Show less';
        } else {
          descEl.classList.add('collapsed');
          toggleBtn.textContent = 'Show more';
        }
      };
    } else {
      toggleBtn.classList.add('hidden');
      descEl.classList.remove('collapsed');
    }
  } else {
    descEl.textContent = '';
    toggleBtn.classList.add('hidden');
  }

  // Data source badge
  const existing = document.querySelector('.data-source-badge');
  if (existing) existing.remove();

  const badge = document.createElement('span');
  if (source === 'ai') {
    badge.className = 'data-source-badge ai';
    badge.textContent = '✨ AI Live';
  } else if (source === 'live') {
    badge.className = 'data-source-badge ai';
    badge.textContent = '🔴 Live Scraped';
  } else if (source === 'api') {
    badge.className = 'data-source-badge cached';
    badge.textContent = '🌐 API Data';
  } else if (source === 'cached') {
    badge.className = 'data-source-badge cached';
    badge.textContent = '⚡ Cached';
  } else {
    badge.className = 'data-source-badge offline';
    badge.textContent = '📦 Offline';
  }
  document.querySelector('.company-text')?.appendChild(badge);
}

/* ============================================
   Stats Bar
   ============================================ */
function renderStats(company) {
  document.getElementById('stat-jobs').textContent = company.jobs?.length || 0;
}

/* ============================================
   Culture Tags
   ============================================ */
function renderCultureTags(company) {
  const container = document.getElementById('culture-tags');
  container.innerHTML = '';
  (company.culture || []).forEach(tag => {
    const el = document.createElement('span');
    el.className = 'culture-tag';
    el.textContent = tag;
    container.appendChild(el);
  });
}

/* ============================================
   Jobs
   ============================================ */
function renderJobs(company) {
  const container = document.getElementById('jobs-list');
  const count = document.getElementById('jobs-count');
  const appSummaryContainer = document.getElementById('application-summary-container');
  const appSummaryText = document.getElementById('application-summary-text');

  container.innerHTML = '';
  const jobs = company.jobs || [];
  count.textContent = jobs.length + ' positions';

  // Render AI Application Insights
  if (company.applicationSummary) {
    appSummaryText.textContent = company.applicationSummary;
    appSummaryContainer.classList.remove('hidden');
  } else {
    appSummaryContainer.classList.add('hidden');
  }

  if (jobs.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 13px; background: rgba(148,163,184,0.05); border-radius: var(--radius-md);">No open positions found.</div>`;
    return;
  }

  jobs.forEach((job, i) => {
    // Generate a search URL if the job doesn't have a direct URL
    const jobUrl = job.url || `https://www.indeed.com/jobs?q=${encodeURIComponent(company.name + ' ' + (job.title || ''))}`;

    const card = document.createElement('a');
    card.className = 'job-card job-card-link';
    card.href = jobUrl;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.title = 'Click to search/apply for this job';
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="job-card-header">
        <span class="job-title">${job.title || 'Untitled'}</span>
        <span class="job-salary">${job.salary || ''}</span>
      </div>
      <div class="job-details">
        <span class="job-tag department">${job.department || 'General'}</span>
        <span class="job-tag location">📍 ${job.location || 'TBD'}</span>
        <span class="job-tag type">${job.type || 'Full-time'}</span>
        <span class="job-tag level">${job.level || ''}</span>
      </div>
      <div class="job-posted" style="display: flex; justify-content: space-between; align-items: center;">
        <span>${job.posted ? 'Posted ' + job.posted : ''}</span>
        <span style="font-size: 10px; opacity: 0.6;">${job.source || ''}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ============================================
   Interview Questions
   ============================================ */
function renderInterviewQuestions(company) {
  const container = document.getElementById('interview-list');
  const count = document.getElementById('interview-count');
  container.innerHTML = '';
  const questions = company.interviewQuestions || [];
  count.textContent = questions.length + ' questions';

  if (questions.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 13px; background: rgba(148,163,184,0.05); border-radius: var(--radius-md);">No interview questions found for this company.</div>`;
    return;
  }

  questions.forEach((q, i) => {
    const diffClass = (q.difficulty || 'medium').toLowerCase();
    const card = document.createElement('a');
    card.className = 'interview-card';
    card.href = q.url || '#';
    card.target = '_blank';
    card.rel = 'noopener';
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="difficulty-indicator ${diffClass}"></div>
      <div class="interview-info">
        <div class="interview-title">${q.title || 'Question'}</div>
        <div class="interview-meta">
          <span class="interview-category">${q.category || ''}</span>
          <span class="interview-source">• ${q.source || 'Unknown'}</span>
        </div>
      </div>
      <span class="difficulty-badge ${diffClass}">${q.difficulty || 'Medium'}</span>
    `;
    container.appendChild(card);
  });
}

/* ============================================
   Reviews
   ============================================ */
function renderReviews(company) {
  const container = document.getElementById('reviews-content');
  container.innerHTML = '';

  // Render review sources as cards instead of plain links
  const sourcesContainer = document.getElementById('review-sources');
  const companyQuery = encodeURIComponent(company.name);
  sourcesContainer.innerHTML = `
    <div class="review-source-cards" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
      <a href="https://www.glassdoor.com/Reviews/${companyQuery}-reviews-SRCH_KE0,${companyQuery.length}.htm" target="_blank" class="review-source-card glassdoor">
        <div class="source-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #52B95C;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
        <div class="source-info">
          <div class="source-name">Glassdoor</div>
          <div class="source-desc">Company Reviews</div>
        </div>
        <div class="source-arrow">↗</div>
      </a>
      <a href="https://www.linkedin.com/company/${companyQuery}/reviews/" target="_blank" class="review-source-card linkedin">
        <div class="source-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #0A66C2;">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/>
          </svg>
        </div>
        <div class="source-info">
          <div class="source-name">LinkedIn</div>
          <div class="source-desc">Company Reviews</div>
        </div>
        <div class="source-arrow">↗</div>
      </a>
      <a href="https://www.indeed.com/cmp/${companyQuery}/reviews" target="_blank" class="review-source-card indeed">
        <div class="source-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #003DA5;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
          </svg>
        </div>
        <div class="source-info">
          <div class="source-name">Indeed</div>
          <div class="source-desc">Employee Reviews</div>
        </div>
        <div class="source-arrow">↗</div>
      </a>
    </div>
  `;

  const r = company.reviews || null;

  if (!r || !r.overall) {
    // Show empty state for reviews
    const emptyRow = document.createElement('div');
    emptyRow.innerHTML = `<div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 13px; background: rgba(148,163,184,0.05); border-radius: var(--radius-md); margin-top: 16px;">No structured employee reviews found. Click the links above to search.</div>`;
    container.appendChild(emptyRow);
    return;
  }

  // Rating bars
  const ratings = [
    { label: 'Overall', value: Number(r.overall) || 0 },
    { label: 'Work-Life Balance', value: Number(r.workLife) || 0 },
    { label: 'Compensation', value: Number(r.compensation) || 0 },
    { label: 'Management', value: Number(r.management) || 0 },
    { label: 'Culture', value: Number(r.culture) || 0 }
  ];

  const ratingsCard = document.createElement('div');
  ratingsCard.className = 'review-ratings';
  ratings.forEach(({ label, value }) => {
    const pct = (value / 5) * 100;
    const row = document.createElement('div');
    row.className = 'rating-row';
    row.innerHTML = `
      <span class="rating-label">${label}</span>
      <div class="rating-bar-wrapper">
        <div class="rating-bar" style="width: 0%;" data-width="${pct}%"></div>
      </div>
      <span class="rating-value">${value.toFixed(1)}</span>
    `;
    ratingsCard.appendChild(row);
  });
  container.appendChild(ratingsCard);

  setTimeout(() => {
    ratingsCard.querySelectorAll('.rating-bar').forEach(bar => {
      bar.style.width = bar.dataset.width;
    });
  }, 200);

  // User Reviews - Indeed-style cards
  const userReviews = r.userReviews || [];
  if (userReviews.length > 0) {
    const reviewsSection = document.createElement('div');
    reviewsSection.className = 'user-reviews-container';
    reviewsSection.style.marginTop = '24px';

    let html = `<div class="review-section-title" style="margin-bottom: 16px; font-size: 14px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
      Employee Reviews (${userReviews.length})
    </div>`;

    userReviews.forEach((review, i) => {
      const starsHtml = '★'.repeat(Math.floor(review.rating)) + (review.rating % 1 !== 0 ? '½' : '');
      const fullStars = '★'.repeat(5);
      const filledStars = '★'.repeat(Math.floor(review.rating));
      const emptyStars = '☆'.repeat(5 - Math.floor(review.rating));

      html += `
        <div class="indeed-review-card" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; animation: slideInUp 0.3s ease forwards; animation-delay: ${i * 0.05}s; opacity: 0; transition: all 0.2s ease;">
          <!-- Review Header -->
          <div class="review-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div class="reviewer-info" style="flex: 1;">
              <div class="reviewer-name" style="font-weight: 600; font-size: 14px; color: var(--text-primary); margin-bottom: 2px;">${review.author || 'Anonymous Employee'}</div>
              <div class="reviewer-meta" style="font-size: 12px; color: var(--text-muted);">${review.date || 'Recent'}</div>
            </div>
            <div class="review-rating" style="text-align: right;">
              <div class="stars-large" style="font-size: 18px; color: #FBBF24; margin-bottom: 4px;">${filledStars}${emptyStars}</div>
              <div class="rating-number" style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${review.rating}/5</div>
            </div>
          </div>

          <!-- Review Title -->
          <h4 class="review-title" style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0 0 12px 0; line-height: 1.3;">${review.title || 'Employee Review'}</h4>

          <!-- Review Content -->
          <div class="review-content" style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">${review.text}</div>

          <!-- Review Footer -->
          <div class="review-footer" style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
            <div class="review-source" style="font-size: 11px; color: var(--text-muted);">
              <span style="opacity: 0.7;">via</span> ${review.source || 'Company Review'}
            </div>
            <div class="review-helpful" style="font-size: 11px; color: var(--text-muted);">
              ✓ Verified Review
            </div>
          </div>
        </div>
      `;
    });

    reviewsSection.innerHTML = html;
    container.appendChild(reviewsSection);
  } else {
    // Fallback to old Pros/Cons if no user reviews extracted
    const pros = r.pros || [];
    if (pros.length) {
      const prosSection = document.createElement('div');
      prosSection.className = 'review-section';
      prosSection.style.marginTop = '24px';
      prosSection.innerHTML = `
        <div class="review-section-title pros" style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="color: #10B981;">✅</span> Pros (${pros.length})
        </div>
        <div class="pros-list" style="display: flex; flex-direction: column; gap: 8px;">
          ${pros.map(p => `<div class="pro-item" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px; padding: 10px 12px; font-size: 13px; color: var(--text-secondary);">${p}</div>`).join('')}
        </div>
      `;
      container.appendChild(prosSection);
    }

    const cons = r.cons || [];
    if (cons.length) {
      const consSection = document.createElement('div');
      consSection.className = 'review-section';
      consSection.style.marginTop = pros.length > 0 ? '20px' : '24px';
      consSection.innerHTML = `
        <div class="review-section-title cons" style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="color: #EF4444;">⚠️</span> Cons (${cons.length})
        </div>
        <div class="cons-list" style="display: flex; flex-direction: column; gap: 8px;">
          ${cons.map(c => `<div class="con-item" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; padding: 10px 12px; font-size: 13px; color: var(--text-secondary);">${c}</div>`).join('')}
        </div>
      `;
      container.appendChild(consSection);
    }
  }
}

/* ============================================
   AI Tips
   ============================================ */
function renderAITips(company) {
  const container = document.getElementById('ai-content');
  container.innerHTML = '';

  (company.aiTips || []).forEach((tip, i) => {
    const card = document.createElement('div');
    card.className = 'ai-tip-card';
    card.style.animationDelay = `${i * 0.1}s`;
    card.innerHTML = `
      <div class="ai-tip-number">Tip ${i + 1}</div>
      <div class="ai-tip-text">${tip}</div>
    `;
    container.appendChild(card);
  });
}

/* ============================================
   Tab Navigation
   ============================================ */
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  buttons.forEach(btn => {
    // Remove old listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
      const tabName = newBtn.dataset.tab;

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      newBtn.classList.add('active');
      const targetPanel = document.getElementById('tab-' + tabName);
      if (targetPanel) {
        targetPanel.classList.add('active');

        if (tabName === 'reviews') {
          setTimeout(() => {
            targetPanel.querySelectorAll('.rating-bar').forEach(bar => {
              bar.style.width = '0%';
              setTimeout(() => {
                bar.style.width = bar.dataset.width;
              }, 50);
            });
          }, 50);
        }
      }
    });
  });
}