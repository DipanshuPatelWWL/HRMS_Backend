// ─── src/ai/intents/payslip.intent.js ────────────────────────────────────────

const Payroll = require("../../models/payroll.model");
const { MONTHS, extractMonth } = require("../utils/helpers");
const { setIntent } = require("../memory/session.memory");

module.exports = {
    name: "payslip",

    patterns: [
        /payslip/i,
        /pay\s+slip/i,
        /salary\s+slip/i,
        /net\s+salary/i,
        /net\s+pay/i,
        /salary\s+of\s+(month|this|last)/i,
    ],

    async handler({ user, session, buildResponse }) {
        await setIntent(session, "payroll_month");
        return buildResponse(
            "📅 Sure! Which month's salary slip would you like?\n(e.g. January, February, March...)",
            "db",
            "payslip"
        );
    },
};