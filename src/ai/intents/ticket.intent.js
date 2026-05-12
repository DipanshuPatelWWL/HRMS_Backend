// ─── src/ai/intents/ticket.intent.js ─────────────────────────────────────────

const Ticket = require("../../models/ticket.model");
const { isHRLevel } = require("../security/roleGuards");

module.exports = {
    name: "tickets",

    patterns: [
        /my\s+ticket/i,
        /my\s+tickets/i,
        /ticket\s+status/i,
        /raised\s+ticket/i,
        /ticket\s+raised/i,
        /support\s+ticket/i,
    ],

    async handler({ user, buildResponse }) {
        const tickets = await Ticket
            .find({ user: user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        return buildResponse(
            tickets.length
                ? `🎫 Your recent support tickets:\n\n${tickets
                    .map((t) => `• [${t.ticketId}] **${t.title}**\n  Status: ${t.status} | Priority: ${t.priority}`)
                    .join("\n\n")}`
                : "You have not raised any support tickets yet.",
            "db",
            "tickets"
        );
    },
};