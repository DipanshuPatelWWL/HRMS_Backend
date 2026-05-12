// ─── src/ai/intents/holiday.intent.js ────────────────────────────────────────

const Holiday = require("../../models/holiday.model");

module.exports = {
    name: "holidays",

    patterns: [
        /holiday/i,
        /day\s+off/i,
        /upcoming\s+holiday/i,
        /next\s+holiday/i,
        /public\s+holiday/i,
        /office\s+closed/i,
        /tomorrow\s+holiday/i,
        /holidays\s+this\s+month/i,
    ],

    async handler({ buildResponse }) {
        const today = new Date();
        const next30 = new Date();
        next30.setDate(today.getDate() + 30);

        const holidays = await Holiday
            .find({ date: { $gte: today, $lte: next30 } })
            .sort({ date: 1 })
            .lean();

        return buildResponse(
            holidays.length
                ? `🗓️ Upcoming holidays (next 30 days):\n\n${holidays
                    .map((h) => `• **${h.name}** — ${new Date(h.date).toDateString()} [${h.type}]`)
                    .join("\n")}`
                : "No holidays scheduled in the next 30 days.",
            "db",
            "holidays"
        );
    },
};