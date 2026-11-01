const bcrypt = require("bcrypt");

const User = require("../models/User");
const AuthSession = require("../models/AuthSession");
const ExpressError = require("../utils/ExpressError");
const generateToken = require("../utils/generateToken");

// User response
function getUserResponse(user) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        avatar: {
            url: user.avatar?.url || "",
        },
    };
}

// Authentication configuration
const COOKIE_NAME = "token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;

// Cookie options
function getCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    };
}

// Authentication response
async function sendAuthResponse(res, user, statusCode, message) {
    const { token, tokenHash, expiresAt } = generateToken(user);

    // Save the login session.
    await AuthSession.create({
        userId: user._id,
        tokenHash,
        expiresAt,
    });

    res.cookie(COOKIE_NAME, token, {
        ...getCookieOptions(),
        maxAge: COOKIE_MAX_AGE,
    });

    res.set("Cache-Control", "no-store");

    return res.status(statusCode).json({
        success: true,
        message,
        user: getUserResponse(user),
    });
}

// Signup
// POST /api/auth/signup
async function signup(req, res, next) {
    try {
        const { name, email, phone, password } = req.body;

        // Check existing account details.
        const existingUser = await User.findOne({
            $or: [{ email }, { phone }],
        })
            .select("email phone")
            .lean();

        if (existingUser) {
            if (existingUser.email === email) {
                return next(new ExpressError(409, "This email is already registered."));
            }

            return next(new ExpressError(409, "This phone number is already registered."));
        }

        // Hash the password before saving.
        const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

        const user = await User.create({
            name,
            email,
            phone,
            passwordHash,
            role: "user",
            status: "Active",
            tokenVersion: 0,
        });

        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            success: true,
            message: "Account created successfully. Please sign in.",
            user: getUserResponse(user),
        });
    } catch (error) {
        return next(error);
    }
}

// Login
// POST /api/auth/login
async function login(req, res, next) {
    try {
        const { identifier, password } = req.body;

        // Find account by email or phone.
        const isEmail = identifier.includes("@");

        const user = await User.findOne(isEmail ? { email: identifier } : { phone: identifier }).select(
            "+passwordHash +tokenVersion"
        );

        if (!user) {
            return next(new ExpressError(401, "Invalid login credentials."));
        }

        // Verify password.
        const passwordMatches = await bcrypt.compare(password, user.passwordHash);

        if (!passwordMatches) {
            return next(new ExpressError(401, "Invalid login credentials."));
        }

        if (user.status !== "Active") {
            return next(new ExpressError(403, "Your account is inactive."));
        }

        // Recheck account before creating the session.
        const currentUser = await User.findOneAndUpdate(
            {
                _id: user._id,
                role: "user",
                status: "Active",
                passwordHash: user.passwordHash,
                tokenVersion: user.tokenVersion,
            },
            {
                $set: {
                    lastLoginAt: new Date(),
                },
            },
            {
                returnDocument: "after",
                runValidators: true,
            }
        ).select("+tokenVersion");

        if (!currentUser) {
            return next(new ExpressError(401, "Account details changed. Please login again."));
        }

        return await sendAuthResponse(res, currentUser, 200, "Login successful.");
    } catch (error) {
        return next(error);
    }
}

// Logout
// POST /api/auth/logout
async function logout(req, res, next) {
    try {
        // Revoke the current login session.
        await AuthSession.updateOne(
            {
                _id: req.user.sessionId,
                userId: req.user._id,
                revokedAt: null,
            },
            {
                $set: {
                    revokedAt: new Date(),
                },
            }
        );

        res.clearCookie(COOKIE_NAME, getCookieOptions());
        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            message: "Logged out successfully.",
        });
    } catch (error) {
        return next(error);
    }
}

// Current user
// GET /api/auth/me
async function getCurrentUser(req, res, next) {
    try {
        const user = await User.findById(req.user._id)
            .select("name email phone role status createdAt avatar.url")
            .lean();

        if (!user) {
            return next(new ExpressError(401, "Please login again."));
        }

        if (user.status !== "Active") {
            return next(new ExpressError(403, "Your account is inactive."));
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            user: getUserResponse(user),
        });
    } catch (error) {
        return next(error);
    }
}

// Exports
module.exports = {
    signup,
    login,
    logout,
    getCurrentUser,
};
