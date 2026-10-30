
const express = require("express");
const path = require("node:path");
const { existsSync } = require("node:fs");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");

const csrfMiddleware = require("./middleware/csrfMiddleware");
const ExpressError = require("./utils/ExpressError");
const errorMiddleware = require("./middleware/errorMiddleware");

// ================== APPLICATION SETUP ==================
const app = express();

app.disable("x-powered-by");

// ================== PROXY CONFIGURATION ==================
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);

if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10.");
}

if (proxyHops) {
    app.set("trust proxy", proxyHops);
}

// ================== FRONTEND ORIGIN ==================
const clientOrigin = process.env.CLIENT_ORIGIN?.trim();

if (!clientOrigin) {
    throw new Error("CLIENT_ORIGIN is missing in environment configuration.");
}

const clientUrl = new URL(clientOrigin);

if (
    !["http:", "https:"].includes(clientUrl.protocol) ||
    clientUrl.origin !== clientOrigin
) {
    throw new Error("CLIENT_ORIGIN must be a valid HTTP/HTTPS origin.");
}

if (process.env.NODE_ENV === "production" && clientUrl.protocol !== "https:") {
    throw new Error("CLIENT_ORIGIN must use HTTPS in production.");
}

// ================== SECURITY HEADERS ==================
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                imgSrc: [
                    "'self'",
                    "data:",
                    "blob:",
                    "https://res.cloudinary.com",
                ],
                upgradeInsecureRequests:
                    process.env.NODE_ENV === "production" ? [] : null,
            },
        },
    })
);

// ================== CORS CONFIGURATION ==================
app.use(
    cors({
        origin: clientOrigin,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        exposedHeaders: ["Retry-After"],
    })
);

// ================== REQUEST BODY PARSING ==================
app.use(express.json({ limit: "100kb" }));

// ================== COOKIE PARSING ==================
app.use(cookieParser());

// ================== CSRF PROTECTION ==================
app.use("/api", csrfMiddleware);

// ================== HEALTH CHECK ==================
app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "QueryNest AI API is running.",
    });
});




// ================== API ROUTES ==================
app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);





// ================== FRONTEND SERVING ==================
if (process.env.SERVE_FRONTEND === "true") {
    const frontendPath = path.resolve(__dirname, "../frontend/dist");
    const indexPath = path.join(frontendPath, "index.html");

    if (!existsSync(indexPath)) {
        throw new Error("Build the frontend before enabling SERVE_FRONTEND.");
    }

    app.use(express.static(frontendPath, { index: false }));

    app.get("/{*path}", (req, res, next) => {
        if (
            req.path === "/api" ||
            req.path.startsWith("/api/") ||
            path.extname(req.path) ||
            !req.accepts("html")
        ) {
            return next();
        }

        res.set("Cache-Control", "no-store");

        return res.sendFile(indexPath);
    });
}

// ================== ROUTE NOT FOUND ==================
app.use((req, res, next) => {
    next(new ExpressError(404, "Route not found."));
});

// ================== ERROR HANDLER ==================
app.use(errorMiddleware);

// ================== EXPORT ==================
module.exports = app;
