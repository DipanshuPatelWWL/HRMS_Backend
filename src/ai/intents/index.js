// ─── src/ai/intents/index.js ──────────────────────────────────────────────────
//
// Central intent registry.
// Add new intent files here in the order you want them evaluated.
// The FIRST matching intent wins — put more specific patterns before generic ones.

const salaryIntent = require("./salary.intent");
const payslipIntent = require("./payslip.intent");
const leaveIntent = require("./leave.intent");
const attendanceIntent = require("./attendance.intent");
const holidayIntent = require("./holiday.intent");
const profileIntent = require("./profile.intent");
const ticketIntent = require("./ticket.intent");

module.exports = [
    // Salary must come before payslip (more specific)
    salaryIntent,
    payslipIntent,

    // Leave balance
    leaveIntent,

    // Attendance
    attendanceIntent,

    // Holidays
    holidayIntent,

    // Profile
    profileIntent,

    // Tickets
    ticketIntent,
];