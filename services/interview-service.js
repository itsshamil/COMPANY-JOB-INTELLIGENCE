/**
 * 3. Interview Service
 * Collects interview preparation resources
 */

class InterviewService {
    static CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

    static async getInterviewData(companyName) {
        try {
            // Check cache first
            const cached = await this.getCachedData(companyName);
            if (cached) {
                return cached;
            }

            // Fetch data in parallel
            const [leetCodeProblems, geeksforGeeksExperiences, searchResources] = await Promise.all([
                this.getLeetCodeProblems(companyName),
                this.getGeeksforGeeksExperiences(companyName),
                this.getSearchResources(companyName)
            ]);

            const interviewData = {
                leetCodeProblems,
                geeksforGeeksExperiences,
                resources: searchResources,
                cachedAt: Date.now(),
                source: 'aggregated'
            };

            // Cache the data
            await this.cacheData(companyName, interviewData);

            return interviewData;
        } catch (error) {
            console.error('Interview Service Error:', error);
            return this.getSearchResources(companyName);
        }
    }

    static async getLeetCodeProblems(companyName) {
        try {
            const graphqlQuery = {
                query: `
                {
                  allProblems(filters: {companies: ["${companyName}"]}, first: 10) {
                    edges {
                      node {
                        id
                        title
                        difficulty
                        acRate
                        frontend_id: frontendId
                      }
                    }
                  }
                }
              `
            };

            const response = await fetch('https://leetcode.com/graphql', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': 'https://leetcode.com'
                },
                body: JSON.stringify(graphqlQuery)
            });

            if (!response.ok) {
                throw new Error(`LeetCode API error: ${response.status}`);
            }

            const data = await response.json();
            if (data.errors) {
                throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
            }

            return (data.data?.allProblems?.edges || []).map(edge => ({
                title: edge.node.title,
                difficulty: edge.node.difficulty,
                acRate: edge.node.acRate,
                url: `https://leetcode.com/problems/${edge.node.id}/`
            }));
        } catch (error) {
            console.warn('LeetCode fetch failed:', error);
            return [];
        }
    }

    static async getGeeksforGeeksExperiences(companyName) {
        try {
            const jinaUrl = `https://r.jina.ai/https://www.geeksforgeeks.org/stories/`;
            const response = await fetch(jinaUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            if (!response.ok) {
                throw new Error(`Jina API error: ${response.status}`);
            }

            const markdown = await response.text();
            
            // Parse for company-related interview experiences
            const experiences = [];
            const lines = markdown.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(companyName.toLowerCase())) {
                    experiences.push({
                        title: lines[i].trim(),
                        excerpt: lines[i + 1]?.trim() || 'Interview experience',
                        source: 'GeeksforGeeks'
                    });
                }
            }

            return experiences.slice(0, 5); // Return top 5 experiences
        } catch (error) {
            console.warn('GeeksforGeeks fetch failed:', error);
            return [];
        }
    }

    static getSearchResources(companyName) {
        const gfgQuery = encodeURIComponent(`${companyName} interview experience`);
        const leetCodeQuery = encodeURIComponent(companyName);

        return [
            { 
                title: "GeeksforGeeks Interview Experiences", 
                url: `https://www.google.com/search?q=site:geeksforgeeks.org+${gfgQuery}`,
                type: 'search'
            },
            { 
                title: "LeetCode Company Problems", 
                url: `https://leetcode.com/company/${leetCodeQuery.toLowerCase().replace(/\s+/g, '-')}/`,
                type: 'direct'
            },
            { 
                title: "Instagram Job Search", 
                url: `https://www.instagram.com/explore/search/keyword/?q=%23${encodeURIComponent(companyName.replace(/\s+/g, '').toLowerCase() + 'jobs')}`,
                type: 'social'
            }
        ];
    }

    static async getCachedData(companyName) {
        try {
            const result = await chrome.storage.local.get(`interview_${companyName}`);
            const cached = result[`interview_${companyName}`];

            if (cached && (Date.now() - cached.cachedAt) < this.CACHE_DURATION) {
                return cached;
            }
            
            return null;
        } catch (error) {
            console.warn('Cache retrieval failed:', error);
            return null;
        }
    }

    static async cacheData(companyName, data) {
        try {
            await chrome.storage.local.set({
                [`interview_${companyName}`]: data
            });
        } catch (error) {
            console.warn('Cache storage failed:', error);
        }
    }

    // Backward compatibility
    static getInterviewResources(companyName) {
        return {
            resources: this.getSearchResources(companyName),
            practiceQuestions: [],
            source: 'search'
        };
    }
}
