// ─── src/ai/memory/session.memory.js ─────────────────────────────────────────

const AISession = require("../../models/aiSession.model");

/**
 * Retrieves or creates the AI session for this user.
 * @param {string} userId
 * @returns {Promise<AISession>}
 */
const getOrCreateSession = async (userId) => {
    let session = await AISession.findOne({ user: userId });
    if (!session) {
        session = await AISession.create({ user: userId });
    }
    return session;
};

/**
 * Clears the pending intent and any context stored on the session.
 * @param {AISession} session
 */
const clearIntent = async (session) => {
    session.pendingIntent = null;
    session.context = {};
    await session.save();
};

/**
 * Sets a pending intent so the next user message continues this flow.
 * @param {AISession} session
 * @param {string} intent
 * @param {object} [ctx={}]
 */
const setIntent = async (session, intent, ctx = {}) => {
    session.pendingIntent = intent;
    session.context = ctx;
    // Refresh TTL (10 minutes from now)
    session.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await session.save();
};

module.exports = { getOrCreateSession, clearIntent, setIntent };