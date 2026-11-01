const ExpressError = require("../utils/ExpressError");

// Central error handler
function errorMiddleware(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    let statusCode = 500;
    let message = "Something went wrong. Please try again later.";

    if (
        error instanceof ExpressError &&
        Number.isInteger(error.statusCode) &&
        error.statusCode >= 400 &&
        error.statusCode <= 599
    ) {
        statusCode = error.statusCode;
        message = error.message;
    }

    if (error.code === 11000) {
        const fields = Object.keys(error.keyPattern || error.keyValue || {});

        statusCode = 409;

        if (fields.includes("email")) {
            message = "This email is already registered.";
        } else if (fields.includes("phone")) {
            message = "This phone number is already registered.";
        } else {
            message = "A record with these details already exists.";
        }
    }

    if (error.type === "entity.parse.failed" && error.status === 400) {
        statusCode = 400;
        message = "Invalid JSON in request body.";
    }

    if (error.type === "entity.too.large" && error.status === 413) {
        statusCode = 413;
        message = "Request body is too large.";
    }

    if (statusCode >= 500) {
        if (process.env.NODE_ENV !== "production") {
            console.error("Server error:", error.stack || error.message);
        } else {
            console.error("An unexpected server error occurred.");
        }
    }

    return res.status(statusCode).json({
        success: false,
        message,
    });
}

// Export
module.exports = errorMiddleware;
