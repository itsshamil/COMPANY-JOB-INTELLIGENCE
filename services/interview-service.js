/**
 * 3. Interview Service
 * Collects interview preparation resources
 */

class InterviewService {
    static getInterviewResources(companyName) {
        // Return structured search links
        const gfgQuery = encodeURIComponent(`${companyName} interview experience`);
        const leetCodeQuery = encodeURIComponent(companyName);

        return {
            resources: [
                { title: "GeeksforGeeks Interview Experiences", url: `https://www.google.com/search?q=site:geeksforgeeks.org+${gfgQuery}` },
                { title: "LeetCode Company Problems", url: `https://leetcode.com/company/${leetCodeQuery.toLowerCase().replace(/\s+/g, '-')}/` },
                { title: "Instagram Job Search", url: `https://www.instagram.com/explore/search/keyword/?q=%23${encodeURIComponent(companyName.replace(/\s+/g, '').toLowerCase() + 'jobs')}` }
            ],
            practiceQuestions: [],
            source: 'none'
        };
    }
}
