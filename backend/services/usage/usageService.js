const mongoose = require("mongoose");

const { AIUsage, AIUsageCounter } = require("../../models/AIUsage");
const { AI_PROVIDERS } = require("../../config/aiProviders");
const { APP_USAGE_LIMITS, getProviderUsageLimits } = require("../../config/usageLimits");
const { checkTokenBudget, getProviderBudgetSnapshot } = require("./tokenBudget");

// Usage settings
const TRANSACTION_RETRIES = 3;
const LEASE_DURATION_MS = 5 * 60 * 1000;
const COUNTER_RETENTION_MS = 48 * 60 * 60 * 1000;

// Quota error
class QuotaError extends Error {
    constructor(code) {
        super(code);
        this.name = "QuotaError";
        this.code = code;
    }
}

// Time windows
function getWindow(metric, date) {
    const start = new Date(date);

    if (metric.endsWith("PerMinute")) {
        start.setUTCSeconds(0, 0);
    } else if (metric.endsWith("PerDay")) {
        start.setUTCHours(0, 0, 0, 0);
    } else {
        throw new Error(`Unsupported usage metric: ${metric}.`);
    }

    const duration = metric.endsWith("PerMinute") ? 60 * 1000 : 24 * 60 * 60 * 1000;

    const windowEnd = new Date(start.getTime() + duration);

    return {
        windowStart: start,
        windowEnd,
        expiresAt: new Date(windowEnd.getTime() + COUNTER_RETENTION_MS),
    };
}

// Build counter items
function buildCounterItems({ userId, provider, estimatedInputTokens, maxOutputTokens, date }) {
    const totalTokens = estimatedInputTokens + maxOutputTokens;
    const providerLimits = getProviderUsageLimits(provider);

    const entries = [
        ["user", String(userId), "requestsPerMinute", 1, APP_USAGE_LIMITS.requestsPerUserPerMinute],
        ["user", String(userId), "requestsPerDay", 1, APP_USAGE_LIMITS.requestsPerUserPerDay],
        ["user", String(userId), "tokensPerDay", totalTokens, APP_USAGE_LIMITS.tokensPerUserPerDay],
        ["provider", provider, "requestsPerMinute", 1, providerLimits.requestsPerMinute],
        ["provider", provider, "requestsPerDay", 1, providerLimits.requestsPerDay],
        ["provider", provider, "tokensPerMinute", totalTokens, providerLimits.tokensPerMinute],
        ["provider", provider, "inputTokensPerMinute", estimatedInputTokens, providerLimits.inputTokensPerMinute],
        ["provider", provider, "tokensPerDay", totalTokens, providerLimits.tokensPerDay],
    ];

    // Skip metrics without a configured limit.
    return entries
        .filter(([, , , , limit]) => limit != null)
        .map(([scope, scopeId, metric, amount, limit]) => ({
            scope,
            scopeId,
            metric,
            amount,
            limit,
            ...getWindow(metric, date),
        }));
}

// Counter filter
function counterFilter(item) {
    return {
        scope: item.scope,
        scopeId: item.scopeId,
        metric: item.metric,
        windowStart: item.windowStart,
    };
}

// Load counter snapshots
async function getCounterSnapshots(items, session) {
    const userUsage = {};
    const providerUsage = {};

    for (const item of items) {
        const target = item.scope === "user" ? userUsage : providerUsage;

        target[item.metric] = {
            used: 0,
            reserved: 0,
        };
    }

    const counters = await AIUsageCounter.find({
        $or: items.map(counterFilter),
    })
        .session(session)
        .lean();

    for (const counter of counters) {
        const target = counter.scope === "user" ? userUsage : providerUsage;

        target[counter.metric] = {
            used: counter.used,
            reserved: counter.reserved,
        };
    }

    return {
        userUsage,
        providerUsage,
    };
}

// Reserve counter
async function reserveCounter(item, session) {
    const filter = counterFilter(item);

    await AIUsageCounter.updateOne(
        filter,
        {
            $setOnInsert: {
                ...filter,
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

    // Prevent concurrent reservations exceeding the quota.
    const updated = await AIUsageCounter.updateOne(
        {
            ...filter,
            $expr: {
                $lte: [
                    {
                        $add: [{ $ifNull: ["$used", 0] }, { $ifNull: ["$reserved", 0] }, item.amount],
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
        { session }
    );

    if (updated.matchedCount !== 1) {
        throw new QuotaError("QUOTA_EXCEEDED");
    }
}

// Update counter
async function updateCounter(item, reservedDelta, usedDelta, session) {
    if (reservedDelta === 0 && usedDelta === 0) {
        return;
    }

    const filter = counterFilter(item);
    const update = { $inc: {} };

    if (reservedDelta !== 0) {
        update.$inc.reserved = reservedDelta;
    }

    if (usedDelta !== 0) {
        update.$inc.used = usedDelta;
    }

    const safeFilter =
        reservedDelta < 0
            ? {
                  ...filter,
                  reserved: { $gte: -reservedDelta },
              }
            : filter;

    const result = await AIUsageCounter.updateOne(safeFilter, update, { session });

    if (result.matchedCount !== 1) {
        throw new Error("Usage counter reconciliation failed.");
    }
}

// Transaction retries
async function runTransaction(operation) {
    for (let attempt = 1; attempt <= TRANSACTION_RETRIES; attempt++) {
        try {
            return await mongoose.connection.transaction(operation);
        } catch (error) {
            if (error instanceof QuotaError) {
                throw error;
            }

            const retryable =
                error?.code === 112 ||
                error?.hasErrorLabel?.("TransientTransactionError") ||
                error?.hasErrorLabel?.("UnknownTransactionCommitResult");

            if (!retryable || attempt === TRANSACTION_RETRIES) {
                throw error;
            }
        }
    }
}

// Current provider budgets
// Read tracked provider counters before AI routing.
// Final quota enforcement remains inside the reservation transaction.
async function getCurrentProviderBudgets() {
    const now = new Date();
    const providerNames = Object.keys(AI_PROVIDERS);

    const counterSnapshots = {};
    const conditions = [];

    for (const provider of providerNames) {
        const limits = getProviderUsageLimits(provider);
        const providerUsage = {};

        for (const metric of [
            "requestsPerMinute",
            "requestsPerDay",
            "tokensPerMinute",
            "inputTokensPerMinute",
            "tokensPerDay",
        ]) {
            if (limits[metric] == null) {
                continue;
            }

            const { windowStart } = getWindow(metric, now);

            providerUsage[metric] = {
                used: 0,
                reserved: 0,
            };

            conditions.push({
                scope: "provider",
                scopeId: provider,
                metric,
                windowStart,
            });
        }

        counterSnapshots[provider] = providerUsage;
    }

    const counters = conditions.length
        ? await AIUsageCounter.find({
              $or: conditions,
          }).lean()
        : [];

    for (const counter of counters) {
        const providerUsage = counterSnapshots[counter.scopeId];

        if (!providerUsage?.[counter.metric]) {
            continue;
        }

        providerUsage[counter.metric] = {
            used: counter.used,
            reserved: counter.reserved,
        };
    }

    const budgets = {};

    for (const provider of providerNames) {
        budgets[provider] = getProviderBudgetSnapshot(provider, counterSnapshots[provider]);
    }

    return budgets;
}

// Reserve ai usage
async function reserveAIUsage({
    attemptKey,
    userId,
    provider,
    task,
    estimatedInputTokens,
    maxOutputTokens = APP_USAGE_LIMITS.maxOutputTokensPerRequest,
} = {}) {
    if (typeof attemptKey !== "string" || !attemptKey.trim()) {
        throw new Error("A valid AI attempt key is required.");
    }

    if (!mongoose.isValidObjectId(userId)) {
        throw new Error("A valid user ID is required.");
    }

    if (!AI_PROVIDERS[provider]) {
        throw new Error("Unsupported AI provider.");
    }

    if (
        !Number.isSafeInteger(estimatedInputTokens) ||
        estimatedInputTokens < 1 ||
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > APP_USAGE_LIMITS.maxOutputTokensPerRequest ||
        !Number.isSafeInteger(estimatedInputTokens + maxOutputTokens)
    ) {
        throw new Error("Invalid AI token reservation.");
    }

    const now = new Date();

    const items = buildCounterItems({
        userId,
        provider,
        estimatedInputTokens,
        maxOutputTokens,
        date: now,
    });

    try {
        return await runTransaction(async (session) => {
            const exists = await AIUsage.exists({
                attemptKey,
            }).session(session);

            if (exists) {
                return {
                    allowed: false,
                    code: "DUPLICATE_ATTEMPT",
                };
            }

            const snapshots = await getCounterSnapshots(items, session);

            const budget = checkTokenBudget({
                provider,
                estimatedInputTokens,
                maxOutputTokens,
                userUsage: snapshots.userUsage,
                providerUsage: snapshots.providerUsage,
            });

            if (!budget.allowed) {
                return {
                    allowed: false,
                    code: budget.code,
                    scope: budget.scope,
                };
            }

            for (const item of items) {
                await reserveCounter(item, session);
            }

            await AIUsage.create(
                [
                    {
                        attemptKey,
                        userId,
                        provider,
                        model: AI_PROVIDERS[provider].model,
                        operation: "chat",
                        task,
                        status: "reserved",
                        estimatedInputTokens,
                        reservedOutputTokens: maxOutputTokens,
                        reservedTotalTokens: estimatedInputTokens + maxOutputTokens,
                        usageSource: "unavailable",
                        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
                        createdAt: now,
                    },
                ],
                { session }
            );

            return {
                allowed: true,
                code: "OK",
            };
        });
    } catch (error) {
        if (error instanceof QuotaError) {
            return {
                allowed: false,
                code: error.code,
            };
        }

        throw error;
    }
}

// Load attempt counters
function getAttemptItems(attempt) {
    return buildCounterItems({
        userId: attempt.userId,
        provider: attempt.provider,
        estimatedInputTokens: attempt.estimatedInputTokens,
        maxOutputTokens: attempt.reservedOutputTokens,
        date: attempt.createdAt,
    });
}

// Start ai usage
async function startAIUsage({ attemptKey } = {}) {
    if (!attemptKey) {
        throw new Error("AI attempt key is required.");
    }

    return runTransaction(async (session) => {
        const attempt = await AIUsage.findOne({
            attemptKey,
        }).session(session);

        if (!attempt) {
            throw new Error("AI usage reservation not found.");
        }

        if (attempt.status === "streaming") {
            return true;
        }

        if (attempt.status !== "reserved") {
            throw new Error("AI usage reservation cannot be started.");
        }

        for (const item of getAttemptItems(attempt)) {
            if (!item.metric.startsWith("requests")) {
                continue;
            }

            await updateCounter(item, -item.amount, item.amount, session);
        }

        await AIUsage.updateOne(
            {
                _id: attempt._id,
                status: "reserved",
            },
            {
                $set: {
                    status: "streaming",
                    startedAt: new Date(),
                    leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
                },
            },
            { session }
        );

        return true;
    });
}

// Normalize actual usage
function getActualUsage(attempt, usage) {
    const input = usage?.inputTokens;
    const output = usage?.outputTokens;
    const total = usage?.totalTokens;

    const hasReportedUsage =
        Number.isSafeInteger(input) &&
        input >= 0 &&
        Number.isSafeInteger(output) &&
        output >= 0 &&
        Number.isSafeInteger(total) &&
        total >= input + output;

    if (hasReportedUsage) {
        return {
            inputTokens: input,
            outputTokens: total - input,
            totalTokens: total,
            usageSource: "reported",
        };
    }

    // Estimate usage when provider reports none.
    return {
        inputTokens: attempt.estimatedInputTokens,
        outputTokens: attempt.reservedOutputTokens,
        totalTokens: attempt.reservedTotalTokens,
        usageSource: "estimated",
    };
}

// Finalize ai usage
async function finalizeAIUsage({ attemptKey, status = "completed", usage = null } = {}) {
    if (!attemptKey) {
        throw new Error("AI attempt key is required.");
    }

    if (!["completed", "stopped", "incomplete", "failed"].includes(status)) {
        throw new Error("Invalid AI usage final status.");
    }

    return runTransaction(async (session) => {
        const attempt = await AIUsage.findOne({
            attemptKey,
        }).session(session);

        if (!attempt) {
            throw new Error("AI usage attempt not found.");
        }

        if (["completed", "stopped", "incomplete", "failed", "cancelled"].includes(attempt.status)) {
            return true;
        }

        if (!["reserved", "streaming"].includes(attempt.status)) {
            throw new Error("Invalid AI usage state.");
        }

        const started = attempt.status === "streaming";
        const actual = getActualUsage(attempt, usage);

        for (const item of getAttemptItems(attempt)) {
            if (item.metric.startsWith("requests")) {
                if (!started) {
                    await updateCounter(item, -item.amount, 0, session);
                }

                continue;
            }

            const actualAmount = item.metric === "inputTokensPerMinute" ? actual.inputTokens : actual.totalTokens;

            await updateCounter(item, -item.amount, started ? actualAmount : 0, session);
        }

        await AIUsage.updateOne(
            {
                _id: attempt._id,
                status: attempt.status,
            },
            {
                $set: {
                    status,
                    actualInputTokens: started ? actual.inputTokens : 0,
                    actualOutputTokens: started ? actual.outputTokens : 0,
                    actualTotalTokens: started ? actual.totalTokens : 0,
                    usageSource: started ? actual.usageSource : "unavailable",
                    finishedAt: new Date(),
                    leaseExpiresAt: null,
                },
            },
            { session }
        );

        return true;
    });
}

// Cancel reserved ai usage
async function cancelReservedAIUsage({ attemptKey } = {}) {
    if (!attemptKey) {
        throw new Error("AI attempt key is required.");
    }

    return runTransaction(async (session) => {
        const attempt = await AIUsage.findOne({
            attemptKey,
        }).session(session);

        if (!attempt || attempt.status === "cancelled") {
            return true;
        }

        if (attempt.status !== "reserved") {
            return false;
        }

        for (const item of getAttemptItems(attempt)) {
            await updateCounter(item, -item.amount, 0, session);
        }

        await AIUsage.updateOne(
            {
                _id: attempt._id,
                status: "reserved",
            },
            {
                $set: {
                    status: "cancelled",
                    finishedAt: new Date(),
                    leaseExpiresAt: null,
                },
            },
            { session }
        );

        return true;
    });
}

// Exports
module.exports = {
    getCurrentProviderBudgets,
    reserveAIUsage,
    startAIUsage,
    finalizeAIUsage,
    cancelReservedAIUsage,
};
