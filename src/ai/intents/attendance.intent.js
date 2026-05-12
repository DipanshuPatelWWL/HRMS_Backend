// ─── src/ai/intents/attendance.intent.js ─────────────────────────────────────

const Attendance = require("../../models/attendance.model");
const { todayStart, formatTime } = require("../utils/helpers");
const { setIntent } = require("../memory/session.memory");

module.exports = {
    name: "attendance_today",

    patterns: [
        /punch\s*in/i,
        /punch\s*out/i,
        /punched\s+in/i,
        /am\s+i\s+late/i,
        /today.?s?\s+attendance/i,
        /attendance\s+today/i,
        /did\s+i\s+punch/i,
        /check\s*in/i,
        /check\s*out/i,
        /my\s+punch/i,
        /have\s+i\s+punched/i,
        /when\s+did\s+i\s+punch/i,
        /punch\s+time/i,
        /am\s+i\s+present/i,
        /did\s+i\s+come/i,
        /am\s+i\s+in\s+office/i,
        /am\s+i\s+here\s+today/i,
    ],

    async handler({ user, buildResponse }) {
        const att = await Attendance
            .findOne({ user: user._id, date: { $gte: todayStart() } })
            .lean();

        if (!att) {
            return buildResponse(
                "❌ You have not punched in today.",
                "db",
                "attendance"
            );
        }

        const pIn = att.punchIn ? formatTime(new Date(att.punchIn)) : "—";
        const pOut = att.punchOut ? formatTime(new Date(att.punchOut)) : "Not yet";
        const status = att.isLate ? "⏰ Late"
            : att.isHalfDay ? "🌗 Half-day"
                : "✅ On time";

        return buildResponse(
            `📋 Today's Attendance:\n\n` +
            `• Punch In: **${pIn}**\n` +
            `• Punch Out: **${pOut}**\n` +
            `• Status: ${status}\n` +
            `• Work Hours: ${att.workHours || 0}h` +
            (att.lateMinutes ? `\n• Late by: ${att.lateMinutes} min` : "") +
            (att.overtime ? `\n• Overtime: ${att.overtime} min` : "") +
            (att.isMockLocation ? "\n\n⚠️ Mock location was detected." : "") +
            (att.isOfflinePunch ? "\n📴 Offline punch — synced later." : ""),
            "db",
            "attendance"
        );
    },
};