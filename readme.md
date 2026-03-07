# 🚀 Company Job Intelligence

**Real-time career insights, delivered the moment you visit a company website.**

Company Job Intelligence is a Chrome Extension (Manifest V3) that turns any corporate website into a goldmine of career data. It intelligently detects the company you're browsing and instantly aggregates jobs, employee reviews, and interview prep—no API keys or accounts required.

---

## ✨ Key Features

### 🕵️ Smart Company Detection

Works on **any** domain. Whether you are on `openai.com` or a niche startup, the extension identifies the company and pulls relevant data automatically.

### 📋 Multi-Board Job Aggregator

Find open positions across **10+ major platforms** simultaneously:

* LinkedIn, Indeed, Glassdoor, Naukri, Monster, Dice, and more.
* **Validation:** Smart filtering ensures jobs actually belong to the company you're viewing.
* **Supplementation:** If fewer than 5 jobs are found on-page, it searches the web in real-time to fill the gap.

### 👥 Employee Insights & Reviews

Get the "real story" before you apply:

* **Aggregated Ratings:** Work-life balance, compensation, and culture scores.
* **Review Stream:** Recent verified reviews from Glassdoor and Indeed.
* **Pros & Cons:** Quick-glance summaries of employee sentiment.

### ❓ Interview Preparation

Direct access to company-specific prep resources:

* **LeetCode:** Direct links to company-tagged coding problems.
* **GeeksforGeeks:** Real-world interview experiences.
* **Social Intelligence:** Links to recent job discussions on social platforms.

---

## 🛠️ Technical Architecture

The extension follows an **"Offline-First, Search-Enhanced"** philosophy.

### Core Components

* **Data Aggregator:** Orchestrates multiple services in parallel using `Promise.all()` for maximum speed.
* **Jina AI Integration:** Uses Jina’s Reader and Search APIs to bypass CORS and scrape dynamic content as clean Markdown.
* **Wikipedia API:** Provides verified, high-quality company backgrounds and stats.
* **Local Caching:** Uses `chrome.storage.local` to cache company data for 24 hours, reducing API calls and improving load times.

---

## 🎨 UI & UX

* **Glassmorphism Design:** A modern, dark-themed sidebar that blends into any website.
* **Smooth Animations:** CSS-driven transitions for a premium, lightweight feel.
* **Source Transparency:** Every job and review is tagged with its original source.

---

## 🛡️ Privacy & Security

* **No Tracking:** No personal data is collected or stored.
* **Permission-Light:** Only requests access to the websites you actively visit.
* **Secure:** All external data fetching is handled via HTTPS.

---

## 🚀 Getting Started

1. **Clone the repo:** `git clone https://github.com/your-repo/job-intelligence`
2. **Load in Chrome:** Go to `chrome://extensions`, enable "Developer mode," and click "Load unpacked."
3. **Browse:** Visit any company website (e.g., `apple.com`) and watch the sidebar come to life.
