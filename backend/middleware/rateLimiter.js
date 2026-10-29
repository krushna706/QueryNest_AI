
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

// ================== EXPORTS ==================
module.exports = {
    loginIpLimiter,
    loginAccountLimiter,
    signupLimiter,
    forgotPasswordRequestLimiter,
    forgotPasswordVerifyLimiter,
    forgotPasswordResetLimiter,
};
