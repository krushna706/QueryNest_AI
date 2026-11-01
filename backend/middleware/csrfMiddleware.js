const ExpressError = require("../utils/ExpressError");

// Csrf protection
function csrfMiddleware(req, res, next) {
    // Skip safe HTTP methods.
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        return next();
    }

    const clientOrigin = process.env.CLIENT_ORIGIN;
    let requestOrigin = req.get("Origin");

    // Check Referer when Origin is unavailable.
    if (!requestOrigin) {
        const referer = req.get("Referer");

        if (referer) {
            try {
                requestOrigin = new URL(referer).origin;
            } catch {
                return next(new ExpressError(403, "Invalid request origin."));
            }
        }
    }

    // Block requests from untrusted origins.
    if (requestOrigin !== clientOrigin) {
        return next(new ExpressError(403, "Request origin is not allowed."));
    }

    return next();
}

// Export
module.exports = csrfMiddleware;
