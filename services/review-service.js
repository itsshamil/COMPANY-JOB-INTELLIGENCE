/**
 * ReviewService
 *
 * Multi-source employee review intelligence
 *
 * Sources:
 * 1. Indeed
 * 2. Glassdoor
 * 3. Web search fallback
 *
 * Uses FREE Jina AI endpoints:
 * https://r.jina.ai/{url}
 * https://s.jina.ai/{query}
 */

class ReviewService {

    static DEBUG = false;

    static log(...args) {
        if (this.DEBUG) console.log("[ReviewService]", ...args);
    }

    // ------------------------------------------------------------
    // JINA HELPERS
    // ------------------------------------------------------------

    static async _jinaRead(url) {

        const endpoint = `https://r.jina.ai/${url}`;

        const res = await fetch(endpoint, {
            headers: {
                "Accept": "text/plain",
                "X-Return-Format": "markdown"
            }
        });

        if (!res.ok) throw new Error("Jina read failed");

        return res.text();
    }

    static async _jinaSearch(query) {

        const endpoint = `https://s.jina.ai/${encodeURIComponent(query)}`;

        const res = await fetch(endpoint, {
            headers: {
                "Accept": "text/plain",
                "X-Return-Format": "markdown"
            }
        });

        if (!res.ok) throw new Error("Jina search failed");

        return res.text();
    }

    static async _withTimeout(promise, ms = 20000) {

        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), ms)
            )
        ]);
    }

    // ------------------------------------------------------------
    // MAIN API
    // ------------------------------------------------------------

    static async getEmployeeInsights(companyName) {

        this.log("Fetching reviews for:", companyName);

        try {

            const [indeed, glassdoor] = await Promise.allSettled([
                this._fetchIndeedReviews(companyName),
                this._fetchGlassdoorReviews(companyName)
            ]);

            const indeedData =
                indeed.status === "fulfilled" ? indeed.value : null;

            const glassdoorData =
                glassdoor.status === "fulfilled" ? glassdoor.value : null;

            const merged = this._mergeSources(indeedData, glassdoorData);

            if (merged?.userReviews?.length > 0) {

                return {
                    reviews: merged,
                    source: "scraped",
                    confidence: this._calculateConfidence(merged)
                };

            }

        } catch (e) {
            this.log("Scrape failed:", e);
        }

        return {
            reviews: {
                overall: null,
                workLife: null,
                compensation: null,
                management: null,
                culture: null,
                pros: [],
                cons: [],
                userReviews: []
            },
            source: "missing",
            confidence: "low"
        };
    }

    // ------------------------------------------------------------
    // INDEED SCRAPER
    // ------------------------------------------------------------

    static async _fetchIndeedReviews(companyName) {

        const slug = companyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

        const url = `https://www.indeed.com/cmp/${slug}/reviews`;

        try {

            const markdown = await this._withTimeout(
                this._jinaRead(url)
            );

            return this._parseIndeedMarkdown(markdown);

        } catch (e) {

            this.log("Indeed scrape failed", e);

            return null;

        }
    }

    // ------------------------------------------------------------
    // GLASSDOOR SCRAPER
    // ------------------------------------------------------------

    static async _fetchGlassdoorReviews(companyName) {

        try {

            const search = await this._withTimeout(
                this._jinaSearch(`site:glassdoor.com/Reviews "${companyName}" reviews`)
            );

            const match = search.match(
                /https:\/\/www\.glassdoor\.com\/Reviews\/[^\s)]+/
            );

            if (!match) return null;

            const url = match[0];

            const markdown = await this._withTimeout(
                this._jinaRead(url)
            );

            return this._parseGlassdoorMarkdown(markdown);

        } catch (e) {

            this.log("Glassdoor scrape failed", e);

            return null;

        }
    }

    // ------------------------------------------------------------
    // MARKDOWN CLEANING
    // ------------------------------------------------------------

    static _cleanMarkdown(md) {

        return md
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/!\[.*?\]\(.*?\)/g, "")
            .replace(/`+/g, "")
            .replace(/#{1,6}\s/g, "")
            .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
            .replace(/_{1,2}([^_]+)_{1,2}/g, "$1");

    }

    // ------------------------------------------------------------
    // PARSERS
    // ------------------------------------------------------------

    static _parseIndeedMarkdown(markdown) {

        markdown = this._cleanMarkdown(markdown);

        return {

            overall: this._extractOverallRating(markdown),

            workLife: this._extractSubRating(
                markdown,
                /work[\s\-]?life/i
            ),

            compensation: this._extractSubRating(
                markdown,
                /salary|compens|pay/i
            ),

            management: this._extractSubRating(
                markdown,
                /management|leadership/i
            ),

            culture: this._extractSubRating(
                markdown,
                /culture|environment/i
            ),

            pros: this._extractListSection(markdown, /\bpros?\b/i),

            cons: this._extractListSection(markdown, /\bcons?\b/i),

            userReviews: this._extractIndeedReviews(markdown)

        };
    }

    static _parseGlassdoorMarkdown(markdown) {

        markdown = this._cleanMarkdown(markdown);

        return {

            overall: this._extractOverallRating(markdown),

            workLife: this._extractSubRating(
                markdown,
                /work[\s\-]?life/i
            ),

            compensation: this._extractSubRating(
                markdown,
                /compens|salary|pay/i
            ),

            management: this._extractSubRating(
                markdown,
                /management|ceo/i
            ),

            culture: this._extractSubRating(
                markdown,
                /culture|values/i
            ),

            pros: this._extractListSection(markdown, /\bpros?\b/i),

            cons: this._extractListSection(markdown, /\bcons?\b/i),

            userReviews: this._extractGlassdoorReviews(markdown)

        };
    }

    // ------------------------------------------------------------
    // RATING EXTRACTION
    // ------------------------------------------------------------

    static _extractOverallRating(text) {

        const patterns = [

            /overall\s*:?\s*([1-5](?:\.\d)?)/i,
            /([1-5]\.\d)\s*out of\s*5/i,
            /([1-5]\.\d)\s*stars?/i,
            /([1-5]\.\d)\s*\/\s*5/i

        ];

        for (const p of patterns) {

            const m = text.match(p);

            if (m) {

                const v = parseFloat(m[1]);

                if (v >= 1 && v <= 5) return v;

            }

        }

        return null;
    }

    static _extractSubRating(text, keyword) {

        const re = new RegExp(
            keyword.source + "[^\\n]{0,60}?([1-5](?:\\.\\d)?)",
            keyword.flags
        );

        const m = text.match(re);

        if (!m) return null;

        const v = parseFloat(m[1]);

        return v >= 1 && v <= 5 ? v : null;
    }

    // ------------------------------------------------------------
    // LIST EXTRACTION
    // ------------------------------------------------------------

    static _extractListSection(text, heading) {

        const lines = text.split("\n");

        const results = [];

        let capture = false;

        for (const line of lines) {

            const t = line.trim();

            if (heading.test(t)) {
                capture = true;
                continue;
            }

            if (capture) {

                if (t.length < 5) break;

                const item = t
                    .replace(/^[-•*]\s*/, "")
                    .trim();

                if (item.length > 10)
                    results.push(item);

                if (results.length >= 8)
                    break;
            }
        }

        return results;
    }

    // ------------------------------------------------------------
    // REVIEW EXTRACTION
    // ------------------------------------------------------------

    static _extractIndeedReviews(markdown) {

        const reviews = [];

        const blocks = markdown.split(/\n{2,}/);

        for (const block of blocks) {

            if (block.length < 60) continue;

            const ratingMatch =
                block.match(/([1-5](?:\.\d)?)\s*out of\s*5/i) ||
                block.match(/([1-5](?:\.\d)?)\s*stars?/i);

            if (!ratingMatch) continue;

            const rating = parseFloat(ratingMatch[1]);

            if (rating < 1 || rating > 5) continue;

            const text = block
                .replace(/\n/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 500);

            if (text.length < 30) continue;

            reviews.push({
                rating,
                title: "Employee Review",
                text,
                author: "Employee",
                date: "",
                source: "Indeed"
            });

            if (reviews.length >= 25) break;
        }

        return reviews;
    }

    static _extractGlassdoorReviews(markdown) {

        const reviews = [];

        const blocks = markdown.split(/\n{2,}/);

        for (const block of blocks) {

            if (block.length < 60) continue;

            const ratingMatch =
                block.match(/([1-5](?:\.\d)?)\s*(?:\/5|out of 5|stars?)/i);

            if (!ratingMatch) continue;

            const rating = parseFloat(ratingMatch[1]);

            if (rating < 1 || rating > 5) continue;

            const text = block
                .replace(/\n/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 500);

            reviews.push({
                rating,
                title: "Employee Review",
                text,
                author: "Employee",
                date: "",
                source: "Glassdoor"
            });

            if (reviews.length >= 25) break;
        }

        return reviews;
    }

    // ------------------------------------------------------------
    // MERGE SOURCES
    // ------------------------------------------------------------

    static _mergeSources(a, b) {

        if (!a && !b) return null;
        if (!a) return b;
        if (!b) return a;

        const reviews = [
            ...(a.userReviews || []),
            ...(b.userReviews || [])
        ];

        const unique = reviews.filter(
            (r, i, arr) =>
                i ===
                arr.findIndex(
                    x =>
                        x.text.slice(0, 80).toLowerCase() ===
                        r.text.slice(0, 80).toLowerCase()
                )
        );

        const avg = (x, y) =>
            typeof x === "number" && typeof y === "number"
                ? (x + y) / 2
                : x ?? y ?? null;

        return {

            overall: avg(a.overall, b.overall),

            workLife: avg(a.workLife, b.workLife),

            compensation: avg(
                a.compensation,
                b.compensation
            ),

            management: avg(
                a.management,
                b.management
            ),

            culture: avg(
                a.culture,
                b.culture
            ),

            pros: [...new Set([...(a.pros || []), ...(b.pros || [])])],

            cons: [...new Set([...(a.cons || []), ...(b.cons || [])])],

            userReviews: unique.slice(0, 30)

        };
    }

    // ------------------------------------------------------------
    // CONFIDENCE
    // ------------------------------------------------------------

    static _calculateConfidence(data) {

        const n = data.userReviews?.length || 0;

        if (n >= 10) return "high";
        if (n >= 4) return "medium";

        return "low";
    }

}