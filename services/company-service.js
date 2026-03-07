/**
 * 1. Company Information Service
 * Multi-layer company info: Wikipedia API → Jina Search → defaults
 */

class CompanyService {
    static async getInfo(companyName, domain, faviconUrl) {
        const logoUrl = faviconUrl || `https://logo.clearbit.com/${domain}?size=128`;

        // 1. Try Wikipedia API
        try {
            const summary = await this._fetchFromWikipedia(companyName);
            if (summary) {
                summary.logo = logoUrl;
                return summary;
            }
        } catch (e) {
            console.warn('Wikipedia API failed:', e);
        }

        // 2. Try Jina Search for company info
        try {
            const query = `${companyName} company about founded headquarters employees`;
            const rawMarkdown = await WebScraperService.search(query);
            if (rawMarkdown && rawMarkdown.length > 100) {
                const parsed = this._parseCompanyFromMarkdown(rawMarkdown, companyName, domain, logoUrl);
                if (parsed) return parsed;
            }
        } catch (e) {
            console.warn('Jina company search failed:', e);
        }

        // 3. Return partial structure for AI to fill later
        return {
            name: companyName,
            domain: domain,
            logo: logoUrl,
            industry: 'Technology',
            headquarters: 'See website',
            employeeCount: 'N/A',
            description: `${companyName} – visit ${domain} for more information.`,
            source: 'missing'
        };
    }

    static async _fetchFromWikipedia(companyName) {
        const query = encodeURIComponent(companyName.split(' ')[0]);
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${query}`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data || data.type === 'disambiguation') return null;

        return {
            name: data.title || companyName,
            description: data.extract,
            source: 'wikipedia'
        };
    }

    /**
     * Parse company info from Jina search results
     */
    static _parseCompanyFromMarkdown(markdown, companyName, domain, logoUrl) {
        const text = markdown.toLowerCase();

        // Extract industry
        const industryMatch = text.match(/(?:industry|sector|field)[\s:]+([^\n.]{3,50})/i);
        const industry = industryMatch ? industryMatch[1].trim() : '';

        // Extract headquarters
        const hqMatch = text.match(/(?:headquarter|hq|based in|located in|headquarters)[\s:]+([^\n.]{3,60})/i);
        const headquarters = hqMatch ? hqMatch[1].trim() : '';

        // Extract employee count
        const empMatch = text.match(/(\d[\d,]+\+?)\s*(?:employees|workers|staff|people)/i);
        const employeeCount = empMatch ? empMatch[1].trim() + ' employees' : '';

        // Extract founded year
        const foundedMatch = text.match(/(?:founded|established|started|incorporated)\s*(?:in)?\s*(\d{4})/i);
        const founded = foundedMatch ? parseInt(foundedMatch[1]) : null;

        // Extract description - first meaningful sentence
        const descMatch = markdown.match(/(?:is\s+(?:a|an|the)\s+.{20,200}\.)/i);
        const description = descMatch ? companyName + ' ' + descMatch[0] : '';

        if (industry || headquarters || employeeCount || description) {
            return {
                name: companyName,
                domain: domain,
                logo: logoUrl,
                industry: industry ? industry.charAt(0).toUpperCase() + industry.slice(1) : 'Technology',
                headquarters: headquarters ? headquarters.charAt(0).toUpperCase() + headquarters.slice(1) : 'See website',
                founded: founded,
                employeeCount: employeeCount || 'N/A',
                description: description || `${companyName} – visit ${domain} for details.`,
                source: 'jina-search'
            };
        }

        return null;
    }
}
