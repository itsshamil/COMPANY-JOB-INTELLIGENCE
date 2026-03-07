/**
 * 7. Web Scraper Service (Live AI Scraping via Jina AI)
 * Uses r.jina.ai (Reader) and s.jina.ai (Search) to extract markdown from live pages
 * bypassing captchas and JS-heavy rendering frameworks.
 */

class WebScraperService {
    /**
     * Searches the web using Jina Search API and returns concise markdown
     * @param {string} query The search query
     * @returns {string} Markdown text of search results
     */
    static async search(query) {
        try {
            console.log(`[Scraper] Searching for: ${query}`);
            const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
            // We use 'Accept: text/plain' for raw markdown rather than JSON
            const response = await fetch(url, {
                headers: {
                    'Accept': 'text/plain',
                    'X-Return-Format': 'markdown',
                    'Authorization': 'Bearer jina_09682b8bebaa4ab1b2cecbb712280a90FijTmEqclclal1X4bJWykvwqAZsq'
                }
            });

            if (!response.ok) return null;
            return await response.text();
        } catch (e) {
            console.error(`[Scraper] Search failed for query: ${query}`, e);
            return null;
        }
    }

    /**
     * Reads a specific URL and returns the page content as markdown
     * @param {string} targetUrl The specific URL to read
     * @returns {string} Markdown text of the page
     */
    static async read(targetUrl) {
        try {
            console.log(`[Scraper] Reading URL: ${targetUrl}`);
            const url = `https://r.jina.ai/${targetUrl}`;
            const response = await fetch(url, {
                headers: {
                    'Accept': 'text/plain',
                    'X-Return-Format': 'markdown',
                    'Authorization': 'Bearer jina_09682b8bebaa4ab1b2cecbb712280a90FijTmEqclclal1X4bJWykvwqAZsq'
                }
            });

            if (!response.ok) return null;
            return await response.text();
        } catch (e) {
            console.error(`[Scraper] Reader failed for URL: ${targetUrl}`, e);
            return null;
        }
    }
}
