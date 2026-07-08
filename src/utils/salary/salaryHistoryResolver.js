const moment = require("moment-timezone");
const SalaryHistory = require("../../models/salaryHistory.model");

function normalizeToMonthStart(month, year) {
    return moment
        .tz(`${year}-${String(month).padStart(2, "0")}-01`, "YYYY-MM-DD", "Asia/Kolkata")
        .startOf("day")
        .toDate();
}

/**
 * Resolve the monthly salary that was effective for a given employee
 * during the given month/year, using SalaryHistory.
 * Falls back to the User's current salary.monthly if no history exists yet
 * (safety net for un-migrated employees — should not normally trigger).
 */
async function resolveMonthlySalary(userId, month, year, fallbackSalary = 0) {
    const periodStart = normalizeToMonthStart(month, year);

    const record = await SalaryHistory.findOne({
        employee: userId,
        effectiveFrom: { $lte: periodStart },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: periodStart } }],
    }).sort({ effectiveFrom: -1 });

    return record ? record.monthlySalary : fallbackSalary;
}

module.exports = { resolveMonthlySalary, normalizeToMonthStart };