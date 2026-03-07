================================================================================
          COMPANY JOB INTELLIGENCE - SYSTEM DESIGN DOCUMENT
================================================================================

VERSION: 12.0
LAST UPDATED: March 7, 2026
TYPE: Chrome Extension (Manifest V3)
LANGUAGE: JavaScript (ES6+)

================================================================================
1. EXECUTIVE SUMMARY
================================================================================

Company Job Intelligence is a Chrome browser extension that intelligently detects
when you visit a company's website and automatically provides comprehensive career
intelligence including:

  • Open job positions from multiple boards
  • Employee reviews and company ratings
  • Interview preparation resources
  • Company information and background

The extension uses a layered approach to data gathering, combining web scraping
(via Jina AI), Wikipedia APIs, and local caching to provide real-time information
without requiring external API keys or subscriptions.

KEY PHILOSOPHY: "Work offline-first, enhance with live web scraping"

================================================================================
2. SYSTEM ARCHITECTURE OVERVIEW
================================================================================

2.1 HIGH-LEVEL ARCHITECTURE

┌─────────────────────────────────────────────────────────────────────────────┐
│                          CHROME EXTENSION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐    ┌──────────────────────┐                      │
│  │  Content Script      │    │  Background Worker   │                      │
│  │  (content.js)        │    │  (background.js)     │                      │
│  │                      │    │                      │                      │
│  │ • DOM Job Scraping   │    │ • Message Routing    │                      │
│  │ • Company Detection  │    │ • Storage Management │                      │
│  │ • Notification       │    │ • API Coordination   │                      │
│  └──────────────────────┘    └──────────────────────┘                      │
│           │                            │                                     │
│           └────────────────┬───────────┘                                     │
│                            │                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │            DATA AGGREGATION LAYER (services/)                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐            │   │
│  │  │ Company      │  │ Job Service   │  │ Review        │            │   │
│  │  │ Service      │  │               │  │ Service       │            │   │
│  │  │              │  │ • Multi-board │  │               │            │   │
│  │  │ • Wikipedia  │  │ • Jina Search │  │ • Glassdoor   │            │   │
│  │  │ • Jina AI    │  │ • Company     │  │ • Indeed      │            │   │
│  │  │ • Defaults   │  │   validation  │  │ • Curated DB  │            │   │
│  │  └──────────────┘  └───────────────┘  └───────────────┘            │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐            │   │
│  │  │ Interview    │  │ Web Scraper   │  │ AI Fallback   │            │   │
│  │  │ Service      │  │ (Jina AI)     │  │ Service       │            │   │
│  │  │              │  │               │  │ (DISABLED)    │            │   │
│  │  │ • LeetCode   │  │ • Search API  │  │               │            │   │
│  │  │ • GFG        │  │ • Reader API  │  │ • Defaults    │            │   │
│  │  │ • Resources  │  │               │  │ • Empty stubs │            │   │
│  │  └──────────────┘  └───────────────┘  └───────────────┘            │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                            │                                     │
│           └────────────────┬───────────┘                                     │
│                            │                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │            DATA AGGREGATOR (aggregator.js)                          │   │
│  │                                                                      │   │
│  │  1. Collect from all services in parallel                          │   │
│  │  2. Supplement jobs with Jina if < 5 found                         │   │
│  │  3. Apply sensible defaults for missing fields                     │   │
│  │  4. Return unified company object                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                                                                  │
│           └──────────────────────┬────────────────────────────────────     │
│                                  │                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │            UI LAYER (sidebar.js)                                    │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│  │  │ Jobs Panel   │  │ Reviews      │  │ Interview    │             │   │
│  │  │              │  │ Panel        │  │ Panel        │             │   │
│  │  │ • Source tag │  │              │  │              │             │   │
│  │  │ • Cards      │  │ • Ratings    │  │ • Resources  │             │   │
│  │  │ • Stacked    │  │ • Reviews    │  │ • Links      │             │   │
│  │  │              │  │ • Source     │  │              │             │   │
│  │  │              │  │   cards      │  │              │             │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │   │
│  │                                                                      │   │
│  │  Styling: Dark theme, glassmorphism, smooth animations             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  EXTERNAL APIs   │
                    ├──────────────────┤
                    │ • Jina AI        │
                    │ • Wikipedia      │
                    │ • Job Boards     │
                    │ • Clearbit Logo  │
                    └──────────────────┘

2.2 DATA FLOW

When user visits a company website:

  1. DETECTION PHASE (content.js)
     └─ Extract company name from domain (e.g., openai.com → OpenAI)
     └─ Detect if page contains job listings or career content
     └─ Send message to background worker with company info

  2. AGGREGATION PHASE (services/)
     └─ CompanyService: Get company info from Wikipedia or Jina Search
     └─ JobService: Find jobs from multiple platforms via Jina AI
     └─ ReviewService: Scrape employee reviews from Glassdoor/Indeed
     └─ InterviewService: Provide interview prep resource links
     └─ WebScraperService: Power all scraping via Jina AI APIs

  3. ENHANCEMENT PHASE (aggregator.js)
     └─ Combine all service outputs
     └─ Validate company-specific jobs
     └─ Fill missing fields with sensible defaults
     └─ Deduplicate and sort results

  4. RENDERING PHASE (sidebar.js)
     └─ Inject sidebar panel into page
     └─ Render jobs, reviews, interviews in card layouts
     └─ Add hover effects and animations
     └─ Display source attribution for transparency

================================================================================
3. CORE FEATURES
================================================================================

3.1 UNIVERSAL COMPANY DETECTION

  Feature: Works on ANY company website, not just predefined ones
  
  How it works:
    • Detects company from domain name automatically
    • Extracts company name intelligently from URLs like:
      - www.openai.com → OpenAI
      - careers.google.com → Google
      - jobs-amazon.herokuapp.com → Amazon
    • Skips non-company sites (Google Search, Reddit, GitHub, etc.)
    • Also detects if page contains job listings or career keywords

  Code: content.js - extractCompanyName(), detectCompany()
  
  Limitation:
    • Generic domains (startup.io, company.io) may not be recognized perfectly
    • Multi-brand companies may need manual specification


3.2 JOB DISCOVERY

  Feature: Find open positions across 10+ major job boards
  
  Supported platforms:
    ✓ LinkedIn (linkedin.com/jobs)
    ✓ Indeed (indeed.com)
    ✓ Glassdoor (glassdoor.com)
    ✓ Naukri (naukri.com) - India focus
    ✓ Monster (monster.com)
    ✓ Dice (dice.com) - Tech focus
    ✓ CareerBuilder (careerbuilder.com)
    ✓ SimplyHired (simplyhired.com)
    ✓ ZipRecruiter (ziprecruiter.com)
    ✓ Company career pages (site:company.com)

  How it works:
    LAYER 1: DOM Scraping
      • If user is on company careers page, extract jobs directly from HTML
      • Parse job titles, departments, locations from visible content
      
    LAYER 2: Jina AI Search
      • Search "OpenAI LinkedIn jobs" across job boards
      • Use site-specific queries: site:linkedin.com/job "OpenAI"
      • Collect from all sources in parallel for speed
      
    LAYER 3: Validation
      • Check if job actually belongs to the target company
      • Validate company name appears in job title or URL
      • Reject jobs from unrelated companies
      • Maximum 100 jobs returned, deduplicated

  Code: services/job-service.js - _searchJobsWithJina(), _isCompanyJob()
  
  Data returned per job:
    {
      title: "Senior Software Engineer",
      department: "Engineering",
      location: "San Francisco, CA",
      type: "Full-time",
      level: "Senior",
      salary: "$150K - $220K",
      url: "https://linkedin.com/jobs/...",
      source: "linkedin-jina",  // Shows where found
      posted: "2 days ago"
    }

  Features:
    • Source attribution (shows which board job came from)
    • Department detection (Engineering, Sales, Marketing, etc.)
    • Job level inference (Junior, Mid, Senior, Staff)
    • Unlimited job display in sidebar
    • Clickable cards link to actual job listings


3.3 EMPLOYEE REVIEWS

  Feature: Aggregated employee reviews from multiple sources
  
  Review sources:
    • Glassdoor
    • Indeed
    • Local curated database

  How it works:
    LAYER 1: Local Curated Database
      • Pre-built database of major company reviews
      • Fast, no API calls needed
      
    LAYER 2: Web Scraping
      • Use Jina AI to fetch Glassdoor/Indeed review pages
      • Parse rating breakdowns (overall, work-life balance, compensation, etc.)
      • Extract individual employee review text
      
    LAYER 3: Jina Search
      • Search for reviews indirectly if direct scraping fails
      • Fall back to search results about company reviews

  Code: services/review-service.js - getEmployeeInsights()
  
  Data structure:
    {
      overall: 4.2,           // 1-5 stars
      workLife: 4.0,
      compensation: 4.3,
      management: 3.8,
      culture: 4.1,
      
      pros: [
        "Great work-life balance",
        "Competitive compensation",
        "Collaborative culture"
      ],
      cons: [
        "Limited growth opportunities",
        "High turnover"
      ],
      
      userReviews: [          // Individual reviews
        {
          author: "John D.",
          date: "2 weeks ago",
          rating: 4.5,
          title: "Great place to work",
          text: "Amazing culture...",
          source: "Glassdoor"
        }
      ]
    }

  UI Features:
    • Overall rating with star visualization
    • Five rating categories with progress bars
    • Stacked review source cards (Glassdoor, Indeed)
    • Individual review cards with author, date, rating, full text
    • Click review source cards to visit full review pages
    • "Verified Review" badge


3.4 COMPANY INFORMATION

  Feature: Basic company background and statistics
  
  Data collected:
    • Company name (official)
    • Industry classification
    • Headquarters location
    • Founded year
    • Employee count
    • Company description
    • Logo and website

  How it works:
    LAYER 1: Wikipedia API
      • Search Wikipedia for company article
      • Extract description, founding info
      • Reliable, curated source
      
    LAYER 2: Jina AI Search
      • Search for company info across web
      • Parse markdown for structured data
      • Extract industry, HQ, employee count from text
      
    LAYER 3: Defaults
      • If all else fails, provide educated defaults
      • Assume "Technology" industry if unknown
      • Link to company website for more details

  Code: services/company-service.js - getInfo()
  
  Data returned:
    {
      name: "OpenAI",
      logo: "https://logo.clearbit.com/openai.com",
      industry: "Artificial Intelligence",
      headquarters: "San Francisco, CA",
      founded: 2015,
      employeeCount: "700+",
      description: "OpenAI is a leading AI research company...",
      domain: "openai.com"
    }


3.5 INTERVIEW PREPARATION

  Feature: Links to interview prep resources
  
  Resources provided:
    • LeetCode company problems (company-specific)
    • GeeksforGeeks interview experiences
    • Instagram job hashtag search
    • Company-specific search links

  Code: services/interview-service.js - getInterviewResources()
  
  Data structure:
    {
      resources: [
        {
          title: "LeetCode Company Problems",
          url: "https://leetcode.com/company/openai/"
        },
        {
          title: "GeeksforGeeks Interview Experiences",
          url: "https://www.google.com/search?q=site:geeksforgeeks.org+..."
        }
      ]
    }


3.6 REAL-TIME WEB SCRAPING

  Feature: Live data from job boards and review sites (bypasses CORS, JS rendering)
  
  Technology: Jina AI (r.jina.ai and s.jina.ai)
    • Reader API (r.jina.ai): Fetch specific URL content as markdown
    • Search API (s.jina.ai): Search web and return markdown
    • Benefits:
      ✓ Bypasses CORS restrictions
      ✓ Bypasses JavaScript rendering needed
      ✓ Returns clean markdown (not HTML)
      ✓ Handles dynamic sites automatically
      ✓ No headless browser needed

  Code: services/web-scraper.js - WebScraperService

  Usage examples:
    // Search for jobs
    const markdown = await WebScraperService.search(
      'site:linkedin.com/jobs "OpenAI" jobs'
    );
    
    // Read specific page
    const markdown = await WebScraperService.read(
      'https://www.indeed.com/cmp/OpenAI/reviews'
    );

  Rate limiting:
    • Public: 30 requests per minute
    • Current auth key: Sufficient for extension use


3.7 DATA VALIDATION & COMPANY-SPECIFIC FILTERING

  Feature: Ensures jobs belong to the specified company
  
  Validation layers:
    1. Company name matching
       • Must contain company name in job title
       • OR company name in URL
       • OR URL from trusted job board with specific search
       
    2. URL source validation
       • Reject non-job URLs (blogs, news, forums)
       • Accept only job-related domains
       • Block suspicious sources
       
    3. Final deduplication
       • Remove duplicate job titles
       • Keep first occurrence
       • Maximum 100 jobs limit

  Methods:
    _isCompanyJob(title, companyName) - Checks if job title mentions company
    _isValidJobUrl(url, companyName, domain) - Validates URL is job-related
    Final filter ensures title + URL contain company reference

  Code: services/job-service.js


3.8 SMART SUPPLEMENTATION

  Feature: Ensures always enough jobs displayed
  
  Logic:
    1. Try page scraping (if on careers page)
    2. Try Jina job search across all boards
    3. If < 5 jobs found, supplement with Jina search
    4. If still no jobs, show "No jobs found" message
    
  Code: services/aggregator.js - getIntelligence()
  
  Threshold: Only supplement if fewer than 5 jobs (quality over quantity)

================================================================================
4. TECHNICAL IMPLEMENTATION DETAILS
================================================================================

4.1 EXTENSION MANIFEST (manifest.json v3)

Permissions:
  • activeTab: Access current tab
  • scripting: Inject and run scripts
  • notifications: Show desktop notifications
  • sidePanel: Create sidebar UI
  • storage: Save user preferences
  • <all_urls>: Host permissions for content scripts

Structure:
  • background.js: Service worker (replaces background page)
  • content.js: Content script (runs on web pages)
  • sidebar.html/js: Sidebar UI
  • popup.html/js: Extension popup
  • options.html/js: Settings page


4.2 SERVICE FILE ORGANIZATION

services/
  ├── company-service.js      - Company info (Wikipedia, Jina, defaults)
  ├── job-service.js          - Job discovery (10 platforms, Jina search)
  ├── review-service.js       - Employee reviews (Glassdoor, Indeed, local)
  ├── interview-service.js    - Interview prep links
  ├── web-scraper.js          - Jina AI wrapper (search + read)
  ├── ai-fallback.js          - DISABLED (stub for compatibility)
  └── aggregator.js           - Orchestrates all services


4.3 DATA FLOW IN CODE

User visits openai.com
    ↓
content.js detects company, sends message to background.js
    ↓
background.js triggers DataAggregator.getIntelligence()
    ↓
Aggregator calls services in parallel:
    ├→ CompanyService.getInfo() - Wikipedia, Jina, defaults
    ├→ JobService.getJobs() - DOM scrape + Jina search
    ├→ ReviewService.getEmployeeInsights() - Glassdoor, Indeed
    └→ InterviewService.getInterviewResources() - Links
    ↓
JobService supplements with Jina if < 5 jobs found
    ↓
Aggregator validates, deduplicates, fills defaults
    ↓
Result sent to sidebar.js for rendering
    ↓
sidebar.js creates card UI with animations


4.4 CHROME EXTENSION APIs USED

Runtime:
  • chrome.runtime.sendMessage() - IPC between scripts
  • chrome.runtime.onMessage - Listen for messages

Storage:
  • chrome.storage.local - Cache company data
  • chrome.storage.sync - User preferences across devices

Tabs:
  • chrome.tabs.query() - Get current tab
  • chrome.tabs.onActivated - Detect tab switch

SidePanel:
  • chrome.sidePanel.open() - Show sidebar
  • chrome.sidePanel.setPanelBehavior() - Configure panel


4.5 EXTERNAL API INTEGRATIONS

Jina AI (s.jina.ai and r.jina.ai):
  Endpoint: https://s.jina.ai/query (search)
  Endpoint: https://r.jina.ai/URL (read)
  Auth: Bearer token in headers
  Rate limit: 30 req/min (public)
  Cost: Free tier requires attribution, paid tier no limits

Wikipedia API:
  Endpoint: https://en.wikipedia.org/api/rest_v1/page/summary/TITLE
  Auth: None required
  Rate limit: Reasonable (no hard limit)
  Cost: Free

Clearbit (Logo Service):
  Endpoint: https://logo.clearbit.com/DOMAIN?size=128
  Auth: None required
  Cost: Free for non-commercial

Job Boards (scraped via Jina):
  ✓ No direct API used (goes through Jina)
  ✓ No robots.txt violations (Jina handles)
  ✓ No API keys needed


4.6 CACHING STRATEGY

Storage layers:
  1. In-memory (current session)
     • Page results cached in local variables
     • Cleared on page reload
     
  2. Chrome storage.local (persistent, extension-wide)
     • Company data cached for 24 hours
     • Job listings cached
     • Reduces redundant API calls
     
  3. Chrome storage.sync (cross-device)
     • User preferences
     • API keys (if any)

Cache invalidation:
  • company_jobs_{domain} expires after 12 hours
  • company_reviews_{domain} expires after 24 hours
  • Manual clear available in options page


4.7 ERROR HANDLING

Strategy: Graceful degradation

  LAYER 1: Try primary method
    └─ If fails, log warning, continue
    
  LAYER 2: Try fallback method
    └─ If fails, log warning, continue
    
  LAYER 3: Provide sensible default
    └─ Always show something useful even if all methods fail

Example (Job hunting):
  LAYER 1: DOM scrape careers page
    └─ Failed → No jobs on this page
    
  LAYER 2: Jina search across 10 job boards
    └─ Failed → Network issue or rate limit
    
  LAYER 3: Show "No jobs found" message
    └─ But also show review source cards so user can search manually


4.8 PERFORMANCE OPTIMIZATIONS

Parallel requests:
  • All services called simultaneously with Promise.all()
  • No sequential waiting
  
Lazy loading:
  • UI components only created when needed
  • Animations use CSS, not JavaScript

Caching:
  • Avoid re-scraping same company on same day
  • Local database for major companies

Request throttling:
  • Maximum 5 parallel Jina searches to avoid rate limits
  • 1-second delays between retry attempts

Memory efficiency:
  • Sidebar destroyed when closed
  • Service data cleared periodically
  • No large objects kept indefinitely


4.9 SECURITY CONSIDERATIONS

Data privacy:
  ✓ No personal data stored (except company names you visit)
  ✓ No tracking or analytics
  ✓ All data stays in browser except API calls to public services
  ✓ HTTPS enforced for external API calls

Permission minimization:
  ✓ Only requests permissions actually needed
  ✓ Doesn't scrape sensitive data (passwords, PII)
  ✓ Content scripts sandboxed from page

API security:
  ✓ Auth token for Jina stored in code (not user input)
  ✓ No sensitive data passed to external APIs
  ✓ Wikipedia API is read-only


================================================================================
5. UI/UX ARCHITECTURE
================================================================================

5.1 SIDEBAR LAYOUT

The extension creates a side panel with tabs:

┌─────────────────────────────────────────────────────────────────────┐
│                          OPENAI                                    │
│  👤 OpenAI | 🏆 4.2★ | 🌍 San Francisco, CA                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  📋 OPEN POSITIONS (42 jobs)                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Senior Software Engineer                         $150K-220K │   │
│  │ Engineering | San Francisco | Full-time | Senior           │   │
│  │ Posted 3 days ago                         [linkedin-jina] │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Product Manager                             $140K-180K     │   │
│  │ Product | NYC | Full-time | Mid-level                      │   │
│  │ Posted 1 day ago                           [indeed-jina]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  👥 REVIEWS & RATINGS                                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🏢 Glassdoor                                               │   │
│  │ Company Reviews                                         →   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 💼 Indeed                                                  │   │
│  │ Employee Reviews                                        →   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ⭐ OVERALL RATING: 4.2/5                                           │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │
│  Work-Life Balance ████████░░ 4.0                                   │
│  Compensation ████████░░ 4.3                                        │
│  Management ███████░░░ 3.8                                          │
│  Culture ████████░░ 4.1                                             │
│                                                                      │
│  👤 EMPLOYEE REVIEWS                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ John D. ★★★★★ 5.0                                   2 wks ago  │   │
│  │ "Amazing place to work!"                                    │   │
│  │ Great culture, competitive pay, world-class problems...     │   │
│  │ Source: Glassdoor | ✓ Verified Review                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ❓ INTERVIEW PREP                                                  │
│  • LeetCode Company Problems →                                     │
│  • GeeksforGeeks Interview Experiences →                           │
│  • Search job hashtags →                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘


5.2 STYLING & THEME

Color scheme (Dark theme):
  --bg-primary: #0f172a (Deep navy)
  --bg-card: #1e293b (Card background)
  --bg-card-hover: #334155 (On hover)
  --text-primary: #ffffff (Main text)
  --text-secondary: #cbd5e1 (Secondary text)
  --text-muted: #94a3b8 (Muted text)
  --border-accent: #3b82f6 (Blue accent)
  --shadow-card: 0 4px 12px rgba(0,0,0,0.3) (Depth)

Effects:
  • Glassmorphism: Frosted glass effect on cards
  • Smooth transitions: 0.2-0.3s ease
  • Hover animations: Scale, shadow, color change
  • Slide-in animations: Cards slide in from bottom
  • Gradient overlays: Subtle gradient on cards

Typography:
  • Headers: Bold, larger size
  • Body: Regular weight, readable size
  • Tags: Smaller, monospace for source attribution


5.3 INTERACTIVE ELEMENTS

Jobs:
  • Click job card → Opens job posting in new tab
  • Hover → Card lifts, shadow increases
  • Source badge → Identify which board job came from
  • Tags → Department, location, type color-coded

Reviews:
  • Click source card (Glassdoor/Indeed) → Opens full review page
  • Stars → Clickable to sort/filter in future
  • User reviews → Expandable, show full text
  • Verified badge → From official source

Rating bars:
  • Animated width change
  • Color-coded: Green (good) to Red (poor)
  • Tooltip on hover shows exact rating


5.4 LOADING STATES

Loading indicator:
  • Spinner animation while gathering data
  • "Analyzing Company..." message
  • Timeout after 10 seconds (show partial data)

Empty states:
  • "No jobs found" message with explanation
  • "No reviews available" with direct link
  • "Loading..." for slow connections

Error states:
  • Network error message
  • Suggestion to check internet
  • Offline mode with cached data


================================================================================
6. MAIN FEATURES IN DETAIL
================================================================================

6.1 AUTOMATIC COMPANY DETECTION

Triggers:
  • Page load on any company domain
  • Tab switch to company website
  • Manual trigger via popup icon

Logic:
  1. Extract domain from page URL
  2. Parse company name from domain using heuristics
  3. Remove common subdomains (www, careers, jobs, etc.)
  4. Capitalize properly (openai.com → OpenAI)
  5. Check if page has career-related keywords
  6. If match found → Show sidebar with data

Skip list (non-company sites):
  • Search engines (Google, Bing)
  • Social media (Facebook, LinkedIn profile page, Reddit)
  • Development tools (GitHub, Stack Overflow)
  • Email clients (Gmail, Outlook)
  • Productivity (Google Docs, Sheets, Drive)

Code: content.js - detectCompany(), shouldSkip()


6.2 MULTI-BOARD JOB AGGREGATION

Search strategy (parallel):
  1. LinkedIn Jobs: site:linkedin.com/jobs "CompanyName"
  2. Indeed: site:indeed.com "CompanyName" jobs
  3. Glassdoor: site:glassdoor.com/Job/CompanyName-Jobs
  4. Naukri: site:naukri.com "CompanyName" jobs
  5. Monster: site:monster.com "CompanyName" jobs
  6. Dice: site:dice.com "CompanyName" jobs
  7. CareerBuilder: site:careerbuilder.com "CompanyName" jobs
  8. SimplyHired: site:simplyhired.com "CompanyName" jobs
  9. ZipRecruiter: site:ziprecruiter.com "CompanyName" jobs
  10. Company site: site:company.com jobs

All searches run simultaneously for speed.

Validation:
  • Job title must mention company name OR
  • URL must contain company name OR
  • URL must be from trusted job board with specific search

Deduplication:
  • Compare job titles (case-insensitive)
  • Keep first occurrence
  • Maximum 100 jobs returned

Code: services/job-service.js


6.3 REVIEW AGGREGATION PIPELINE

Source priority:
  1. Local curated database (fastest)
     • Pre-built reviews for major companies
     • Optional (not all companies have it)
     
  2. Glassdoor + Indeed scraping (most comprehensive)
     • Visit pages directly via Jina
     • Extract ratings and reviews
     
  3. Search-based fallback (last resort)
     • Search for reviews if direct scraping fails
     • Less accurate but better than nothing

Data points extracted:
  • Overall rating (1-5 stars)
  • Category ratings:
    - Work-Life Balance
    - Compensation
    - Management / Leadership
    - Culture
  • Pros and cons list
  • Individual review excerpts:
    - Reviewer name/title
    - Rating
    - Date posted
    - Review text
    - Company flagging (verified, anonymous, etc.)

Code: services/review-service.js


6.4 COMPANY INFORMATION GATHERING

Wikipedia approach:
  • Search Wikipedia for company article
  • Extract description, founding year
  • Return formatted company object

Jina Search approach:
  • Search for company info across web
  • Parse markdown for key information
  • Extract using regex patterns:
    - Industry keywords
    - Headquarters location
    - Founded year
    - Employee count

Default fallback:
  • If no data found, provide educated defaults
  • Assume technology industry (adjustable)
  • Link to company website

Code: services/company-service.js

Data quality:
  • Wikipedia: High quality, curated
  • Jina Search: Good, from multiple sources
  • Defaults: Safe, won't mislead user


6.5 INTERVIEW PREPARATION

Resource types:
  1. LeetCode Company Problems
     • Link to company-specific problem set
     • Curated problems asked in interviews
     
  2. GeeksforGeeks Interview Experiences
     • Real interview experiences from users
     • Pattern-based insights
     
  3. Social media search
     • Instagram job hashtag search
     • Community discussions

Data provided:
  • Direct links to resources
  • Company-specific URLs
  • Search queries for discovering more

Code: services/interview-service.js

Limitations:
  • Only provides links, not actual problems
  • Relies on external resources being available
  • No guarantee problems are current


6.6 SMART CACHING

Motivation:
  • Avoid repeated API calls for same company
  • Reduce load times on repeated visits
  • Save API quota

Implementation:
  • Chrome storage.local for persistent cache
  • Cache duration: 12-24 hours per data type
  • Automatic invalidation after duration

Cache keys:
  • company_info_{domain}
  • company_jobs_{domain}
  • company_reviews_{domain}

Code: aggregator.js, content.js


================================================================================
7. SYSTEM LIMITATIONS
================================================================================

7.1 TECHNICAL LIMITATIONS

Network dependencies:
  • Requires internet connection for live data
  • Jina API rate limit: 30 requests/minute on free tier
  • Wikipedia API may be slow in some regions
  • Job board responses vary in structure (hard to parse)

Scraping limitations:
  • Some sites have strict robots.txt (respected by Jina)
  • Some job boards require authentication (can't scrape)
  • Dynamic content may not be fully captured
  • JavaScript-rendered content might be missed

Data accuracy:
  • Job postings change frequently (may show expired jobs)
  • Reviews may be outdated
  • Company information may be incorrect if Wikipedia/Jina is wrong
  • No guarantee of fresh data (cache may be old)


7.2 FUNCTIONAL LIMITATIONS

Job discovery:
  • Only major job boards supported (10+ platforms)
  • Small/niche job boards not included
  • Internal job portals not accessible
  • May miss specialized roles on industry-specific sites

Review data:
  • Only Glassdoor and Indeed reviews
  • Other review sites (Levels.fyi, Blind, etc.) not included
  • Reviews may be biased (only very happy/unhappy people post)
  • No real-time rating updates

Interview prep:
  • Only provides links, not actual practice
  • Company-specific problems depend on LeetCode data
  • No customization based on role or level

Company matching:
  • Generic domain names (startup.io) may not be recognized
  • Company name extraction not 100% accurate for all domains
  • No manual company selection option (future enhancement)


7.3 CONTENT LIMITATIONS

Incomplete data:
  • May not find any jobs for startup companies
  • Early-stage companies may have no reviews
  • Niche companies may not have Wikipedia articles
  • International companies may have limited reviews (English-only)

Geographic coverage:
  • Job boards may be region-specific
  • Review data skewed toward major US companies
  • International company data less complete

Language support:
  • Currently English-only
  • Reviews in other languages not supported


7.4 EXTENSION BEHAVIOR LIMITATIONS

Popup interface:
  • Can't modify how extension works at runtime
  • No advanced filters or search in sidebar
  • No note-taking or bookmarking feature
  • No export/sharing functionality

Performance:
  • First load may take 3-10 seconds (gathering data)
  • Large job lists (100+) may scroll slowly
  • Animation-heavy (might be slow on older devices)

Compatibility:
  • Chrome/Chromium browsers only
  • Not available for Firefox, Safari yet
  • No mobile browser support


7.5 API LIMITATIONS

Jina AI:
  • Free tier: 30 requests/minute
  • May be blocked by some servers (respects robots.txt)
  • Authorization token embedded (security consideration)

Wikipedia:
  • May not have articles for newer companies
  • Information may be outdated
  • Disambiguation pages handled but can fail

Clearbit Logo:
  • Free tier with limitations
  • May return generic logo for unknown companies
  • May fail for very new companies


================================================================================
8. FUTURE ENHANCEMENTS
================================================================================

8.1 SHORT-TERM ENHANCEMENTS (1-3 months)

1. Advanced Job Filtering
   • Filter by location, salary, job level
   • Search jobs by keyword within results
   • Sort by date posted, salary, relevance
   
   Implementation:
   • Add filter UI in sidebar
   • Client-side filtering (no new API calls)
   • Persistence in local storage

2. Salary Scraping
   • Extract salary ranges from job listings
   • Show salary statistics (average, range)
   • Salary comparison across roles
   
   Implementation:
   • Enhance job parsing in job-service.js
   • Regex extraction from markdown
   • Display in job cards

3. Interview Question Database
   • Build database of actual interview questions
   • Associate with company and role
   • Difficulty ratings and solutions
   
   Implementation:
   • New interview-questions.js service
   • Local database (JSON file)
   • Display in interview panel

4. Notification Improvements
   • Desktop notifications for new jobs
   • Email digest daily/weekly
   • Custom alerts for job keywords
   
   Implementation:
   • chrome.notifications API
   • Optional email integration


8.2 MEDIUM-TERM ENHANCEMENTS (3-6 months)

1. Multi-Language Support
   • Support French, Spanish, German, etc.
   • Translate reviews/job listings
   • Localized UI
   
   Implementation:
   • i18n framework
   • Google Translate API
   • Language selector in options

2. Firefox Support
   • Port to Firefox WebExtensions API
   • Same feature parity as Chrome
   
   Implementation:
   • Refactor to use WebExtensions standard APIs
   • Test on Firefox
   • Publish to Firefox Add-ons store

3. Advanced Review Analytics
   • Sentiment analysis of reviews
   • Topic clustering (what people talk about)
   • Trends over time (is company improving?)
   
   Implementation:
   • NLP library integration
   • Chart visualization
   • Trend detection algorithm

4. Salary Benchmarking
   • Compare your salary to company average
   • Negotiate insights based on market data
   • Salary progression tracking
   
   Implementation:
   • Median salary calculation
   • Database of salaries by role/location
   • Confidential (user-submitted data)

5. Company Comparison
   • Compare multiple companies side-by-side
   • Which is better for your profile?
   • Pros/cons comparison matrix
   
   Implementation:
   • Multi-select workflow
   • Comparison table UI
   • Score calculation


8.3 LONG-TERM ENHANCEMENTS (6-12 months)

1. AI-Powered Interview Coaching
   • Practice mock interviews via video
   • Get feedback on answers
   • Track improvement over time
   
   Implementation:
   • LLM integration (GPT-4 or similar)
   • Speech-to-text for answers
   • Scoring algorithm

2. Personalized Job Recommendations
   • Learn user preferences
   • Recommend best-fit companies
   • Suggest roles based on background
   
   Implementation:
   • User profile creation
   • ML recommendation engine
   • Privacy-preserving (local model)

3. Career Path Planning
   • Map progression at specific company
   • See what roles lead where
   • Timeline estimates
   
   Implementation:
   • Career ladder scraping
   • Graph visualization
   • Machine learning patterns

4. Job Application Tracking
   • Track applications inside extension
   • Set reminders for follow-ups
   • Store notes per company
   
   Implementation:
   • Note-taking UI
   • Calendar integration
   • Data export

5. Glassdoor/Indeed Data Integration
   • Official API integration (if available)
   • Deeper data access
   • Real-time updates
   
   Implementation:
   • OAuth authentication
   • API client library
   • Premium features

6. Community Features
   • Share interview experiences
   • Q&A about companies
   • Anonymous discussion forum
   
   Implementation:
   • Backend server
   • User authentication
   • Moderation system


8.4 INFRASTRUCTURE ENHANCEMENTS

1. Backend Server
   • Cache data server-side
   • Reduce client-side processing
   • Enable advanced features
   
   Implementation:
   • Node.js/Python backend
   • Database (PostgreSQL)
   • REST API

2. Database
   • Store historical job data
   • Track job opening trends
   • Build historical database
   
   Implementation:
   • PostgreSQL database
   • Scheduled ETL jobs
   • Analytics queries

3. Algorithm Improvements
   • Better job board scraping
   • Smarter company matching
   • Improved review parsing
   
   Implementation:
   • ML for job classification
   • NER for company extraction
   • Better regex patterns


8.5 MONETIZATION PATHS

1. Freemium Model
   • Free: Basic job + review search
   • Premium: Advanced filters, salary data, comparisons
   • Cost: $2.99/month or $19.99/year
   
2. B2B Partnerships
   • API for job boards
   • Data licensing
   • White-label solution

3. Sponsorships
   • Job board promotion (non-invasive)
   • Career service advertisements
   • Course recommendations

4. Premium Tier
   • Early access to new jobs
   • Unlimited company comparisons
   • Priority support


================================================================================
9. DEVELOPMENT ROADMAP
================================================================================

Current Version: 12.0 (Released March 2026)

✅ Completed Features:
  ✓ Company detection
  ✓ Multi-board job scraping (10+ boards)
  ✓ Review aggregation (Glassdoor + Indeed)
  ✓ Interview prep links
  ✓ Company information lookup
  ✓ Jina AI integration for scraping
  ✓ Sidebar UI with card layouts
  ✓ Dark theme & animations
  ✓ Caching system
  ✓ Error handling & graceful degradation

Version 13.0 (Next Quarter)
Planned features:
  • Job filtering (location, salary, level)
  • Salary data extraction
  • Advanced review analytics
  • Interview questions database
  • Firefox support

Version 14.0 (6 months out)
Planned features:
  • Multi-language support
  • Sentiment analysis of reviews
  • Company comparison feature
  • Job application tracking
  • Backend server for caching

Version 15.0+ (12+ months)
Planned features:
  • AI interview coaching
  • Career path planning
  • Personalized recommendations
  • Community features
  • Mobile support


================================================================================
10. TESTING & QUALITY ASSURANCE
================================================================================

10.1 TESTING STRATEGY

Unit tests:
  • Test each service independently
  • Mock Jina API responses
  • Test data validation functions
  
  Example:
    test('_isCompanyJob should match exact company name', () => {
      const result = JobService._isCompanyJob(
        'Senior Engineer at OpenAI',
        'OpenAI'
      );
      expect(result).toBe(true);
    });

Integration tests:
  • Test service communication
  • Mock storage layer
  • Verify data flow
  
  Example:
    test('should aggregate company data correctly', async () => {
      const result = await DataAggregator.getIntelligence(
        'OpenAI', 'openai.com'
      );
      expect(result.jobs.length).toBeGreaterThan(0);
      expect(result.reviews).toBeDefined();
    });

E2E tests:
  • Test full user flow
  • Use real browser
  • Visit actual company websites
  
  Example:
    test('should show sidebar with data on company website', async () => {
      await page.goto('https://openai.com');
      await page.waitForSelector('.sidebar-container');
      const jobCount = await page.$(
        '.job-card'
      ).length;
      expect(jobCount).toBeGreaterThan(0);
    });

Manual testing:
  • Test on various company websites
  • Verify UI appearance
  • Check animations on different devices
  • Test in different Chrome versions


10.2 QUALITY METRICS

Performance:
  • Page load time: < 3 seconds
  • First data display: < 5 seconds
  • Job search: < 10 seconds

Reliability:
  • Zero crashes on any domain
  • Graceful fail if APIs fail
  • Error rate: < 0.1%

User experience:
  • Sidebar loading animation visible
  • Smooth animations @ 60 FPS
  • No visual glitches
  • Responsive on all screen sizes


10.3 COMPATIBILITY TESTING

Browser compatibility:
  • Chrome 110+
  • Chromium 110+
  • Edge 110+

OS compatibility:
  • Windows 10+
  • macOS 10.15+
  • Linux (Ubuntu 20.04+)

Device testing:
  • Desktop (1080p)
  • Laptop (1366x768)
  • High DPI (4K)
  • Low DPI (laptop)


================================================================================
11. DEPLOYMENT & MAINTENANCE
================================================================================

11.1 DEPLOYMENT PROCESS

Version release:
  1. Code review & testing
  2. Update version in manifest.json
  3. Update CHANGELOG
  4. Test on Chrome Web Store (staging)
  5. Submit to Chrome Web Store
  6. Approval review (1-3 days)
  7. Release to production

Release notes:
  • Feature additions
  • Bug fixes
  • Performance improvements
  • Known issues

Rollback plan:
  • Keep previous version available
  • Can revert if major issues found


11.2 MONITORING & ANALYTICS

User metrics:
  • Active users
  • Daily active users
  • Retention rate
  • Feature usage

Error tracking:
  • Crash reports
  • API failure rates
  • Service downtime

Performance monitoring:
  • Load times
  • API response times
  • Cache hit rates


11.3 MAINTENANCE TASKS

Regular maintenance:
  • Monitor Jina API status
  • Check job board data quality
  • Update company database
  • Fix bugs as reported

Quarterly updates:
  • Add new job boards
  • Improve scraping logic
  • Update UI/UX
  • Performance optimizations

Annual review:
  • Assess roadmap progress
  • User feedback integration
  • Feature deprecation
  • Tech debt reduction


================================================================================
12. SECURITY & PRIVACY
================================================================================

12.1 DATA SECURITY

Data at rest:
  • Chrome storage.local: Browser handles encryption
  • No sensitive data stored
  • Only company names and cached data

Data in transit:
  • HTTPS enforced for all external APIs
  • No sensitive data sent to external services
  • Jina auth token in code (considered low-risk token)

Authentication:
  • No user authentication required
  • API tokens embedded in code (low-value tokens)
  • No user accounts or login


12.2 PRIVACY PROTECTION

User data:
  • No tracking or analytics
  • No personal information collected
  • No cookies or fingerprinting
  • No data shared with third parties

Content script security:
  • Scripts isolated from page context
  • Can't be accessed by page JavaScript
  • CORS protections enforced

Permissions:
  • Minimal permissions requested
  • Only uses permissions when needed
  • No hidden background activities


12.3 THIRD-PARTY SERVICES

Jina AI:
  • Public API service
  • No PII transmitted
  • Search queries may be logged (acceptable)
  • GDPR-compliant

Wikipedia:
  • Public API
  • No authentication needed
  • Read-only access

Clearbit:
  • Logo service
  • No PII transmitted
  • Free tier acceptable for extension


================================================================================
13. TROUBLESHOOTING & FAQ
================================================================================

13.1 COMMON ISSUES

Issue: No jobs found
  Cause: Company not detected, or no jobs on job boards
  Solution:
    • Check domain is recognized as company website
    • Try company name in search manually
    • Check if company is hiring at all
    • May need to visit LinkedIn/Indeed directly

Issue: Reviews not loading
  Cause: Glassdoor/Indeed pages not accessible to Jina
  Solution:
    • Click review source cards to visit sites directly
    • Manual review search often faster
    • Try again later (may be rate limited)

Issue: Sidebar not appearing
  Cause: Domain skipped, extension disabled, or permission denied
  Solution:
    • Check if domain is on skip list
    • Re-enable extension in Chrome settings
    • Grant permission to chrome extension
    • Reload page

Issue: Slow loading
  Cause: Network slow, Jina API rate limited, or too many requests
  Solution:
    • Check internet connection
    • Wait a minute (rate limit resets)
    • Close other tabs (reduce overhead)
    • Clear cache in options


13.2 PERFORMANCE TIPS

For faster results:
  • Visit job boards directly (cached data)
  • Use narrow search queries (more specific)
  • Clear extension cache monthly
  • Disable other extensions (reduce lag)

For better results:
  • Try during off-peak hours (fewer API calls)
  • Visit company LinkedIn first (data already ranked)
  • Check Indeed/Glassdoor for verified reviews
  • Read multiple reviews for balanced view


13.3 ADVANCED USAGE

Manual cache clear:
  • Open extension options
  • Click "Clear Cache" button
  • Reload sidebar to get fresh data

API token issues:
  • If Jina stops working, token may have changed
  • Contact support for updated token
  • Fallback still works (less data)

Custom skip list:
  • Edit SKIP_DOMAINS in content.js for personal preference
  • Some sites can be excluded from detection


================================================================================
14. GLOSSARY OF TERMS
================================================================================

API: Application Programming Interface
  • Interface for software to communicate
  • Jina AI, Wikipedia, Clearbit APIs used

Caching:
  • Storing data locally to avoid repeated requests
  • Improves performance, reduces API calls

CORS (Cross-Origin Resource Sharing):
  • Browser security feature preventing scripts from accessing other domains
  • Jina AI bypasses this by being a proxy

DOM (Document Object Model):
  • Structure of a webpage's HTML
  • Extension can read and modify DOM

Jina AI:
  • Web scraping service (s.jina.ai search, r.jina.ai read)
  • Returns page content as Markdown
  • Handles JavaScript rendering

Markdown:
  • Simple text format used by Jina
  • Easy to parse for structured data

Rate limit:
  • Maximum requests allowed per time period
  • Jina: 30 requests/minute (free)

HTTPS:
  • Encrypted web protocol
  • Required for secure data transfer

Sidebar (Side Panel):
  • The panel that appears on the side of the browser
  • Contains all the extension's UI

Service:
  • Background code that providers specific functionality
  • Examples: JobService, ReviewService, CompanyService

Service Worker:
  • Background process that stays alive
  • Used instead of background page in Manifest V3

Web Scraping:
  • Extracting data from websites programmatically
  • Used for job listings and reviews

================================================================================
15. CONCLUSION
================================================================================

Company Job Intelligence is a powerful Chrome extension that brings comprehensive
career intelligence directly to company websites. By combining multiple data
sources (web scraping, public APIs, local caching) and using intelligent
validation, it provides reliable job and review data without requiring users to
navigate multiple sites.

The system is designed with:
  ✓ User privacy as priority (no tracking, minimal data collection)
  ✓ Performance in mind (parallel requests, smart caching)
  ✓ Resilience (layered fallbacks, graceful degradation)
  ✓ Extensibility (modular service architecture)

The current version (12.0) focuses on core functionality. Future versions will
add advanced features like salary benchmarking, company comparison, and AI-powered
interviewing.

The open roadmap allows for continuous improvement based on user feedback and
market needs.

================================================================================
END OF DOCUMENT
================================================================================
