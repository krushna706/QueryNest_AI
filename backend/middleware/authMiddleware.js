
const jwt = require("jsonwebtoken");
const { createHash } = require("node:crypto");

const User = require("../models/User");
const AuthSession = require("../models/AuthSession");
const ExpressError = require("../utils/ExpressError");

// ================== AUTHENTICATION MIDDLEWARE ==================
async function authMiddleware(req, res, next) {
    try {
        const token = req.cookies?.token;

        if (typeof token !== "string" || !token) {
            return next(new ExpressError(401, "Please login to continue."));
        }

        const secret = process.env.JWT_SECRET;

        if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
            throw new Error("Invalid JWT_SECRET configuration.");
        }

        // ================== VERIFY JWT ==================
        let decoded;

        try {
            decoded = jwt.verify(token, secret, {
                algorithms: ["HS256"],
                issuer: "querynest-ai",
                audience: "querynest-ai-api",
            });
        } catch (error) {
            if (
                error.name === "TokenExpiredError" ||
                error.name === "JsonWebTokenError" ||
                error.name === "NotBeforeError"
            ) {
                return next(
                    new ExpressError(401, "Your session is invalid or expired. Please login again.")
                );
            }

            throw error;
        }

        // ================== VALIDATE TOKEN DATA ==================
        if (
            !decoded ||
            typeof decoded !== "object" ||
            typeof decoded.sub !== "string" ||
            !/^[a-fA-F0-9]{24}$/.test(decoded.sub) ||
            typeof decoded.jti !== "string" ||
            !/^[a-f0-9]{64}$/.test(decoded.jti) ||
            !Number.isSafeInteger(decoded.tokenVersion) ||
            decoded.tokenVersion < 0 ||
            !Number.isInteger(decoded.exp)
        ) {
            return next(
                new ExpressError(401, "Your session is invalid. Please login again.")
            );
        }

        // ================== VERIFY USER ==================
        const user = await User.findById(decoded.sub)
            .select("_id role status +tokenVersion")
            .lean();

        if (!user) {
            return next(
                new ExpressError(401, "Your session is invalid. Please login again.")
            );
        }

        if (user.status !== "Active") {
            return next(
                new ExpressError(403, "Your account is inactive.")
            );
        }

        if (
            user.role !== "user" ||
            user.tokenVersion !== decoded.tokenVersion
        ) {
            return next(
                new ExpressError(401, "Your session has ended. Please login again.")
            );
        }

        // ================== VERIFY ACTIVE SESSION ==================
        const tokenHash = createHash("sha256")
            .update(decoded.jti)
            .digest("hex");

        const session = await AuthSession.findOne({
            userId: user._id,
            tokenHash,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        })
            .select("_id")
            .lean();

        if (!session) {
            return next(
                new ExpressError(401, "Your session has ended. Please login again.")
            );
        }

        // ================== AUTHENTICATED USER ==================
        req.user = {
            _id: user._id,
            role: user.role,
            status: user.status,
            sessionId: session._id,
        };

        return next();
    } catch (error) {
        return next(error);
    }
}

// ================== EXPORT ==================
module.exports = authMiddleware;
