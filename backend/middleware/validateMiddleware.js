
const ExpressError = require("../utils/ExpressError");

// ================== REQUEST VALIDATION ==================
function validateMiddleware(schema, { source = "body", jsonFields = [] } = {}) {
    const allowedSources = ["body", "params", "query"];

    if (!allowedSources.includes(source)) {
        throw new Error("Invalid validation source.");
    }

    return (req, res, next) => {
        // ================== PARSE JSON FIELDS ==================
        if (source === "body") {
            for (const field of jsonFields) {
                const fieldValue = req.body?.[field];

                if (fieldValue === undefined) {
                    continue;
                }

                if (typeof fieldValue !== "string") {
                    return next(
                        new ExpressError(400, `${field} must be sent as JSON text.`)
                    );
                }

                try {
                    req.body[field] = JSON.parse(fieldValue);
                } catch {
                    return next(
                        new ExpressError(400, `${field} contains invalid JSON.`)
                    );
                }
            }
        }

        // ================== VALIDATE REQUEST ==================
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            convert: true,
            stripUnknown: false,
        });

        if (error) {
            const message = error.details
                .map((detail) => detail.message)
                .join(" ");

            return next(new ExpressError(400, message));
        }

        // ================== VALIDATED DATA ==================
        req.validated = req.validated || {};
        req.validated[source] = value;

        if (source === "body") {
            req.body = value;
        }

        return next();
    };
}

// ================== EXPORT ==================
module.exports = validateMiddleware;
