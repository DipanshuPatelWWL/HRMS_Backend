// ─── src/ai/memory/unanswered.memory.js ──────────────────────────────────────

const UnansweredQ = require("../../models/UnansweredQ");

/**
 * Persists a question the AI could not answer.
 * Upserts so repeated failures increment the count rather than creating duplicates.
 *
 * @param {string} question
 * @param {string} userId
 * @param {string} role
 */
const saveUnanswered = async (question, userId, role) => {
    const normalised = question.toLowerCase().trim().replace(/[?!.,]+$/, "");

    await UnansweredQ.findOneAndUpdate(
        { question: normalised },
        {
            $inc: { count: 1 },
            $set: { user: userId, role },
            $setOnInsert: { status: "pending" },  // ✅ only set on first insert
        },
        { upsert: true }
    ).catch(() => { /* never crash the main flow */ });
};

module.exports = { saveUnanswered };