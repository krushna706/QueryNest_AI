const ExpressError = require("../utils/ExpressError");

// Request validation
function validateMiddleware(schema, { source = "body", jsonFields = [] } = {}) {
    const allowedSources = ["body", "params", "query"];

    if (!allowedSources.includes(source)) {
        throw new Error("Invalid validation source.");
    }

    return (req, res, next) => {
        if (source === "body") {
            for (const field of jsonFields) {
                const fieldValue = req.body?.[field];

                if (fieldValue === undefined) {
                    continue;
                }

                if (typeof fieldValue !== "string") {
                    return next(new ExpressError(400, `${field} must be sent as JSON text.`));
                }

                try {
                    req.body[field] = JSON.parse(fieldValue);
                } catch {
                    return next(new ExpressError(400, `${field} contains invalid JSON.`));
                }
            }
        }

        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            convert: true,
            stripUnknown: false,
        });

        if (error) {
            const message = error.details.map((detail) => detail.message).join(" ");

            return next(new ExpressError(400, message));
        }

        req.validated = req.validated || {};
        req.validated[source] = value;

        if (source === "body") {
            req.body = value;
        }

        return next();
    };
}

// Export
module.exports = validateMiddleware;
