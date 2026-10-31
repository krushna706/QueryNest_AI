
const {
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
} = require("../../config/usageLimits");

// ================== REMAINING QUOTA ==================
function getRemaining(snapshot, metric, limit, scope) {
    // Null means no application-level cap for this metric.
    // Provider quotas are still enforced independently.
    if (limit == null) return null;

    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error(`Invalid ${scope} limit: ${metric}.`);
    }

    const used = snapshot?.[metric]?.used;
    const reserved = snapshot?.[metric]?.reserved;

    if (
        !Number.isSafeInteger(used) || used < 0 ||
        !Number.isSafeInteger(reserved) || reserved < 0 ||
        !Number.isSafeInteger(used + reserved)
    ) {
        throw new Error(`Missing or invalid ${scope} counter: ${metric}.`);
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

    budget.available = Object.values(budget).every(
        (remaining) => remaining === null || remaining > 0
    );

    return budget;
}

// ================== CHECK TOKEN BUDGET ==================
function checkTokenBudget({
    provider,
    estimatedInputTokens,
     maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
    userUsage,
    providerUsage,
} = {}) {

    // ================== VALIDATE TOKEN ESTIMATE ==================
    if (
        !Number.isSafeInteger(estimatedInputTokens) ||
        estimatedInputTokens < 1 ||
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        !Number.isSafeInteger(
            estimatedInputTokens + maxOutputTokens
        )
    ) {
        throw new Error("Invalid AI token estimate.");
    }

    // ================== OUTPUT LIMIT ==================
    const maxAllowedOutput =
        APP_USAGE_LIMITS.maxOutputTokensPerRequest;

    if (
        maxAllowedOutput != null &&
        (
            !Number.isSafeInteger(maxAllowedOutput) ||
            maxAllowedOutput < 1 ||
            maxOutputTokens > maxAllowedOutput
        )
    ) {
        throw new Error("AI output token limit exceeded.");
    }

    // ================== ESTIMATED TOTAL TOKENS ==================
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
        [
            "USER_RPM_LIMIT",
            "remainingRequestsPerMinute",
            1,
        ],
        [
            "USER_DAILY_REQUEST_LIMIT",
            "remainingRequestsPerDay",
            1,
        ],
        [
            "USER_DAILY_TOKEN_LIMIT",
            "remainingTokensPerDay",
            estimatedTotalTokens,
        ],
    ];

    for (const [code, key, required] of userChecks) {
        const remaining = userBudget[key];

        // Null means no fixed daily user-token limit.
        if (remaining !== null && remaining < required) {
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
        [
            "PROVIDER_RPM_LIMIT",
            "remainingRequestsPerMinute",
            1,
        ],
        [
            "PROVIDER_DAILY_REQUEST_LIMIT",
            "remainingRequestsPerDay",
            1,
        ],
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
        const remaining = providerBudget[key];

        if (remaining !== null && remaining < required) {
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

    // ================== PROVIDER RESERVATION ==================
    const providerLimits = getProviderUsageLimits(provider);

    const providerCounters = {
        requestsPerMinute: 1,
        requestsPerDay: 1,

        ...(providerLimits.tokensPerMinute != null
            ? {
                tokensPerMinute: estimatedTotalTokens,
            }
            : {}),

        ...(providerLimits.inputTokensPerMinute != null
            ? {
                inputTokensPerMinute: estimatedInputTokens,
            }
            : {}),

        ...(providerLimits.tokensPerDay != null
            ? {
                tokensPerDay: estimatedTotalTokens,
            }
            : {}),
    };

    // ================== USER RESERVATION ==================
    const userCounters = {
        requestsPerMinute: 1,
        requestsPerDay: 1,

        ...(APP_USAGE_LIMITS.tokensPerUserPerDay != null
            ? {
                tokensPerDay: estimatedTotalTokens,
            }
            : {}),
    };

    // ================== ALLOWED RESPONSE ==================
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
            user: userCounters,
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
