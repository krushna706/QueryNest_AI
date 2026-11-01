const express = require("express");
const path = require("node:path");
const { existsSync } = require("node:fs");

const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Api routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const documentRoutes = require("./routes/documentRoutes");
const usageRoutes = require("./routes/usageRoutes");

// Middleware
const csrfMiddleware = require("./middleware/csrfMiddleware");
const errorMiddleware = require("./middleware/errorMiddleware");

const ExpressError = require("./utils/ExpressError");

// Application setup
const app = express();

app.disable("x-powered-by");

// Proxy configuration
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);

if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10.");
}

if (proxyHops) {
    app.set("trust proxy", proxyHops);
}

// Frontend origin
const clientOrigin = process.env.CLIENT_ORIGIN?.trim();

if (!clientOrigin) {
    throw new Error("CLIENT_ORIGIN is missing in environment configuration.");
}

const clientUrl = new URL(clientOrigin);

if (!["http:", "https:"].includes(clientUrl.protocol) || clientUrl.origin !== clientOrigin) {
    throw new Error("CLIENT_ORIGIN must be a valid HTTP/HTTPS origin.");
}

if (process.env.NODE_ENV === "production" && clientUrl.protocol !== "https:") {
    throw new Error("CLIENT_ORIGIN must use HTTPS in production.");
}

// Security headers
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],

                upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
            },
        },
    })
);

// Cors configuration
app.use(
    cors({
        origin: clientOrigin,
        credentials: true,

        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

        allowedHeaders: ["Content-Type"],

        exposedHeaders: ["Retry-After"],
    })
);

// Request body parsing
app.use(
    express.json({
        limit: "100kb",
    })
);

// Cookie parsing
app.use(cookieParser());

// Csrf protection
app.use("/api", csrfMiddleware);

if (req.query.proxyCheck === "1") {
    console.log("Proxy check:", JSON.stringify({
        trustProxy: app.get("trust proxy"),
        clientIp: req.ip,
        socketIp: req.socket.remoteAddress,
        forwardedFor: req.get("x-forwarded-for"),
        protocol: req.protocol,
    }));
}

// Health check
app.get("/api/health", (req, res) => {
    return res.status(200).json({
        success: true,
        message: "QueryNest AI API is running.",
    });
});

// Required api routes
app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);

// User profile routes
if (typeof userRoutes !== "function") {
    throw new TypeError("userRoutes.js must export an Express Router.");
}

app.use("/api/users", userRoutes);

// Document routes
if (typeof documentRoutes === "function") {
    app.use("/api/documents", documentRoutes);
}

// Usage routes
if (typeof usageRoutes === "function") {
    app.use("/api/usage", usageRoutes);
}

// Frontend serving
if (process.env.SERVE_FRONTEND === "true") {
    const frontendPath = path.resolve(__dirname, "../frontend/dist");

    const indexPath = path.join(frontendPath, "index.html");

    if (!existsSync(indexPath)) {
        throw new Error("Build the frontend before enabling SERVE_FRONTEND.");
    }

    // Static frontend files
    app.use(
        express.static(frontendPath, {
            index: false,
        })
    );

    // React router fallback
    app.get("/{*path}", (req, res, next) => {
        if (req.path === "/api" || req.path.startsWith("/api/") || path.extname(req.path) || !req.accepts("html")) {
            return next();
        }

        res.set("Cache-Control", "no-store");

        return res.sendFile(indexPath);
    });
}

// Route not found
app.use((req, res, next) => {
    return next(new ExpressError(404, "Route not found."));
});

// Global error handler
app.use(errorMiddleware);

// Export
module.exports = app;
