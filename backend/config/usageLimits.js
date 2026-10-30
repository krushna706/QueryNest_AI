
// ================== AI PROVIDER USAGE LIMITS ==================
// Baseline limits from the October 2026 provider dashboards.
// Actual limits may change. Recheck before deployment.
const PROVIDER_USAGE_LIMITS = {
    // ================== GROQ LIMITS ==================
    groq: {
        requestsPerMinute: 30,
        requestsPerDay: 1000,
        tokensPerMinute: 8000,
        tokensPerDay: 200000,
    },

    // ================== GEMINI LIMITS ==================
    gemini: {
        requestsPerMinute: 15,
        requestsPerDay: 500,
        inputTokensPerMinute: 250000,

        // Daily token limit was not specified in the dashboard.
        // null means unknown, not unlimited.
        tokensPerDay: null,
    },
};

// ================== APPLICATION USAGE LIMITS ==================
// Initial application limits. Tune after testing with three users.
const APP_USAGE_LIMITS = {
    // ================== USER CHAT LIMITS ==================
    requestsPerUserPerMinute: 5,
    requestsPerUserPerDay: 50,
    tokensPerUserPerDay: 50000,

    // ================== CONCURRENCY LIMITS ==================
    maxActiveGenerationsPerUser: 1,
    maxQueuedRequests: 10,

    // ================== PDF DOCUMENT LIMITS ==================
    maxPdfPerConversation: 3,
    maxPdfSizeBytes: 5 * 1024 * 1024,
    maxPagesPerConversation: 30,
};

// ================== GET PROVIDER LIMITS ==================
// Return usage limits for the selected AI provider.
function getProviderUsageLimits(provider) {
    const limits = PROVIDER_USAGE_LIMITS[provider];

    if (!limits) {
        throw new Error("Unsupported AI provider.");
    }

    return limits;
}

// ================== EXPORTS ==================
module.exports = {
    PROVIDER_USAGE_LIMITS,
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
};