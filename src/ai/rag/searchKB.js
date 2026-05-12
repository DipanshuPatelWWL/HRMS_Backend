const CompanyKB = require("../../models/CompanyKB");
const { generateEmbedding, cosineSimilarity } = require("../services/vector.service");

const SEMANTIC_THRESHOLD = 0.75; // minimum cosine score to accept

// Words too generic to build a reliable keyword query from
const SKIP_KB_WORDS = new Set([
    "my", "i", "me", "what", "who", "is", "are", "the", "a", "an",
    "how", "when", "where", "which", "name", "contact", "tell", "show",
    "give", "get", "find", "please", "can", "you", "does", "do",
    "working", "work", "right", "now", "currently", "today",
    "this", "that", "here", "there", "in", "at", "on", "for",
    "office", "our", "your", "their", "its",
]);

/**
 * Searches the Company Knowledge Base for an answer.
 * Returns the best matching document or null.
 *
 * @param {string} question  - normalised user question
 * @returns {Promise<object|null>}
 */
const searchKB = async (question) => {

    // ── 1. Full-text index (fastest) ──────────────────────────────────────────
    try {
        const textResult = await CompanyKB
            .findOne({ $text: { $search: question } })
            .lean();
        if (textResult) return textResult;
    } catch (_) { /* text index might not exist yet */ }

    // ── 2. Exact alias / question regex ──────────────────────────────────────
    const exact = await CompanyKB.findOne({
        $or: [
            { question: { $regex: question.trim(), $options: "i" } },
            { aliases: { $elemMatch: { $regex: question.trim(), $options: "i" } } },
        ],
    }).lean();
    if (exact) return exact;

    // ── 3. Semantic search (embedding-based) ─────────────────────────────────
    try {
        const queryEmbedding = await generateEmbedding(question);
        const docs = await CompanyKB.find({ embedding: { $exists: true, $ne: [] } }).lean();

        let best = null;
        let bestScore = 0;

        for (const doc of docs) {
            if (!doc.embedding?.length) continue;
            const score = cosineSimilarity(queryEmbedding, doc.embedding);
            if (score > bestScore) {
                bestScore = score;
                best = doc;
            }
        }

        if (bestScore >= SEMANTIC_THRESHOLD) return best;
    } catch (_) {
        // Embedding model not available — fall through to keyword fallback
    }

    // ── 4. Keyword alias scoring (legacy fallback) ───────────────────────────
    const words = question
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !SKIP_KB_WORDS.has(w));

    if (words.length < 2) return null;

    const candidates = await CompanyKB.find({
        aliases: { $elemMatch: { $regex: words.join("|"), $options: "i" } },
    }).lean();

    let best = null;
    let bestScore = 0;

    for (const doc of candidates) {
        const score = words.filter((w) =>
            doc.aliases?.some((a) => a.toLowerCase().includes(w))
        ).length;
        if (score > bestScore) {
            bestScore = score;
            best = doc;
        }
    }

    return bestScore >= 2 ? best : null;
};

module.exports = searchKB;