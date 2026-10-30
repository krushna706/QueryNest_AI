
const {
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
} = require("../../config/usageLimits");

// ================== USAGE COUNTER ==================
// Every counter contains current-window usage and pending reservations.
function getRemaining(snapshot, key, limit, label) {
    if (limit == null) return null;

    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error(`Invalid ${label} limit: ${key}.`);
    }

    const counter = snapshot?.[key];
    const used = counter?.used;
    const reserved = counter?.reserved;

    if (
        !Number.isSafeInteger(used) || used < 0 ||
        !Number.isSafeInteger(reserved) || reserved < 0 ||
        !Number.isSafeInteger(used + reserved)
    ) {
        throw new Error(`Missing or invalid ${label} counter: ${key}.`);
    }

    return Math.max(0, limit - used - reserved);
}

// ================== USER BUDGET SNAPSHOT ==================
function getUserBudgetSnapshot(userUsage) {
    return {
        remainingRequestsPerMinute: getRemaining(
            userUsage,
            "requestsPerMinute",
            APP_USAGE_LIMITS.requestsPerUserPerMinute,
            "user"
        ),
        remainingRequestsPerDay: getRemaining(
            userUsage,
            "requestsPerDay",
            APP_USAGE_LIMITS.requestsPerUserPerDay,
            "user"
        ),
        remainingTokensPerDay: getRemaining(
            userUsage,
            "tokensPerDay",
            APP_USAGE_LIMITS.tokensPerUserPerDay,
            "user"
        ),
    };
}

// ================== PROVIDER BUDGET SNAPSHOT ==================
function getProviderBudgetSnapshot(provider, providerUsage) {
    const limits = getProviderUsageLimits(provider);

    const budget = {
        remainingRequestsPerMinute: getRemaining(
            providerUsage,
            "requestsPerMinute",
            limits.requestsPerMinute,
            provider
        ),
        remainingRequestsPerDay: getRemaining(
            providerUsage,
            "requestsPerDay",
            limits.requestsPerDay,
            provider
        ),
        remainingTokensPerMinute: getRemaining(
            providerUsage,
            "tokensPerMinute",
            limits.tokensPerMinute,
            provider
        ),
        remainingInputTokensPerMinute: getRemaining(
            providerUsage,
            "inputTokensPerMinute",
            limits.inputTokensPerMinute,
            provider
        ),
        remainingTokensPerDay: getRemaining(
            providerUsage,
            "tokensPerDay",
            limits.tokensPerDay,
            provider
        ),
    };

    budget.available = [
        budget.remainingRequestsPerMinute,
        budget.remainingRequestsPerDay,
        budget.remainingTokensPerMinute,
        budget.remainingInputTokensPerMinute,
        budget.remainingTokensPerDay,
    ].every((remaining) => remaining === null || remaining > 0);

    return budget;
}

// ================== CHECK TOKEN BUDGET ==================
function checkTokenBudget({
    provider,
    estimatedInputTokens,
    maxOutputTokens = 2048,
    userUsage,
    providerUsage,
} = {}) {
    // ================== VALIDATE TOKEN ESTIMATE ==================
    if (
        !Number.isSafeInteger(estimatedInputTokens) ||
        estimatedInputTokens < 1 ||
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        !Number.isSafeInteger(estimatedInputTokens + maxOutputTokens)
    ) {
        throw new Error("Invalid AI token estimate.");
    }

    const estimatedTotalTokens =
        estimatedInputTokens + maxOutputTokens;

    // ================== CURRENT USAGE ==================
    const userBudget = getUserBudgetSnapshot(userUsage);

    const providerBudget = getProviderBudgetSnapshot(
        provider,
        providerUsage
    );

    // ================== USER LIMITS ==================
    const userChecks = [
        ["USER_RPM_LIMIT", "remainingRequestsPerMinute", 1],
        ["USER_DAILY_REQUEST_LIMIT", "remainingRequestsPerDay", 1],
        [
            "USER_DAILY_TOKEN_LIMIT",
            "remainingTokensPerDay",
            estimatedTotalTokens,
        ],
    ];

    for (const [code, key, required] of userChecks) {
        if (userBudget[key] < required) {
            return {
                allowed: false,
                code,
                scope: "user",
                userBudget,
                providerBudget,
                reservation: null,
            };
        }
    }

    // ================== PROVIDER LIMITS ==================
    const providerChecks = [
        ["PROVIDER_RPM_LIMIT", "remainingRequestsPerMinute", 1],
        ["PROVIDER_DAILY_REQUEST_LIMIT", "remainingRequestsPerDay", 1],
        [
            "PROVIDER_TPM_LIMIT",
            "remainingTokensPerMinute",
            estimatedTotalTokens,
        ],
        [
            "PROVIDER_INPUT_TPM_LIMIT",
            "remainingInputTokensPerMinute",
            estimatedInputTokens,
        ],
        [
            "PROVIDER_DAILY_TOKEN_LIMIT",
            "remainingTokensPerDay",
            estimatedTotalTokens,
        ],
    ];

    for (const [code, key, required] of providerChecks) {
        if (
            providerBudget[key] !== null &&
            providerBudget[key] < required
        ) {
            return {
                allowed: false,
                code,
                scope: "provider",
                userBudget,
                providerBudget,
                reservation: null,
            };
        }
    }

    // ================== RESERVATION PLAN ==================
    // The usage ledger will reserve these counters atomically
    // before sending the request to the AI provider.
    const limits = getProviderUsageLimits(provider);

    const providerCounters = {
        requestsPerMinute: 1,
        requestsPerDay: 1,
    };

    // ================== GROQ TOKEN RESERVATION ==================
    if (limits.tokensPerMinute != null) {
        providerCounters.tokensPerMinute = estimatedTotalTokens;
    }

    // ================== GEMINI INPUT RESERVATION ==================
    if (limits.inputTokensPerMinute != null) {
        providerCounters.inputTokensPerMinute = estimatedInputTokens;
    }

    // ================== PROVIDER DAILY TOKENS ==================
    if (limits.tokensPerDay != null) {
        providerCounters.tokensPerDay = estimatedTotalTokens;
    }

    // ================== RESULT ==================
    return {
        allowed: true,
        code: "OK",
        scope: null,
        userBudget,
        providerBudget,
        reservation: {
            provider,
            estimatedInputTokens,
            estimatedOutputTokens: maxOutputTokens,
            estimatedTotalTokens,

            user: {
                requestsPerMinute: 1,
                requestsPerDay: 1,
                tokensPerDay: estimatedTotalTokens,
            },

            providerCounters,
        },
    };
}

// ================== EXPORTS ==================
module.exports = {
    getUserBudgetSnapshot,
    getProviderBudgetSnapshot,
    checkTokenBudget,
};
