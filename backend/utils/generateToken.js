
const jwt = require("jsonwebtoken");
const { randomBytes, createHash } = require("node:crypto");

// ================== TOKEN CONFIGURATION ==================
const TOKEN_EXPIRY = "7d";

// ================== GENERATE AUTHENTICATION TOKEN ==================
function generateToken(user) {
    const secret = process.env.JWT_SECRET;

    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
        throw new Error("JWT_SECRET must contain at least 32 bytes.");
    }

    if (
        !user?._id ||
        !Number.isSafeInteger(user.tokenVersion) ||
        user.tokenVersion < 0
    ) {
        throw new Error("Invalid user data for token generation.");
    }

    // ================== SESSION IDENTIFIER ==================
    const sessionId = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
        .update(sessionId)
        .digest("hex");

    // ================== JWT TOKEN ==================
    const token = jwt.sign(
        {
            tokenVersion: user.tokenVersion,
        },
        secret,
        {
            algorithm: "HS256",
            subject: user._id.toString(),
            issuer: "querynest-ai",
            audience: "querynest-ai-api",
            jwtid: sessionId,
            expiresIn: TOKEN_EXPIRY,
        }
    );

    // ================== SESSION EXPIRY ==================
    const expiresAt = new Date(jwt.decode(token).exp * 1000);

    return {
        token,
        tokenHash,
        expiresAt,
    };
}

// ================== EXPORT ==================
module.exports = generateToken;
