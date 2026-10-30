
const mongoose = require("mongoose");

const { AIUsage, AIUsageCounter } = require("../../models/AIUsage");
const { AI_PROVIDERS } = require("../../config/aiProviders");

const {
    APP_USAGE_LIMITS,
    getProviderUsageLimits,
} = require("../../config/usageLimits");

const { checkTokenBudget } = require("./tokenBudget");
const ExpressError = require("../../utils/ExpressError");

// ================== USAGE CONFIGURATION ==================
const COUNTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RESERVATION_LEASE_MS = 10 * 60 * 1000;

// ================== TRANSACTION HELPER ==================
async function runUsageTransaction(callback) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await mongoose.connection.transaction(callback);
        } catch (error) {
            const retryable =
                error?.code === 11000 ||
                error?.hasErrorLabel?.("TransientTransactionError");

            if (!retryable || attempt === 2) {
                throw error;
            }
        }
    }
}

// ================== USAGE WINDOW ==================
function getWindow(metric, time) {
    const daily = metric.endsWith("PerDay");

    const start = daily
        ? new Date(
            Date.UTC(
                time.getUTCFullYear(),
                time.getUTCMonth(),
                time.getUTCDate()
            )
        )
        : new Date(
            Math.floor(time.getTime() / 60000) * 60000
        );

    const end = new Date(
        start.getTime() + (daily ? 86400000 : 60000)
    );

    return {
        windowStart: start,
        windowEnd: end,
        expiresAt: new Date(
            end.getTime() + COUNTER_RETENTION_MS
        ),
    };
}

// ================== VALIDATE TOKEN ESTIMATE ==================
function validateEstimate(inputTokens, outputTokens) {
    if (
        !Number.isSafeInteger(inputTokens) ||
        inputTokens < 1 ||
        !Number.isSafeInteger(outputTokens) ||
        outputTokens < 1 ||
        !Number.isSafeInteger(inputTokens + outputTokens)
    ) {
        throw new ExpressError(
            400,
            "Invalid estimated token usage."
        );
    }
}

// ================== PREPARE QUOTA COUNTERS ==================
function buildCounterItems(attempt, time) {
    const providerLimits = getProviderUsageLimits(
        attempt.provider
    );

    const estimates = {
        requestsPerMinute: 1,
        requestsPerDay: 1,
        tokensPerMinute: attempt.reservedTotalTokens,
        inputTokensPerMinute: attempt.estimatedInputTokens,
        tokensPerDay: attempt.reservedTotalTokens,
    };

    const userLimits = {
        requestsPerMinute:
            APP_USAGE_LIMITS.requestsPerUserPerMinute,

        requestsPerDay:
            APP_USAGE_LIMITS.requestsPerUserPerDay,

        tokensPerDay:
            APP_USAGE_LIMITS.tokensPerUserPerDay,
    };

    const items = [];

    // ================== USER AND PROVIDER LIMITS ==================
    const scopes = [
        ["user", String(attempt.userId), userLimits],
        ["provider", attempt.provider, providerLimits],
    ];

    for (const [scope, scopeId, limits] of scopes) {
        for (const [metric, limit] of Object.entries(limits)) {
            // Unknown limits are not treated as unlimited.
            // Only configured limits can be enforced here.
            if (limit == null) {
                continue;
            }

            if (
                !Number.isSafeInteger(limit) ||
                limit < 1
            ) {
                throw new Error(
                    `Invalid configured limit: ${scope}.${metric}.`
                );
            }

            items.push({
                scope,
                scopeId,
                metric,
                limit,
                amount: estimates[metric],
                ...getWindow(metric, time),
            });
        }
    }

    return items;
}

// ================== COUNTER FILTER ==================
function counterFilter(item) {
    return {
        scope: item.scope,
        scopeId: item.scopeId,
        metric: item.metric,
        windowStart: item.windowStart,
    };
}

// ================== RESERVE AI USAGE ==================
async function reserveAIUsage({
    attemptKey,
    userId,
    provider,
    task = null,
    estimatedInputTokens,
    maxOutputTokens = 2048,
} = {}) {
    // ================== VALIDATE REQUEST ==================
    if (
        typeof attemptKey !== "string" ||
        !attemptKey.trim() ||
        attemptKey.length > 128
    ) {
        throw new ExpressError(
            400,
            "Invalid AI attempt key."
        );
    }

    if (
        !mongoose.isValidObjectId(userId) ||
        !AI_PROVIDERS[provider]
    ) {
        throw new ExpressError(
            400,
            "Invalid AI usage request."
        );
    }

    validateEstimate(
        estimatedInputTokens,
        maxOutputTokens
    );

    let result;

    try {
        // ================== ATOMIC RESERVATION ==================
        await runUsageTransaction(async (session) => {
            // ================== DUPLICATE ATTEMPT ==================
            const existing = await AIUsage.findOne({
                attemptKey,
            }).session(session);

            if (existing) {
                if (
                    String(existing.userId) !== String(userId) ||
                    existing.provider !== provider ||
                    existing.estimatedInputTokens !== estimatedInputTokens ||
                    existing.reservedOutputTokens !== maxOutputTokens
                ) {
                    throw new ExpressError(
                        409,
                        "AI attempt key conflicts with a previous request."
                    );
                }

                result = {
                    allowed: existing.status === "reserved",
                    attempt: existing,
                    duplicate: true,
                };

                return;
            }

            // ================== CREATE USAGE ATTEMPT ==================
            const now = new Date();

            const [attempt] = await AIUsage.create(
                [{
                    attemptKey,
                    userId,
                    provider,
                    model: AI_PROVIDERS[provider].model,
                    task,
                    status: "reserved",
                    estimatedInputTokens,
                    reservedOutputTokens: maxOutputTokens,
                    reservedTotalTokens:
                        estimatedInputTokens + maxOutputTokens,
                    leaseExpiresAt: new Date(
                        now.getTime() + RESERVATION_LEASE_MS
                    ),
                    createdAt: now,
                }],
                { session }
            );

            // ================== PREPARE COUNTERS ==================
            const items = buildCounterItems(attempt, now);

            const userUsage = {};
            const providerUsage = {};

            // ================== LOAD COUNTER SNAPSHOTS ==================
            for (const item of items) {
                await AIUsageCounter.updateOne(
                    counterFilter(item),
                    {
                        $setOnInsert: {
                            ...counterFilter(item),
                            windowEnd: item.windowEnd,
                            expiresAt: item.expiresAt,
                            used: 0,
                            reserved: 0,
                        },
                    },
                    {
                        upsert: true,
                        session,
                    }
                );

                const counter = await AIUsageCounter.findOne(
                    counterFilter(item)
                )
                    .session(session)
                    .lean();

                const snapshot = item.scope === "user"
                    ? userUsage
                    : providerUsage;

                snapshot[item.metric] = {
                    used: counter.used,
                    reserved: counter.reserved,
                };
            }

            // ================== CHECK AVAILABLE QUOTA ==================
            const budget = checkTokenBudget({
                provider,
                estimatedInputTokens,
                maxOutputTokens,
                userUsage,
                providerUsage,
            });

            if (!budget.allowed) {
                throw new ExpressError(
                    budget.scope === "user" ? 429 : 503,
                    budget.scope === "user"
                        ? "Your AI usage limit has been reached. Please retry after the quota resets."
                        : "AI provider capacity is currently unavailable. Please retry later."
                );
            }

            // ================== RESERVE EACH COUNTER ==================
            for (const item of items) {
                const updated = await AIUsageCounter.findOneAndUpdate(
                    {
                        ...counterFilter(item),
                        $expr: {
                            $lte: [
                                {
                                    $add: [
                                        "$used",
                                        "$reserved",
                                        item.amount,
                                    ],
                                },
                                item.limit,
                            ],
                        },
                    },
                    {
                        $inc: {
                            reserved: item.amount,
                        },
                    },
                    {
                        session,
                        returnDocument: "after",
                    }
                );

                if (!updated) {
                    throw new ExpressError(
                        item.scope === "user" ? 429 : 503,
                        "AI quota was exhausted by another request. Please retry later."
                    );
                }
            }

            // ================== RESERVATION SUCCESS ==================
            result = {
                allowed: true,
                attempt,
                duplicate: false,
            };
        });
    } catch (error) {
        // Provider quota exhaustion allows the router
        // to consider another eligible provider.
        if (
            error instanceof ExpressError &&
            error.statusCode === 503
        ) {
            return {
                allowed: false,
                scope: "provider",
                duplicate: false,
            };
        }

        throw error;
    }

    return result;
}

// ================== RECONCILE COUNTERS ==================
async function updateCounters(
    attempt,
    session,
    {
        started,
        usage = null,
    } = {}
) {
    const items = buildCounterItems(
        attempt,
        attempt.createdAt
    );

    for (const item of items) {
        const requestMetric =
            item.metric.startsWith("requests");

        // Request counters are consumed when the
        // provider attempt begins.
        if (started && !requestMetric) {
            continue;
        }

        // Token counters are reconciled when the
        // provider attempt finishes.
        if (!started && requestMetric) {
            continue;
        }

        const actual = requestMetric
            ? 1
            : item.metric === "inputTokensPerMinute"
                ? usage.inputTokens
                : usage.totalTokens;

        const updated = await AIUsageCounter.updateOne(
            {
                ...counterFilter(item),
                reserved: {
                    $gte: item.amount,
                },
            },
            {
                $inc: {
                    reserved: -item.amount,
                    used: actual,
                },
            },
            { session }
        );

        if (updated.modifiedCount !== 1) {
            throw new Error(
                "AI usage counter is inconsistent; reconciliation aborted."
            );
        }
    }
}

// ================== START AI USAGE ==================
async function startAIUsage({ attemptKey } = {}) {
    let result;

    await runUsageTransaction(async (session) => {
        const attempt = await AIUsage.findOneAndUpdate(
            {
                attemptKey,
                status: "reserved",
            },
            {
                $set: {
                    status: "streaming",
                    startedAt: new Date(),
                },
            },
            {
                session,
                returnDocument: "after",
            }
        );

        if (!attempt) {
            throw new ExpressError(
                409,
                "AI attempt cannot be started."
            );
        }

        // Move request counts from reserved to used.
        await updateCounters(attempt, session, {
            started: true,
        });

        result = attempt;
    });

    return result;
}

// ================== FINALIZE AI USAGE ==================
async function finalizeAIUsage({
    attemptKey,
    status,
    usage = null,
} = {}) {
    const allowedStatuses = [
        "completed",
        "failed",
        "stopped",
        "incomplete",
        "cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
        throw new ExpressError(
            400,
            "Invalid AI completion status."
        );
    }

    let result;

    await runUsageTransaction(async (session) => {
        // ================== FIND ACTIVE ATTEMPT ==================
        const attempt = await AIUsage.findOne({
            attemptKey,
            status: "streaming",
        }).session(session);

        if (!attempt) {
            throw new ExpressError(
                409,
                "AI attempt is not active."
            );
        }

        // ================== ACTUAL TOKEN USAGE ==================
        const reported =
            usage &&
            [
                usage.inputTokens,
                usage.outputTokens,
                usage.totalTokens,
            ].every(
                (value) =>
                    Number.isSafeInteger(value) &&
                    value >= 0
            );

        // Use conservative estimates if the provider
        // does not return complete token usage.
        const totals = reported
            ? usage
            : {
                inputTokens: attempt.estimatedInputTokens,
                outputTokens: attempt.reservedOutputTokens,
                totalTokens: attempt.reservedTotalTokens,
            };

        // ================== UPDATE ATTEMPT ==================
        const changed = await AIUsage.updateOne(
            {
                _id: attempt._id,
                status: "streaming",
            },
            {
                $set: {
                    status,
                    actualInputTokens: totals.inputTokens,
                    actualOutputTokens: totals.outputTokens,
                    actualTotalTokens: totals.totalTokens,
                    usageSource: reported
                        ? "reported"
                        : "estimated",
                    finishedAt: new Date(),
                    leaseExpiresAt: null,
                },
            },
            { session }
        );

        if (changed.modifiedCount !== 1) {
            throw new Error(
                "AI attempt changed during settlement."
            );
        }

        // ================== RECONCILE TOKEN COUNTERS ==================
        await updateCounters(attempt, session, {
            started: false,
            usage: totals,
        });

        result = {
            attemptKey,
            status,
            usage: totals,
            usageSource: reported
                ? "reported"
                : "estimated",
        };
    });

    return result;
}

// ================== CANCEL RESERVED ATTEMPT ==================
async function cancelReservedAIUsage({
    attemptKey,
} = {}) {
    let released = false;

    await runUsageTransaction(async (session) => {
        // Only attempts that have not started can
        // release both request and token reservations.
        const attempt = await AIUsage.findOneAndUpdate(
            {
                attemptKey,
                status: "reserved",
            },
            {
                $set: {
                    status: "cancelled",
                    finishedAt: new Date(),
                    leaseExpiresAt: null,
                },
            },
            {
                session,
                returnDocument: "after",
            }
        );

        if (!attempt) {
            return;
        }

        // ================== RELEASE RESERVATIONS ==================
        const items = buildCounterItems(
            attempt,
            attempt.createdAt
        );

        for (const item of items) {
            const changed = await AIUsageCounter.updateOne(
                {
                    ...counterFilter(item),
                    reserved: {
                        $gte: item.amount,
                    },
                },
                {
                    $inc: {
                        reserved: -item.amount,
                    },
                },
                { session }
            );

            if (changed.modifiedCount !== 1) {
                throw new Error(
                    "AI usage counter is inconsistent; cancellation aborted."
                );
            }
        }

        released = true;
    });

    return released;
}

// ================== EXPORTS ==================
module.exports = {
    reserveAIUsage,
    startAIUsage,
    finalizeAIUsage,
    cancelReservedAIUsage,
};
