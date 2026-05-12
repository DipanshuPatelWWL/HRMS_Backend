// ─── src/ai/intents/salary.intent.js ─────────────────────────────────────────

const Payroll = require("../../models/payroll.model");
const { formatCurrency, MONTHS, extractMonth } = require("../utils/helpers");
const { setIntent } = require("../memory/session.memory");

module.exports = {
    name: "salary",

    // ── Trigger patterns ──────────────────────────────────────────────────────
    patterns: [
        /my\s+salary/i,
        /monthly\s+salary/i,
        /salary\s+(details|info|amount)/i,
        /my\s+pay\b/i,
        /my\s+ctc/i,
        /my\s+package/i,
        /mera\s+salary/i,
        /meri\s+salary/i,
    ],

    // ── Handler ───────────────────────────────────────────────────────────────
    async handler({ user, role, session, buildResponse }) {

        if (role === "employee" && !user.canViewSalary) {
            return buildResponse(
                "🔒 Your salary details have not been released by HR yet. Please contact HR.",
                "db"
            );
        }

        if (!user.salary?.monthly) {
            return buildResponse(
                "💰 Salary information is not configured yet. Please contact HR.",
                "db"
            );
        }

        return buildResponse(
            `💰 Your Salary Details:\n\n` +
            `• Monthly: **${formatCurrency(user.salary?.monthly)}**\n` +
            `• Per Day: ${formatCurrency(user.salary?.perDay)}`,
            "db",
            "salary", "payslip"
        );
    },
};