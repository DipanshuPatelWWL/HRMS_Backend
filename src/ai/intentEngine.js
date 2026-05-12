const intents = require("./intents");

/**
 * @param {string} normalisedQuery  - already lower-cased and typo-corrected
 * @returns {object|undefined}
 */
const detectIntent = (normalisedQuery) =>
    intents.find((intent) =>
        intent.patterns.some((pattern) =>
            pattern.test(normalisedQuery)
        )
    );

module.exports = detectIntent;