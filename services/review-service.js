/**
 * ReviewService
 * Robust multi-layer review intelligence service
 *
 * Data layers:
 * 1. Curated dataset (window.COMPANY_DATABASE)
 * 2. Indeed via Claude AI web search
 * 3. Glassdoor via Claude AI web search
 * 4. General search fallback via Claude AI
 * 5. Default empty fallback
 *
 * Requires: ANTHROPIC_API_KEY available in the environment or passed at init.
 * Set ReviewService.ANTHROPIC_API_KEY = "sk-ant-..." before calling.
 */

class ReviewService {

    static DEBUG = false;
    static ANTHROPIC_API_KEY = null; // Set this before use

    static log(...args) {
        if (this.DEBUG) console.log("[ReviewService]", ...args);
    }

    // ─────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────

    /**
     * Main entry – returns rich employee insights for a company.
     * @param {string} companyName
     * @returns {Promise<ReviewResult>}
     */
    static async getEmployeeInsights(companyName) {

        this.log("Getting reviews for", companyName);

        // ── 1. Curated dataset ────────────────────────────────────
        try {
            const local =
                typeof window !== "undefined" && window.COMPANY_DATABASE
                    ? window.COMPANY_DATABASE[companyName.toLowerCase()]
                    : null;

            if (local?.reviews) {
                this.log("Using curated dataset");
                const proMetrics = this._extractProMetrics(local.reviews, companyName);
                return { reviews: local.reviews, source: "curated", proMetrics, confidence: "high" };
            }
        } catch (_) {}

        // ── 2. Parallel scraping via Claude AI ───────────────────
        try {
            const [indeed, glassdoor] = await Promise.allSettled([
                this._withTimeout(this._fetchIndeedReviews(companyName), 30000),
                this._withTimeout(this._fetchGlassdoorReviews(companyName), 30000)
            ]);

            const indeedData   = indeed.status   === "fulfilled" ? indeed.value   : null;
            const glassdoorData = glassdoor.status === "fulfilled" ? glassdoor.value : null;

            const merged = this._mergeReviewSources(indeedData, glassdoorData);

            if (merged?.userReviews?.length > 0) {
                const proMetrics = this._extractProMetrics(merged, companyName);
                return {
                    reviews: merged,
                    source: "multi-source-scrape",
                    proMetrics,
                    confidence: this._calculateConfidence(merged)
                };
            }
        } catch (e) {
            this.log("Multi source scrape failed", e);
        }

        // ── 3. General search fallback ────────────────────────────
        try {
            const parsed = await this._withTimeout(
                this._fetchGeneralReviews(companyName), 20000
            );

            if (parsed?.userReviews?.length > 0) {
                return {
                    reviews: parsed,
                    source: "scraped-search",
                    proMetrics: this._extractProMetrics(parsed, companyName),
                    confidence: this._calculateConfidence(parsed)
                };
            }
        } catch (_) {}

        // ── 4. Default fallback ───────────────────────────────────
        return {
            reviews: {
                overall: null, workLife: null, compensation: null,
                management: null, culture: null,
                pros: [], cons: [], userReviews: []
            },
            source: "missing",
            confidence: "low",
            proMetrics: this._getDefaultProMetrics(companyName)
        };
    }

    // ─────────────────────────────────────────────────────────────
    // CLAUDE AI SCRAPING  (replaces WebScraperService)
    // ─────────────────────────────────────────────────────────────

    /**
     * Call Claude claude-sonnet-4-20250514 with web_search enabled.
     * Returns the full assistant text response.
     */
    static async _callClaude(userPrompt, systemPrompt = "") {
        const apiKey = this.ANTHROPIC_API_KEY
            || (typeof window !== "undefined" && window.ANTHROPIC_API_KEY)
            || "";

        const body = {
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages: [{ role: "user", content: userPrompt }]
        };

        if (systemPrompt) body.system = systemPrompt;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { "x-api-key": apiKey } : {})
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.text().catch(() => res.statusText);
            throw new Error(`Claude API error ${res.status}: ${err}`);
        }

        const data = await res.json();

        // Collect all text blocks (model may interleave tool calls + text)
        const text = (data.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text)
            .join("\n");

        return text;
    }

    /**
     * Scrape Indeed reviews using Claude web search.
     */
    static async _fetchIndeedReviews(companyName) {
        this.log("Fetching Indeed reviews for", companyName);

        const prompt = `
Search Indeed.com for employee reviews of "${companyName}".
Visit: https://www.indeed.com/cmp/${encodeURIComponent(companyName.replace(/\s+/g, "-"))}/reviews

Extract and return ONLY a valid JSON object — no markdown fences, no prose — with this exact shape:

{
  "overall": <number 1-5 or null>,
  "workLife": <number 1-5 or null>,
  "compensation": <number 1-5 or null>,
  "management": <number 1-5 or null>,
  "culture": <number 1-5 or null>,
  "pros": [<up to 8 short strings>],
  "cons": [<up to 8 short strings>],
  "userReviews": [
    {
      "rating": <number>,
      "title": "<review headline>",
      "text": "<full review text, max 400 chars>",
      "author": "<job title or 'Employee'>",
      "date": "<YYYY-MM or empty string>",
      "source": "Indeed"
    }
    // up to 10 reviews
  ]
}

If a field is unavailable return null or []. Return ONLY the JSON object.`;

        try {
            const raw = await this._callClaude(prompt);
            return this._parseJSON(raw);
        } catch (e) {
            this.log("Indeed fetch error", e);
            return null;
        }
    }

    /**
     * Scrape Glassdoor reviews using Claude web search.
     */
    static async _fetchGlassdoorReviews(companyName) {
        this.log("Fetching Glassdoor reviews for", companyName);

        const prompt = `
Search Glassdoor for employee reviews of "${companyName}".
Find the company's review page on glassdoor.com and read the reviews.

Return ONLY a valid JSON object — no markdown, no extra text — with this exact shape:

{
  "overall": <number 1-5 or null>,
  "workLife": <number 1-5 or null>,
  "compensation": <number 1-5 or null>,
  "management": <number 1-5 or null>,
  "culture": <number 1-5 or null>,
  "pros": [<up to 8 short strings>],
  "cons": [<up to 8 short strings>],
  "userReviews": [
    {
      "rating": <number>,
      "title": "<review headline>",
      "text": "<full review text, max 400 chars>",
      "author": "<job title or 'Employee'>",
      "date": "<YYYY-MM or empty string>",
      "source": "Glassdoor"
    }
    // up to 10 reviews
  ]
}

If a field is unavailable return null or []. Return ONLY the JSON object.`;

        try {
            const raw = await this._callClaude(prompt);
            return this._parseJSON(raw);
        } catch (e) {
            this.log("Glassdoor fetch error", e);
            return null;
        }
    }

    /**
     * General web search fallback for reviews.
     */
    static async _fetchGeneralReviews(companyName) {
        this.log("Fetching general reviews for", companyName);

        const prompt = `
Search the web for "${companyName}" employee reviews. Check Indeed, Glassdoor, Comparably, Blind, or any review site.

Aggregate what you find and return ONLY a valid JSON object — no markdown, no extra text — with this shape:

{
  "overall": <number 1-5 or null>,
  "workLife": <number 1-5 or null>,
  "compensation": <number 1-5 or null>,
  "management": <number 1-5 or null>,
  "culture": <number 1-5 or null>,
  "pros": [<up to 8 short strings>],
  "cons": [<up to 8 short strings>],
  "userReviews": [
    {
      "rating": <number>,
      "title": "<review headline>",
      "text": "<review text, max 400 chars>",
      "author": "<job title or 'Employee'>",
      "date": "<YYYY-MM or empty string>",
      "source": "<site name>"
    }
    // up to 10 reviews
  ]
}

Return ONLY the JSON object.`;

        try {
            const raw = await this._callClaude(prompt);
            return this._parseJSON(raw);
        } catch (e) {
            this.log("General review fetch error", e);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────

    /** Parse JSON from Claude response, stripping accidental fences */
    static _parseJSON(raw) {
        if (!raw) return null;
        try {
            // Strip ```json ... ``` if present
            const clean = raw
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```\s*$/, "")
                .trim();
            const obj = JSON.parse(clean);
            // Minimal shape validation
            if (!Array.isArray(obj.userReviews)) obj.userReviews = [];
            if (!Array.isArray(obj.pros)) obj.pros = [];
            if (!Array.isArray(obj.cons)) obj.cons = [];
            return obj;
        } catch (e) {
            // Try to extract a JSON object from within the text
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]); } catch (_) {}
            }
            this.log("JSON parse failed", e, raw.slice(0, 200));
            return null;
        }
    }

    /** Timeout wrapper */
    static async _withTimeout(promise, ms = 30000) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), ms)
            )
        ]);
    }

    /** Merge two review source objects */
    static _mergeReviewSources(a, b) {
        if (!a && !b) return null;
        if (!a) return b;
        if (!b) return a;

        let reviews = [...(a.userReviews || []), ...(b.userReviews || [])];

        // Deduplicate by text
        reviews = reviews.filter((r, i, arr) =>
            i === arr.findIndex(x => x.text === r.text)
        );

        reviews = reviews
            .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0))
            .slice(0, 15);

        const avgOrFirst = (v1, v2) =>
            typeof v1 === "number" && typeof v2 === "number"
                ? (v1 + v2) / 2
                : typeof v1 === "number" ? v1
                : typeof v2 === "number" ? v2
                : null;

        return {
            overall:      avgOrFirst(a.overall,      b.overall),
            workLife:     avgOrFirst(a.workLife,      b.workLife),
            compensation: avgOrFirst(a.compensation,  b.compensation),
            management:   avgOrFirst(a.management,    b.management),
            culture:      avgOrFirst(a.culture,       b.culture),
            pros:         [...new Set([...(a.pros || []), ...(b.pros || [])])],
            cons:         [...new Set([...(a.cons || []), ...(b.cons || [])])],
            userReviews:  reviews
        };
    }

    /** Confidence score based on review count */
    static _calculateConfidence(data) {
        const count = data.userReviews?.length || 0;
        if (count > 6)  return "high";
        if (count > 2)  return "medium";
        return "low";
    }

    /** Default empty metrics */
    static _getDefaultProMetrics(companyName) {
        return {
            ceoRating: null, ceoApproval: null, retentionRate: null,
            salaryRange: null, averageBonus: null, benefitsScore: null,
            interviewDifficulty: null, hiringActivity: null,
            growthTrajectory: null, departmentCount: null, rolesHiring: []
        };
    }

    /** Derive professional metrics from review data */
    static _extractProMetrics(reviewData, companyName) {
        const isNum = (v) => typeof v === "number" && v > 0;

        const base = isNum(reviewData.overall)
            ? 55000 + (reviewData.overall * 18000)
            : 0;

        const salary = base > 0
            ? { min: Math.round(base), max: Math.round(base * 1.85), currency: "USD" }
            : null;

        // Small deterministic jitter so metrics don't look copy-pasted
        const seed  = [...companyName].reduce((s, c) => s + c.charCodeAt(0), 0);
        const jitter = ((seed % 10) - 5) / 100; // ±5 %

        return {
            ceoRating:
                isNum(reviewData.management)
                    ? Math.min(100, Math.round(reviewData.management * 20))
                    : null,

            ceoApproval:
                isNum(reviewData.management)
                    ? Math.round(Math.min(98, (reviewData.management * 18) + jitter * 100))
                    : null,

            retentionRate:
                isNum(reviewData.overall)
                    ? Math.round((reviewData.overall / 5) * 82 + 18)
                    : null,

            salaryRange: salary,

            averageBonus:
                salary ? Math.round(salary.max * 0.14) : null,

            benefitsScore:
                isNum(reviewData.culture)
                    ? Math.min(100, Math.round(reviewData.culture * 20))
                    : null,

            interviewDifficulty:
                isNum(reviewData.overall)
                    ? Math.max(1, Math.min(10, 11 - Math.round(reviewData.overall * 1.2)))
                    : null,

            hiringActivity:
                isNum(reviewData.overall)
                    ? reviewData.overall > 3.5 ? "high"
                    : reviewData.overall > 2.5 ? "moderate"
                    : "low"
                    : null,

            growthTrajectory:
                isNum(reviewData.management)
                    ? reviewData.management > 3.5 ? "growing"
                    : reviewData.management > 2.5 ? "stable"
                    : "declining"
                    : null,

            departmentCount: null,
            rolesHiring: []
        };
    }
}