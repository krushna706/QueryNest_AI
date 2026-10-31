
const express = require("express");
const multer = require("multer");
const Joi = require("joi");
const { rateLimit } = require("express-rate-limit");

const userController = require("../controllers/userController");

const authMiddleware = require("../middleware/authMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");

const ExpressError = require("../utils/ExpressError");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== AVATAR CONFIGURATION ==================
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
]);

const ALLOWED_AVATAR_EXTENSION = /\.(jpg|jpeg|png|webp)$/i;

// ================== PROFILE VALIDATION ==================
const updateProfileSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(2)
        .max(100)
        .pattern(/^[^\u0000-\u001F\u007F]+$/)
        .required()
        .messages({
            "string.empty": "Name is required.",
            "string.min": "Name must contain at least 2 characters.",
            "string.max": "Name cannot exceed 100 characters.",
            "string.pattern.base": "Enter a valid name.",
            "any.required": "Name is required.",
        }),
})
    .required()
    .unknown(false);

// ================== USER RATE LIMITER ==================
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

// ================== PROFILE READ LIMITER ==================
const profileReadLimiter = createUserLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    code: "PROFILE_RATE_LIMIT",
    message:
        "Too many profile requests. Please try again later.",
});

// ================== PROFILE UPDATE LIMITER ==================
const profileUpdateLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    code: "PROFILE_UPDATE_RATE_LIMIT",
    message:
        "Too many profile updates. Please try again later.",
});

// ================== AVATAR UPLOAD LIMITER ==================
const avatarUploadLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    code: "AVATAR_UPLOAD_RATE_LIMIT",
    message:
        "You've reached your profile picture upload limit. Please try again later.",
});

// ================== CLEAR HISTORY LIMITER ==================
const clearHistoryLimiter = createUserLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    code: "HISTORY_CLEAR_RATE_LIMIT",
    message:
        "Too many chat history deletion requests. Please try again later.",
});

// ================== AVATAR UPLOAD STORAGE ==================
const avatarUpload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: MAX_AVATAR_SIZE,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 40,
        headerPairs: 20,
    },

    // ================== BASIC FILE VALIDATION ==================
    fileFilter: (req, file, callback) => {
        const validMimeType =
            ALLOWED_AVATAR_TYPES.has(file.mimetype);

        const validExtension =
            ALLOWED_AVATAR_EXTENSION.test(
                file.originalname || ""
            );

        if (!validMimeType || !validExtension) {
            return callback(
                new ExpressError(
                    415,
                    "Only JPG, JPEG, PNG and WebP images are allowed."
                )
            );
        }

        return callback(null, true);
    },
});

// ================== AVATAR ERROR HANDLER ==================
function handleAvatarUpload(req, res, next) {
    avatarUpload.single("avatar")(
        req,
        res,
        (error) => {
            if (!error) {
                return next();
            }

            // ================== MULTER ERRORS ==================
            if (error instanceof multer.MulterError) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return next(
                        new ExpressError(
                            413,
                            "Profile picture must be smaller than 3 MB."
                        )
                    );
                }

                if (
                    error.code === "LIMIT_UNEXPECTED_FILE" ||
                    error.code === "LIMIT_FILE_COUNT"
                ) {
                    return next(
                        new ExpressError(
                            400,
                            "Upload only one profile picture using the avatar field."
                        )
                    );
                }

                return next(
                    new ExpressError(
                        400,
                        "Invalid profile picture upload."
                    )
                );
            }

            return next(error);
        }
    );
}

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// ================== GET MY PROFILE ==================
// GET /api/users/profile
router.get(
    "/profile",
    profileReadLimiter,
    userController.getProfile
);

// ================== UPDATE PROFILE NAME ==================
// PATCH /api/users/profile
router.patch(
    "/profile",
    profileUpdateLimiter,
    validateMiddleware(updateProfileSchema),
    userController.updateProfile
);

// ================== UPLOAD / REPLACE AVATAR ==================
// POST /api/users/profile/avatar
router.post(
    "/profile/avatar",
    avatarUploadLimiter,
    handleAvatarUpload,
    userController.uploadAvatar
);

// ================== CLEAR ALL CHAT HISTORY ==================
// DELETE /api/users/chat-history
router.delete(
    "/chat-history",
    clearHistoryLimiter,
    userController.clearAllChatHistory
);

// ================== EXPORT ==================
module.exports = router;
