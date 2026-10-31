const express = require("express");

const userController = require("../controllers/userController");

const authMiddleware = require("../middleware/authMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");
const { handleAvatarUpload } = require("../middleware/uploadMiddleware");
const { profileReadLimiter, profileUpdateLimiter, avatarUploadLimiter, clearHistoryLimiter } = require("../middleware/rateLimiter");

const { updateProfileSchema } = require("../validations/schema");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// GET /api/users/profile
router.get("/profile", profileReadLimiter, userController.getProfile);

// PATCH /api/users/profile
router.patch("/profile", profileUpdateLimiter, validateMiddleware(updateProfileSchema), userController.updateProfile);

// POST /api/users/profile/avatar
router.post("/profile/avatar", avatarUploadLimiter, handleAvatarUpload, userController.uploadAvatar);

// DELETE /api/users/chat-history
router.delete("/chat-history", clearHistoryLimiter, userController.clearAllChatHistory);

module.exports = router;
