
 // ================== CUSTOM ERROR CLASS ==================
class ExpressError extends Error {
    constructor(statusCode, message) {
        super(message);

        this.name = "ExpressError";
        this.statusCode = statusCode;

        Error.captureStackTrace(this, ExpressError);
    }
}

// ================== EXPORT ==================
module.exports = ExpressError;
