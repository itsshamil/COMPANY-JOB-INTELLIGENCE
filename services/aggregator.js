/**
 * 6. Data Aggregator Service
 * Orchestrates all services, identifies missing data, uses scraped data and defaults.
 */

class DataAggregator {
    static async getIntelligence(companyName, domain, faviconUrl, careerPaths, pageUrl, scrapedJobs, pageContent) {
        console.log(`[Aggregator] Starting intelligence gather for ${companyName}`);

        // 1. Fetch from primary services in parallel
        const [companyInfo, jobData, interviewData, reviewData] = await Promise.all([
            CompanyService.getInfo(companyName, domain, faviconUrl),
            JobService.getJobs(companyName, domain, scrapedJobs || [], pageContent || '', pageUrl || ''),
            Promise.resolve(InterviewService.getInterviewResources(companyName)),
            ReviewService.getEmployeeInsights(companyName)
        ]);

        // 2. Always try to supplement jobs with Jina search for comprehensive results
        let finalJobs = jobData.jobs || [];
        let jobSource = jobData.source;

        if (finalJobs.length < 5) { // If we have fewer than 5 jobs, try to get more from Jina
            console.log('[Aggregator] Supplementing jobs with Jina search for comprehensive results...');
            try {
                const jinaJobData = await JobService._searchJobsWithJina(companyName, domain);
                if (jinaJobData && jinaJobData.length > 0) {
                    // Combine jobs, removing duplicates
                    const existingTitles = new Set(finalJobs.map(j => j.title.toLowerCase().trim()));
                    const newJobs = jinaJobData.filter(j => !existingTitles.has(j.title.toLowerCase().trim()));
                    finalJobs = [...finalJobs, ...newJobs];
                    jobSource = finalJobs.length > (jobData.jobs?.length || 0) ? 'combined' : jobSource;
                    console.log(`[Aggregator] Added ${newJobs.length} additional jobs from Jina search`);
                }
            } catch (e) {
                console.warn('[Aggregator] Jina supplementation failed:', e.message);
            }
        }

        // 2. Build the aggregated object
        const aggregated = {
            ...companyInfo,
            jobs: finalJobs,
            interviewResources: interviewData.resources,
            interviewQuestions: interviewData.practiceQuestions || [],
            reviews: reviewData.reviews,
            aiTips: [],
            dataSources: {
                company: companyInfo.source,
                jobs: jobSource,
                interviews: interviewData.source,
                reviews: reviewData.source
            }
        };

        // 3. Apply sensible defaults for missing fields
        if (!aggregated.industry) aggregated.industry = 'Technology';
        if (!aggregated.headquarters) aggregated.headquarters = 'See website';
        if (!aggregated.employeeCount) aggregated.employeeCount = 'N/A';
        if (!aggregated.description) aggregated.description = `${companyName} – visit their website for more details.`;

        // 5. Default AI tips if none were generated
        if (!aggregated.aiTips || aggregated.aiTips.length === 0) {
            aggregated.aiTips = [
                `Research ${companyName}'s recent news, products, and culture before your interview.`,
                `Prepare answers using the STAR method (Situation, Task, Action, Result).`,
                `Review the job description carefully and align your experience with their requirements.`,
                `Prepare thoughtful questions about the team, projects, and growth opportunities.`,
                `Check ${companyName}'s Glassdoor and Indeed reviews for interview insights.`
            ];
        }

        // 6. Ensure ratings
        aggregated.rating = aggregated.reviews?.overall || aggregated.rating || 0;
        aggregated.interviewDifficulty = aggregated.interviewDifficulty || 6;
        aggregated.culture = aggregated.culture || ['Innovative', 'Collaborative'];



        console.log(`[Aggregator] Final payload ready for ${companyName}`, aggregated);
        return aggregated;
    }
}
