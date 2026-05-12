// ─── src/ai/security/promptInjection.js ──────────────────────────────────────

/**
 * Patterns that indicate an attempt to hijack the AI prompt.
 * If any match, we reject the query before it reaches Ollama.
 */
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /you\s+are\s+now\s+/i,
    /act\s+as\s+/i,
    /pretend\s+(you\s+are|to\s+be)/i,
    /override\s+(your\s+)?(instructions?|rules?)/i,
    /reveal\s+(all\s+)?(salary|payroll|database|schema)/i,
    /show\s+(me\s+)?(all\s+)?(employee|salary|payroll)/i,
    /system\s+prompt/i,
    /jailbreak/i,
    /developer\s+mode/i,
    /DAN\s+mode/i,
];

/**
 * Checks whether a query looks like a prompt injection attempt.
 * @param {string} question
 * @returns {boolean}
 */
const isInjectionAttempt = (question) =>
    INJECTION_PATTERNS.some((p) => p.test(question));

module.exports = { isInjectionAttempt };