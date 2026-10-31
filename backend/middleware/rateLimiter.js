
const { rateLimit } = require("express-rate-limit");
const { createHash } = require("node:crypto");

// ================== LOGIN IP LIMITER ==================
const loginIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many login attempts. Please try again later.",
    },
});

// ================== LOGIN ACCOUNT LIMITER ==================
const loginAccountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,

    keyGenerator: (req) => {
        const identifier = req.body.identifier.trim().toLowerCase();

        return createHash("sha256")
            .update(identifier)
            .digest("hex");
    },

    message: {
        success: false,
        message: "Too many login attempts. Please try again later.",
    },
});

// ================== SIGNUP IP LIMITER ==================
const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many signup attempts. Please try again later.",
    },
});

// ================== PASSWORD OTP REQUEST LIMITER ==================
const forgotPasswordRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many password reset requests. Please try again later.",
    },
});

// ================== PASSWORD OTP VERIFY LIMITER ==================
const forgotPasswordVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many OTP verification attempts. Please try again later.",
    },
});

// ================== PASSWORD RESET LIMITER ==================
const forgotPasswordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many password reset attempts. Please try again later.",
    },
});

// ================== USER PROFILE LIMITS ==================
function createUserLimiter({
    windowMs,
    limit,
    code,
    message,
}) {
    return rateLimit({
        windowMs,
        limit,

        standardHeaders: "draft-8",
        legacyHeaders: false,

        // Authentication runs before these limiters.
        keyGenerator: (req) => String(req.user._id),

        handler: (req, res) => {
            const resetTime = req.rateLimit?.resetTime;

            const retryAfterSeconds =
                resetTime instanceof Date
                    ? Math.max(
                        1,
                        Math.ceil(
                            (resetTime.getTime() - Date.now()) / 1000
                        )
                    )
                    : null;

            if (retryAfterSeconds !== null) {
                res.set(
                    "Retry-After",
                    String(retryAfterSeconds)
                );
            }

            return res.status(429).json({
                success: false,
                code,
                message,

                ...(retryAfterSeconds !== null
                    ? { retryAfterSeconds }
                    : {}),
            });
        },
    });
}

const profileReadLimiter = createUserLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    code: "PROFILE_RATE_LIMIT",
    message:
        "Too many profile requests. Please try again later.",
});

const profileUpdateLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    code: "PROFILE_UPDATE_RATE_LIMIT",
    message:
        "Too many profile updates. Please try again later.",
});

const avatarUploadLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    code: "AVATAR_UPLOAD_RATE_LIMIT",
    message:
        "You've reached your profile picture upload limit. Please try again later.",
});

const clearHistoryLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    code: "HISTORY_CLEAR_RATE_LIMIT",
    message:
        "Too many chat history deletion requests. Please try again later.",
});

// ================== USAGE LIMIT ==================
const usageReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    keyGenerator: (req) =>
        `usage:${String(req.user._id)}`,

    handler: (req, res) => {
        const resetTime = req.rateLimit?.resetTime;

        const retryAfterSeconds =
            resetTime instanceof Date
                ? Math.max(
                    1,
                    Math.ceil(
                        (resetTime.getTime() - Date.now()) / 1000
                    )
                )
                : null;

        if (retryAfterSeconds !== null) {
            res.set(
                "Retry-After",
                String(retryAfterSeconds)
            );
        }

        res.set("Cache-Control", "no-store");

        return res.status(429).json({
            success: false,
            code: "USAGE_RATE_LIMIT",
            message:
                "Too many usage requests. Please try again later.",

            ...(retryAfterSeconds !== null
                ? { retryAfterSeconds }
                : {}),
        });
    },
});

// ================== EXPORTS ==================
module.exports = {
    loginIpLimiter,
    loginAccountLimiter,
    signupLimiter,
    forgotPasswordRequestLimiter,
    forgotPasswordVerifyLimiter,
    forgotPasswordResetLimiter,
    profileReadLimiter,
    profileUpdateLimiter,
    avatarUploadLimiter,
    clearHistoryLimiter,
    usageReadLimiter,
};
