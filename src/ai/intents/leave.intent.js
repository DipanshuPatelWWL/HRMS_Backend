// ─── src/ai/intents/leave.intent.js ──────────────────────────────────────────

const Leave = require("../../models/leave.model");
const { setIntent } = require("../memory/session.memory");
const { isPrivileged, isHRLevel } = require("../security/roleGuards");

module.exports = {
    name: "leave_balance",

    patterns: [
        /leave\s+balance/i,
        /how\s+many\s+leaves?/i,
        /remaining\s+leave/i,
        /leave\s+left/i,
        /leave\s+remaining/i,
        /kitne\s+leave/i,
        /leave\s+bache/i,
        /leaves?\s+left/i,
    ],

    async handler({ user, buildResponse }) {
        const used = user.leaveBalance?.used || 0;
        const total = user.leaveBalance?.total || 0;
        const remaining = total - used;

        const leaveRecords = await Leave
            .find({ user: user._id, status: "approved" })
            .lean();

        const byType = { casual: 0, sick: 0, earned: 0, unpaid: 0 };
        leaveRecords.forEach((l) => {
            byType[l.type] = (byType[l.type] || 0) + l.totalDays;
        });

        return buildResponse(
            `📋 Your Leave Balance:\n\n` +
            `• Total: ${total} days\n` +
            `• Used: ${used} days\n` +
            `• Remaining: **${remaining} days**\n\n` +
            `Breakdown:\n` +
            `• Casual: ${byType.casual} | Sick: ${byType.sick} | Earned: ${byType.earned} | Unpaid: ${byType.unpaid}`,
            "db",
            "leaves"
        );
    },
};