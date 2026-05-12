const rateLimit = require("express-rate-limit");

/**
 * AI Rate Limiter
 * Limits each authenticated user
 * to 30 AI requests per minute.
 */

const aiRateLimit = rateLimit({

    windowMs: 60 * 1000,

    max: 30,

    standardHeaders: true,

    legacyHeaders: false,

    keyGenerator: (req) =>
        req.user._id.toString(),

    message: {
        success: false,
        message:
            "Too many AI requests. Please wait a moment and try again.",
    },
});

module.exports = aiRateLimit;