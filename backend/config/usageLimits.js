// Ai provider usage limits
// Baseline limits from the October 2026 provider dashboards.
// Actual limits may change. Recheck before deployment.
const PROVIDER_USAGE_LIMITS = {
    // Groq limits
    groq: {
        requestsPerMinute: 30,
        requestsPerDay: 1000,
        tokensPerMinute: 8000,
        tokensPerDay: 200000,
    },

    // Gemini limits
    gemini: {
        requestsPerMinute: 15,
        requestsPerDay: 500,
        inputTokensPerMinute: 250000,

        // Daily token limit was not specified in the dashboard.
        // null means unknown, not unlimited.
        tokensPerDay: null,
    },
};

// Application usage limits
const APP_USAGE_LIMITS = {
    // User chat limits
    requestsPerUserPerMinute: 5,
    requestsPerUserPerDay: 100,

    // No fixed daily token cap per registered user.
    // Shared provider quotas are still enforced.
    tokensPerUserPerDay: null,

    // Ai response limits
    maxOutputTokensPerRequest: 4096,

    // Concurrency limits
    maxActiveGenerationsPerUser: 1,
    maxQueuedRequests: 10,

    // Pdf document limits
    maxPdfPerConversation: 3,
    maxPdfSizeBytes: 5 * 1024 * 1024,
    maxPagesPerConversation: 30,
};

// Get provider limits
function getProviderUsageLimits(provider) {
    const limits = PROVIDER_USAGE_LIMITS[provider];

    if (!limits) {
        throw new Error("Unsupported AI provider.");
    }

    return limits;
}

// Exports
module.exports = {
    PROVIDER_USAGE_LIMITS,
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
};
