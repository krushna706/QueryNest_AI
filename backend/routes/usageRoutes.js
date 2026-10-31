
const express = require("express");
const { rateLimit } = require("express-rate-limit");

const usageController = require("../controllers/usageController");

const authMiddleware = require("../middleware/authMiddleware");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== USAGE RATE LIMITER ==================
const usageReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    // ================== PER-USER LIMIT ==================
    keyGenerator: (req) =>
        `usage:${String(req.user._id)}`,

    // ================== RATE LIMIT RESPONSE ==================
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

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// ================== MY AI USAGE ==================
// GET /api/usage/me
router.get(
    "/me",
    usageReadLimiter,
    usageController.getMyUsage
);

// ================== EXPORT ==================
module.exports = router;
