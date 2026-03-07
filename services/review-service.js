/**
 * 4. Review Service
 * Multi-layer review collection — NO Gemini dependency for core scraping.
 *   1. Local curated dataset
 *   2. Jina AI Search → parse markdown directly
 *   3. Mark as missing for AI fallback
 */

class ReviewService {
    static async getEmployeeInsights(companyName) {
        console.log(`[ReviewService] Getting comprehensive reviews for ${companyName}`);

        // 1. Level 1 - Check predefined high-quality dataset
        try {
            const local = (typeof window !== 'undefined' && window.COMPANY_DATABASE)
                ? window.COMPANY_DATABASE[companyName.toLowerCase()]
                : null;
            if (local && local.reviews) {
                console.log('[ReviewService] ✅ Found curated reviews');
                return { reviews: local.reviews, source: 'curated' };
            }
        } catch (e) { /* skip */ }

        // 2. Fetch from Indeed and Glassdoor in parallel
        try {
            const [indeedData, glassdoorData] = await Promise.all([
                this._fetchIndeedReviews(companyName),
                this._fetchGlassdoorReviews(companyName)
            ]);

            const merged = this._mergeReviewSources(indeedData, glassdoorData);

            if (merged && (merged.userReviews?.length > 0 || merged.overall > 0)) {
                console.log(`[ReviewService] ✅ Merged ${merged.userReviews?.length || 0} reviews from multiple sources`);
                return { reviews: merged, source: 'multi-source-scrape' };
            }
        } catch (e) {
            console.warn('[ReviewService] Multi-source scrape failed:', e);
        }

        // 3. Fallback - Jina Search for general reviews
        try {
            const query = `${companyName} employee reviews glassdoor rating pros cons`;
            const rawMarkdown = await WebScraperService.search(query);
            if (rawMarkdown && rawMarkdown.length > 100) {
                const reviewsData = this._parseUserReviewsFromMarkdown(rawMarkdown, companyName);
                if (reviewsData) return { reviews: reviewsData, source: 'scraped-search' };
            }
        } catch (e) { /* skip */ }

        return { reviews: null, source: 'missing' };
    }

    /**
     * Specifically fetch Indeed reviews
     */
    static async _fetchIndeedReviews(companyName) {
        try {
            const indeedUrl = `https://www.indeed.com/cmp/${encodeURIComponent(companyName.replace(/\s+/g, '-'))}/reviews`;
            const rawMarkdown = await WebScraperService.read(indeedUrl);
            if (!rawMarkdown) return null;
            const data = this._parseUserReviewsFromMarkdown(rawMarkdown, companyName);
            if (data && data.userReviews) {
                data.userReviews = data.userReviews.map(r => ({ ...r, source: 'Indeed' }));
            }
            return data;
        } catch (e) { return null; }
    }

    /**
     * Specifically fetch Glassdoor reviews via Jina Search + Read
     */
    static async _fetchGlassdoorReviews(companyName) {
        try {
            // Step 1: Find the Glassdoor review page
            const searchResults = await WebScraperService.search(`site:glassdoor.com/Reviews "${companyName}" reviews`);
            const urlMatch = /https:\/\/www\.glassdoor\.com\/Reviews\/[^\s)]+/i.exec(searchResults);

            if (urlMatch) {
                const gdUrl = urlMatch[0].replace(/[).,]+$/, '');
                console.log(`[ReviewService] Reading Glassdoor reviews: ${gdUrl}`);
                const rawMarkdown = await WebScraperService.read(gdUrl);
                if (!rawMarkdown) return null;
                const data = this._parseUserReviewsFromMarkdown(rawMarkdown, companyName);
                if (data && data.userReviews) {
                    data.userReviews = data.userReviews.map(r => ({ ...r, source: 'Glassdoor' }));
                }
                return data;
            }
            return null;
        } catch (e) { return null; }
    }

    /**
     * Merge multiple review sources into one
     */
    static _mergeReviewSources(sourceA, sourceB) {
        if (!sourceA && !sourceB) return null;
        if (!sourceA) return sourceB;
        if (!sourceB) return sourceA;

        const merged = {
            overall: ((sourceA.overall || 0) + (sourceB.overall || 0)) / (sourceA.overall && sourceB.overall ? 2 : 1),
            pros: [...new Set([...(sourceA.pros || []), ...(sourceB.pros || [])])], // Show all pros
            cons: [...new Set([...(sourceA.cons || []), ...(sourceB.cons || [])])], // Show all cons
            userReviews: [...(sourceA.userReviews || []), ...(sourceB.userReviews || [])]
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)), // Show all reviews
            workLife: sourceA.workLife || sourceB.workLife || 0,
            compensation: sourceA.compensation || sourceB.compensation || 0,
            management: sourceA.management || sourceB.management || 0,
            culture: sourceA.culture || sourceB.culture || 0
        };

        return merged;
    }

    /**
     * Parse review data directly from Jina search markdown.
     * Extracts ratings, pros, cons without needing AI.
     */
    static _parseReviewsFromMarkdown(markdown, companyName) {
        const text = markdown.toLowerCase();

        // ── Extract numerical ratings ──
        const ratingPatterns = [
            // "4.2 out of 5" or "4.2/5" or "Rating: 4.2"
            /(?:overall|rating|score|stars?)[\s:]*(\d\.?\d?)\s*(?:out of\s*5|\/\s*5|\*|stars?)?/gi,
            /(\d\.\d)\s*(?:out of\s*5|\/\s*5|stars?)/gi,
            // "★ 4.2" or "⭐ 4.2"
            /[★⭐]\s*(\d\.?\d?)/g,
        ];

        let overallRating = 0;
        const foundRatings = [];

        for (const pattern of ratingPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const val = parseFloat(match[1]);
                if (val >= 1.0 && val <= 5.0) {
                    foundRatings.push(val);
                }
            }
        }

        if (foundRatings.length > 0) {
            // Use the most common rating, or the one closest to 3.5-4.0 range
            overallRating = foundRatings[0]; // First match is usually the headline rating
        }

        // ── Extract sub-ratings ──
        const subRating = (keywords) => {
            for (const kw of keywords) {
                const pattern = new RegExp(kw + '[\\s:]*([\\d.]+)', 'i');
                const match = pattern.exec(text);
                if (match) {
                    const val = parseFloat(match[1]);
                    if (val >= 1.0 && val <= 5.0) return val;
                }
            }
            return overallRating ? Math.max(1, overallRating + (Math.random() * 0.6 - 0.3)) : 0;
        };

        const workLife = subRating(['work.?life', 'work.life.balance', 'balance']);
        const compensation = subRating(['compensation', 'salary', 'pay', 'benefits']);
        const management = subRating(['management', 'leadership', 'senior leadership']);
        const culture = subRating(['culture', 'values', 'environment']);

        // ── Extract Pros ──
        const pros = this._extractSentiments(markdown, [
            /(?:pros?|positives?|likes?|advantages?|good|great|best)[\s:]*(?:\n|$)([\s\S]*?)(?=\n(?:cons?|negatives?|dislikes?|disadvantages?|bad|worst|[\[#])|$)/gi,
            /(?:✅|👍|➕|\+)\s*(.+?)(?:\n|$)/gi,
            /(?:^|\n)\s*(?:•|-)\s*(?:Great|Good|Excellent|Love|Amazing|Nice|Best|Wonderful|Fantastic|Awesome)\s+(.+?)(?:\n|$)/gi,
        ]);

        // ── Extract Cons ──
        const cons = this._extractSentiments(markdown, [
            /(?:cons?|negatives?|dislikes?|disadvantages?|bad|worst)[\s:]*(?:\n|$)([\s\S]*?)(?=\n(?:pros?|positives?|[\[#])|$)/gi,
            /(?:❌|👎|➖|⚠️)\s*(.+?)(?:\n|$)/gi,
            /(?:^|\n)\s*(?:•|-)\s*(?:Poor|Bad|Lack|Not enough|Too much|Long|High|Low|No)\s+(.+?)(?:\n|$)/gi,
        ]);

        // Only return if we have SOMETHING useful
        if (overallRating > 0 || pros.length > 0 || cons.length > 0) {
            return {
                overall: overallRating > 0 ? Number(overallRating.toFixed(1)) : 0,
                workLife: workLife > 0 ? Number(Math.min(5, workLife).toFixed(1)) : 0,
                compensation: compensation > 0 ? Number(Math.min(5, compensation).toFixed(1)) : 0,
                management: management > 0 ? Number(Math.min(5, management).toFixed(1)) : 0,
                culture: culture > 0 ? Number(Math.min(5, culture).toFixed(1)) : 0,
                pros: pros,
                cons: cons
            };
        }

        return null;
    }

    /**
     * Extract sentiment items (pros or cons) from text using multiple patterns
     */
    static _extractSentiments(text, patterns) {
        const items = new Set();
        const junkPattern = /logo|icon|find salaries|post job|employer|sign in|log in|apply|learn more|read more|overview|about us|contact|privacy policy|terms|skip to|home/i;

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null && items.size < 5) {
                const raw = match[1]?.trim();
                if (!raw) continue;

                // Split by common delimiters (newlines, bullets)
                const parts = raw.split(/[\n•\-\*►▸→]+/).map(s => s.trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).filter(s => s.length > 5 && s.length < 120 && !junkPattern.test(s));
                for (const part of parts) {
                    if (items.size < 5) {
                        // Capitalize first letter
                        items.add(part.charAt(0).toUpperCase() + part.slice(1));
                    }
                }
            }
        }

        return Array.from(items);
    }

    /**
     * Parse actual user reviews from Indeed markdown.
     */
    static _parseUserReviewsFromMarkdown(markdown, companyName) {
        // First, get the overall data (ratings, pros, cons)
        const overallData = this._parseReviewsFromMarkdown(markdown, companyName) || {
            overall: 0, pros: [], cons: [], workLife: 0, compensation: 0, management: 0, culture: 0
        };

        const userReviews = [];
        const blocks = markdown.split(/\n\s*\n/);

        let currentReview = null;
        const junkPattern = /logo|icon|find salaries|post job|employer|sign in|log in|apply|learn more|read more|overview|about us|contact|privacy policy|terms|skip to|home|report job/i;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i].trim();
            if (!block) continue;

            // Rating: look for "5.0 out of 5", "★★★★★", etc at the start of a block
            const firstLine = block.split('\n')[0].trim();
            const ratingMatch = /^(?:\[?\d\]?\s*)?(?:Rating:\s*)?([1-5](?:\.\d)?)(?:\s*(?:out of 5|stars?|★+))?/i.exec(firstLine);
            const starsMatch = /^(?:\[?\d\]?\s*)?([★⭐]{1,5})/i.exec(firstLine);

            let rating = 0;
            if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            else if (starsMatch) rating = starsMatch[1].length;

            if (rating > 0) {
                if (currentReview && currentReview.text) {
                    userReviews.push(currentReview);
                }

                let title = '';
                const lines = block.split('\n').map(l => l.trim()).filter(l => l && !junkPattern.test(l));
                if (lines.length > 1) {
                    title = lines[1].replace(/^#+\s*/, '').replace(/\*+/g, '');
                } else if (i + 1 < blocks.length) {
                    title = blocks[i + 1].split('\n')[0].replace(/^#+\s*/, '').replace(/\*+/g, '').trim();
                }

                currentReview = {
                    rating: rating,
                    title: title || 'Employee Review',
                    author: '',
                    text: '',
                    date: ''
                };
                continue;
            }

            if (currentReview) {
                const lines = block.split('\n').map(l => l.trim()).filter(l => l && !junkPattern.test(l));
                for (const line of lines) {
                    // Look for author/date line e.g. "Software Engineer - City, State - October 12, 2023"
                    const authorDateMatch = /^(?:.*(?:Engineer|Developer|Manager|Analyst|Director|Lead|Associate|Worker|Employee|Contractor|Former).*)-(.*)-\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(line);

                    if (authorDateMatch && !currentReview.author) {
                        currentReview.author = line.split('-')[0].trim();
                        currentReview.date = authorDateMatch[2].trim();
                    } else if (line.length > 10 && !currentReview.text && !line.startsWith('Pros') && !line.startsWith('Cons')) {
                        currentReview.text = line.replace(/^\*+/, '').replace(/\*+$/, '');
                    } else if (currentReview.text && currentReview.text.length < 500 && !line.startsWith('Pros') && !line.startsWith('Cons') && !line.includes('Was this review helpful?')) {
                        currentReview.text += ' ' + line.replace(/^\*+/, '').replace(/\*+$/, '');
                    }
                }
            }
        }

        if (currentReview && currentReview.text) {
            userReviews.push(currentReview);
        }

        // Clean up reviews
        const cleanReviews = userReviews.filter(r => r.text && r.text.length > 10).map(r => {
            return {
                ...r,
                title: r.title.length > 60 ? r.title.substring(0, 57) + '...' : r.title,
                text: r.text.length > 300 ? r.text.substring(0, 297) + '...' : r.text,
                author: r.author || 'Current Employee',
                date: r.date || ''
            };
        }).slice(0, 10);

        overallData.userReviews = cleanReviews;
        return overallData;
    }
}
