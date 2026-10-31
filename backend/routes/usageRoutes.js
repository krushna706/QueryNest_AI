const express = require("express");

const usageController = require("../controllers/usageController");

const authMiddleware = require("../middleware/authMiddleware");
const { usageReadLimiter } = require("../middleware/rateLimiter");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== AUTHENTICATION ==================
router.use(authMiddleware);

// GET /api/usage/me
router.get("/me", usageReadLimiter, usageController.getMyUsage);

module.exports = router;
