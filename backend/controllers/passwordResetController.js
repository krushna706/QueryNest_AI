
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require("node:crypto");

const User = require("../models/User");
const PasswordReset = require("../models/PasswordReset");
const AuthSession = require("../models/AuthSession");
const ExpressError = require("../utils/ExpressError");

const { sendPasswordResetOtpEmail, OTP_VALIDITY_MINUTES } = require("../config/email");

// ================== PASSWORD RESET CONFIGURATION ==================
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 60 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_HOUR = 10;
const MAX_WRONG_OTP_ATTEMPTS = 5;
const RESET_TOKEN_VALIDITY_MS = 10 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

const GENERIC_REQUEST_MESSAGE =
    "If an active account matches these details, a verification code will be sent to its registered email.";

const INVALID_OTP_MESSAGE = "Invalid or expired verification code.";

// ================== RESPONSE HELPER ==================
function sendNoCache(res, statusCode, data) {
    res.set("Cache-Control", "no-store");
    return res.status(statusCode).json(data);
}

// ================== FIND ACCOUNT ==================
async function findRecoveryAccount(identifier) {
    const normalized = identifier.trim().toLowerCase();

    const query = normalized.includes("@")
        ? { email: normalized }
        : { phone: normalized };

    return User.findOne({
        ...query,
        status: "Active",
    });
}

// ================== OTP HASH ==================
function otpDigest(userId, otp) {
    const secret = process.env.JWT_SECRET;

    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
        throw new Error("JWT_SECRET is missing or too short.");
    }

    return createHmac("sha256", secret)
        .update(`querynest-ai:password-reset:${userId}:${otp}`)
        .digest("hex");
}

// ================== RESET TOKEN HASH ==================
function tokenDigest(token) {
    return createHash("sha256")
        .update(token)
        .digest("hex");
}

// ================== COMPARE HASHES ==================
function sameHash(first, second) {
    if (
        !/^[a-f0-9]{64}$/.test(first || "") ||
        !/^[a-f0-9]{64}$/.test(second || "")
    ) {
        return false;
    }

    return timingSafeEqual(
        Buffer.from(first, "hex"),
        Buffer.from(second, "hex")
    );
}

// ================== MASK EMAIL ==================
function maskedEmail(email) {
    const [local, domain] = String(email || "").split("@");

    if (!local || !domain) {
        return "****";
    }

    if (local.length < 8) {
        return `${local.slice(0, 1)}****@${domain}`;
    }

    return `${local.slice(0, 2)}****${local.slice(-2)}@${domain}`;
}

// ================== REQUEST PASSWORD RESET OTP ==================
async function requestPasswordResetOtp(req, res, next) {
    try {
        const account = await findRecoveryAccount(req.body.identifier);

        const response = {
            success: true,
            message: GENERIC_REQUEST_MESSAGE,
            resendCooldownSeconds: 60,
        };

        if (!account) {
            return sendNoCache(res, 200, response);
        }

        // ================== CHECK OTP LIMITS ==================
        const now = new Date();
        const nowMs = now.getTime();

        const previous = await PasswordReset.findOne({
            userId: account._id,
        });

        const windowStart = previous?.requestWindowStartedAt?.getTime();

        const inCurrentWindow =
            Number.isFinite(windowStart) &&
            windowStart <= nowMs &&
            nowMs - windowStart < OTP_WINDOW_MS;

        const requestsInWindow = inCurrentWindow
            ? previous.requestsInWindow
            : 0;

        if (
            requestsInWindow >= MAX_OTP_REQUESTS_PER_HOUR ||
            (previous?.resendAvailableAt?.getTime() || 0) > nowMs
        ) {
            return sendNoCache(res, 200, response);
        }

        // ================== GENERATE OTP ==================
        const otp = String(randomInt(0, 1000000)).padStart(6, "0");
        const otpHash = otpDigest(account._id, otp);

        const resetData = {
            otpHash,
            otpExpiresAt: new Date(nowMs + OTP_VALIDITY_MINUTES * 60 * 1000),
            failedAttempts: 0,
            resendAvailableAt: new Date(nowMs + OTP_COOLDOWN_MS),
            requestWindowStartedAt: inCurrentWindow
                ? previous.requestWindowStartedAt
                : now,
            requestsInWindow: requestsInWindow + 1,
            verificationTokenHash: null,
            verificationExpiresAt: null,
        };

        // ================== SAVE OTP ==================
        let reserved = false;

        if (previous) {
            const result = await PasswordReset.updateOne(
                {
                    _id: previous._id,
                    __v: previous.__v,
                },
                {
                    $set: resetData,
                    $inc: { __v: 1 },
                },
                {
                    runValidators: true,
                }
            );

            reserved = result.modifiedCount === 1;
        } else {
            try {
                await PasswordReset.create({
                    userId: account._id,
                    ...resetData,
                });

                reserved = true;
            } catch (error) {
                if (error.code !== 11000) {
                    throw error;
                }
            }
        }

        if (!reserved) {
            return sendNoCache(res, 200, response);
        }

        // ================== SEND EMAIL ==================
        try {
            await sendPasswordResetOtpEmail({
                toEmail: account.email,
                otp,
                name: account.name,
            });
        } catch (error) {
            await PasswordReset.updateOne(
                {
                    userId: account._id,
                    otpHash,
                },
                {
                    $set: {
                        otpHash: null,
                        otpExpiresAt: null,
                    },
                }
            ).catch(() => {});

            console.error(
                "Password reset email failed:",
                error.code || "EMAIL_SEND_FAILED"
            );
        }

        return sendNoCache(res, 200, response);
    } catch (error) {
        return next(error);
    }
}

// ================== VERIFY PASSWORD RESET OTP ==================
async function verifyPasswordResetOtp(req, res, next) {
    try {
        const { identifier, otp } = req.body;

        const account = await findRecoveryAccount(identifier);

        if (!account) {
            return next(new ExpressError(400, INVALID_OTP_MESSAGE));
        }

        const stored = await PasswordReset.findOne({
            userId: account._id,
        }).select("+otpHash");

        const now = new Date();

        if (
            !stored?.otpHash ||
            !stored.otpExpiresAt ||
            stored.otpExpiresAt <= now ||
            stored.failedAttempts >= MAX_WRONG_OTP_ATTEMPTS
        ) {
            return next(new ExpressError(400, INVALID_OTP_MESSAGE));
        }

        // ================== VERIFY OTP ==================
        const incomingHash = otpDigest(account._id, otp);

        if (!sameHash(stored.otpHash, incomingHash)) {
            await PasswordReset.updateOne(
                {
                    _id: stored._id,
                    otpHash: stored.otpHash,
                    otpExpiresAt: { $gt: now },
                    failedAttempts: { $lt: MAX_WRONG_OTP_ATTEMPTS },
                },
                {
                    $inc: { failedAttempts: 1 },
                }
            );

            return next(new ExpressError(400, INVALID_OTP_MESSAGE));
        }

        // ================== CREATE RESET TOKEN ==================
        const resetToken = randomBytes(32).toString("hex");
        const verificationTokenHash = tokenDigest(resetToken);

        const verified = await PasswordReset.updateOne(
            {
                _id: stored._id,
                otpHash: stored.otpHash,
                otpExpiresAt: { $gt: now },
                failedAttempts: { $lt: MAX_WRONG_OTP_ATTEMPTS },
            },
            {
                $set: {
                    otpHash: null,
                    otpExpiresAt: null,
                    verificationTokenHash,
                    verificationExpiresAt: new Date(
                        now.getTime() + RESET_TOKEN_VALIDITY_MS
                    ),
                },
            },
            {
                runValidators: true,
            }
        );

        if (verified.modifiedCount !== 1) {
            return next(new ExpressError(400, INVALID_OTP_MESSAGE));
        }

        return sendNoCache(res, 200, {
            success: true,
            message: "Verification successful. Set your new password.",
            resetToken,
            resetExpiresInSeconds: RESET_TOKEN_VALIDITY_MS / 1000,
            maskedEmail: maskedEmail(account.email),
        });
    } catch (error) {
        return next(error);
    }
}

// ================== RESET PASSWORD ==================
async function resetPassword(req, res, next) {
    try {
        const { resetToken, newPassword } = req.body;

        const verificationTokenHash = tokenDigest(resetToken);
        const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

        // ================== UPDATE PASSWORD AND SESSIONS ==================
        await mongoose.connection.transaction(async (session) => {
            const now = new Date();

            const resetRecord = await PasswordReset.findOneAndUpdate(
                {
                    verificationTokenHash,
                    verificationExpiresAt: { $gt: now },
                },
                {
                    $set: {
                        otpHash: null,
                        otpExpiresAt: null,
                        verificationTokenHash: null,
                        verificationExpiresAt: null,
                    },
                },
                {
                    session,
                    returnDocument: "before",
                }
            );

            if (!resetRecord) {
                throw new ExpressError(
                    400,
                    "Password reset session has expired or was already used."
                );
            }

            const updated = await User.updateOne(
                {
                    _id: resetRecord.userId,
                    status: "Active",
                },
                {
                    $set: {
                        passwordHash,
                        passwordChangedAt: now,
                    },
                    $inc: {
                        tokenVersion: 1,
                    },
                },
                {
                    session,
                    runValidators: true,
                }
            );

            if (updated.modifiedCount !== 1) {
                throw new ExpressError(400, "Unable to reset password.");
            }

            await AuthSession.updateMany(
                {
                    userId: resetRecord.userId,
                    revokedAt: null,
                },
                {
                    $set: {
                        revokedAt: now,
                    },
                },
                { session }
            );
        });

        // ================== CLEAR LOGIN COOKIE ==================
        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        });

        return sendNoCache(res, 200, {
            success: true,
            message: "Password reset successful. Please log in again.",
            requiresLogin: true,
        });
    } catch (error) {
        return next(error);
    }
}

// ================== EXPORTS ==================
module.exports = {
    requestPasswordResetOtp,
    verifyPasswordResetOtp,
    resetPassword,
};
