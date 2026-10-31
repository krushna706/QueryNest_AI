
const { AIUsage, AIUsageCounter } = require("../models/AIUsage");

const {
    APP_USAGE_LIMITS,
} = require("../config/usageLimits");

// ================== UTC REPORTING PERIODS ==================
// Match daily quota windows used by usageService.js.
function getPeriodStarts(now) {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);

    const week = new Date(today);

    // Monday is the first day of the week.
    week.setUTCDate(
        week.getUTCDate() -
        ((week.getUTCDay() + 6) % 7)
    );

    const month = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            1
        )
    );

    const minute = new Date(now);
    minute.setUTCSeconds(0, 0);

    return {
        today,
        week,
        month,
        minute,
    };
}

// ================== PERIOD AGGREGATION ==================
function buildPeriodPipeline(start) {
    return [
        {
            $match: {
                createdAt: {
                    $gte: start,
                },
            },
        },
        {
            $group: {
                _id: "$provider",

                // ================== REQUEST COUNT ==================
                requests: {
                    $sum: 1,
                },

                // ================== TRACKED TOKENS ==================
                tokens: {
                    $sum: {
                        $ifNull: [
                            "$actualTotalTokens",
                            0,
                        ],
                    },
                },

                // ================== PROVIDER REPORTED TOKENS ==================
                reportedTokens: {
                    $sum: {
                        $cond: [
                            {
                                $eq: [
                                    "$usageSource",
                                    "reported",
                                ],
                            },
                            {
                                $ifNull: [
                                    "$actualTotalTokens",
                                    0,
                                ],
                            },
                            0,
                        ],
                    },
                },

                // ================== ESTIMATED TOKENS ==================
                estimatedTokens: {
                    $sum: {
                        $cond: [
                            {
                                $eq: [
                                    "$usageSource",
                                    "estimated",
                                ],
                            },
                            {
                                $ifNull: [
                                    "$actualTotalTokens",
                                    0,
                                ],
                            },
                            0,
                        ],
                    },
                },

                // ================== ACTIVE REQUESTS ==================
                pendingRequests: {
                    $sum: {
                        $cond: [
                            {
                                $eq: [
                                    "$status",
                                    "streaming",
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ];
}

// ================== EMPTY PROVIDER METRICS ==================
function emptyProviderMetrics() {
    return {
        requests: 0,
        tokens: 0,
        reportedTokens: 0,
        estimatedTokens: 0,
        pendingRequests: 0,
    };
}

// ================== PERIOD SUMMARY ==================
function summarizePeriod(
    records,
    requestLimit = null
) {
    const providers = {
        groq: emptyProviderMetrics(),
        gemini: emptyProviderMetrics(),
    };

    const result = {
        requests: 0,
        tokens: 0,
        reportedTokens: 0,
        estimatedTokens: 0,
        pendingRequests: 0,

        requestLimit,
        tokenLimit: null,

        providers,
    };

    for (const record of records) {
        const provider = record._id;

        if (!Object.hasOwn(providers, provider)) {
            continue;
        }

        for (const field of [
            "requests",
            "tokens",
            "reportedTokens",
            "estimatedTokens",
            "pendingRequests",
        ]) {
            const count = record[field] || 0;

            providers[provider][field] = count;
            result[field] += count;
        }
    }

    return result;
}

// ================== LIVE REQUEST QUOTA ==================
function buildQuota(counter, limit) {
    const used = counter?.used || 0;
    const reserved = counter?.reserved || 0;

    return {
        used,
        reserved,
        limit,

        remaining:
            limit === null
                ? null
                : Math.max(
                    0,
                    limit - used - reserved
                ),
    };
}

// ================== GET MY AI USAGE ==================
// GET /api/usage/me
async function getMyUsage(req, res, next) {
    try {
        const userId = req.user._id;

        const now = new Date();

        const starts = getPeriodStarts(now);

        const oldest = new Date(
            Math.min(
                starts.week.getTime(),
                starts.month.getTime()
            )
        );

        // ================== FETCH USER USAGE ==================
        // Exclude requests that were never started.
        const [reports, counters] = await Promise.all([
            AIUsage.aggregate([
                {
                    $match: {
                        userId,

                        createdAt: {
                            $gte: oldest,
                            $lte: now,
                        },

                        startedAt: {
                            $type: "date",
                        },
                    },
                },

                // ================== DAILY / WEEKLY / MONTHLY ==================
                {
                    $facet: {
                        today: buildPeriodPipeline(
                            starts.today
                        ),

                        week: buildPeriodPipeline(
                            starts.week
                        ),

                        month: buildPeriodPipeline(
                            starts.month
                        ),
                    },
                },
            ]),

            // ================== CURRENT USER QUOTAS ==================
            AIUsageCounter.find({
                scope: "user",

                scopeId: String(userId),

                $or: [
                    {
                        metric: "requestsPerMinute",
                        windowStart: starts.minute,
                    },
                    {
                        metric: "requestsPerDay",
                        windowStart: starts.today,
                    },
                ],
            })
                .select("metric used reserved -_id")
                .lean(),
        ]);

        // ================== REPORT RESULTS ==================
        const report = reports[0] || {
            today: [],
            week: [],
            month: [],
        };

        // ================== DAILY USAGE ==================
        const today = summarizePeriod(
            report.today,
            APP_USAGE_LIMITS.requestsPerUserPerDay
        );

        // ================== WEEKLY USAGE ==================
        const week = summarizePeriod(
            report.week
        );

        // ================== MONTHLY USAGE ==================
        const month = summarizePeriod(
            report.month
        );

        // ================== FIND QUOTA COUNTERS ==================
        const minuteCounter = counters.find(
            (item) =>
                item.metric === "requestsPerMinute"
        );

        const dailyCounter = counters.find(
            (item) =>
                item.metric === "requestsPerDay"
        );

        // ================== REQUEST QUOTAS ==================
        const requestsPerMinute = buildQuota(
            minuteCounter,
            APP_USAGE_LIMITS.requestsPerUserPerMinute
        );

        const requestsPerDay = buildQuota(
            dailyCounter,
            APP_USAGE_LIMITS.requestsPerUserPerDay
        );

        // ================== RESPONSE SECURITY ==================
        res.set(
            "Cache-Control",
            "private, no-store"
        );

        // ================== RESPONSE ==================
        return res.status(200).json({
            success: true,

            usage: {
                // ================== USAGE PERIODS ==================
                today,
                week,
                month,

                // ================== PROVIDER BREAKDOWN ==================
                // Existing Profile.jsx reads usage.providers.
                // This top-level field represents today's usage.
                providers: today.providers,

                providersPeriod: "today",

                // ================== PERIOD PROVIDERS ==================
                providersByPeriod: {
                    today: today.providers,
                    week: week.providers,
                    month: month.providers,
                },

                // ================== APPLICATION LIMITS ==================
                limits: {
                    requestsPerMinute:
                        APP_USAGE_LIMITS.requestsPerUserPerMinute,

                    requestsPerDay:
                        APP_USAGE_LIMITS.requestsPerUserPerDay,

                    tokensPerDay:
                        APP_USAGE_LIMITS.tokensPerUserPerDay,

                    // No weekly/monthly caps are configured.
                    requestsPerWeek: null,
                    requestsPerMonth: null,

                    tokensPerWeek: null,
                    tokensPerMonth: null,
                },

                // ================== CURRENT QUOTAS ==================
                quota: {
                    requestsPerMinute,
                    requestsPerDay,
                },

                // ================== REPORT METADATA ==================
                timezone: "UTC",

                periodsStartAt: {
                    today: starts.today.toISOString(),
                    week: starts.week.toISOString(),
                    month: starts.month.toISOString(),
                },

                generatedAt: now.toISOString(),

                note:
                    "Token totals include reported and estimated usage. Active requests may not have final token totals.",
            },
        });

    } catch (error) {
        return next(error);
    }
}

// ================== EXPORTS ==================
module.exports = {
    getMyUsage,
};
