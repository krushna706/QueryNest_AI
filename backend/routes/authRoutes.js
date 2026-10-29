
const express = require("express");

const authController = require("../controllers/authController");
const passwordResetController = require("../controllers/passwordResetController");

const authMiddleware = require("../middleware/authMiddleware");
const validateMiddleware = require("../middleware/validateMiddleware");

const {
    loginIpLimiter,
    loginAccountLimiter,
    signupLimiter,
    forgotPasswordRequestLimiter,
    forgotPasswordVerifyLimiter,
    forgotPasswordResetLimiter,
} = require("../middleware/rateLimiter");

const {
    signupSchema,
    loginSchema,
    forgotPasswordRequestSchema,
    forgotPasswordVerifySchema,
    forgotPasswordResetSchema,
} = require("../validations/schema");

// ================== ROUTER SETUP ==================
const router = express.Router();

// ================== SIGNUP ==================
router.post(
    "/signup",
    signupLimiter,
    validateMiddleware(signupSchema),
    authController.signup
);

// ================== LOGIN ==================
router.post(
    "/login",
    loginIpLimiter,
    validateMiddleware(loginSchema),
    loginAccountLimiter,
    authController.login
);

// ================== FORGOT PASSWORD ==================

// Request OTP
router.post(
    "/forgot-password/request",
    forgotPasswordRequestLimiter,
    validateMiddleware(forgotPasswordRequestSchema),
    passwordResetController.requestPasswordResetOtp
);

// Verify OTP
router.post(
    "/forgot-password/verify",
    forgotPasswordVerifyLimiter,
    validateMiddleware(forgotPasswordVerifySchema),
    passwordResetController.verifyPasswordResetOtp
);

// Reset Password
router.post(
    "/forgot-password/reset",
    forgotPasswordResetLimiter,
    validateMiddleware(forgotPasswordResetSchema),
    passwordResetController.resetPassword
);

// ================== LOGOUT ==================
router.post(
    "/logout",
    authMiddleware,
    authController.logout
);

// ================== CURRENT USER ==================
router.get(
    "/me",
    authMiddleware,
    authController.getCurrentUser
);

// ================== EXPORT ==================
module.exports = router;
