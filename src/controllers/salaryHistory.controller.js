const moment = require("moment-timezone");
const SalaryHistory = require("../models/salaryHistory.model");
const User = require("../models/user.model");
const { normalizeToMonthStart } = require("../utils/salary/salaryHistoryResolver");
const { getFYBounds } = require("../utils/salary/financialYear");

const round2 = (n) => Math.round(n * 100) / 100;

// HR can only manage/view employee & tl salaries.
// Manager/superadmin can view/manage everyone, including HR.
function canAccessSalary(reqUser, targetUser) {
    if (["manager", "superadmin"].includes(reqUser.role)) return true;
    if (reqUser.role === "hr") return ["employee", "tl"].includes(targetUser.role);
    return false;
}

// ─────────────────────────────────────────────
//  RECORD A SALARY INCREMENT
//  POST /users/:id/salary-increment
//  body: { newSalary, effectiveMonth, effectiveYear, reason }
// ─────────────────────────────────────────────
const recordSalaryIncrement = async (req, res) => {
    try {
        const { id } = req.params;
        const { newSalary, effectiveMonth, effectiveYear, reason } = req.body;

        if (!newSalary || newSalary <= 0) {
            return res.status(400).json({ success: false, message: "A valid newSalary is required" });
        }
        if (!effectiveMonth || !effectiveYear) {
            return res.status(400).json({ success: false, message: "effectiveMonth and effectiveYear are required" });
        }

        const targetUser = await User.findById(id);
        if (!targetUser) return res.status(404).json({ success: false, message: "Employee not found" });

        if (!canAccessSalary(req.user, targetUser)) {
            return res.status(403).json({ success: false, message: "Not authorized to change this employee's salary" });
        }

        // v1 rule: always normalize to the 1st of the chosen month (IST)
        const effectiveFrom = normalizeToMonthStart(effectiveMonth, effectiveYear);

        const currentRecord = await SalaryHistory.findOne({ employee: id, effectiveTo: null })
            .sort({ effectiveFrom: -1 });

        if (currentRecord && currentRecord.effectiveFrom.getTime() >= effectiveFrom.getTime()) {
            return res.status(400).json({
                success: false,
                message: "New effective date must be after the current active salary's effective date",
            });
        }

        const previousSalary = currentRecord ? currentRecord.monthlySalary : (targetUser.salary?.monthly || 0);
        const incrementAmount = round2(newSalary - previousSalary);
        const incrementPercent = previousSalary > 0 ? round2((incrementAmount / previousSalary) * 100) : 0;

        // Close the old record the day before the new one starts
        if (currentRecord) {
            currentRecord.effectiveTo = moment(effectiveFrom).subtract(1, "day").endOf("day").toDate();
            await currentRecord.save();
        }

        const newRecord = await SalaryHistory.create({
            employee: id,
            monthlySalary: newSalary,
            previousSalary,
            incrementAmount,
            incrementPercent,
            effectiveFrom,
            effectiveTo: null,
            reason: reason || "",
            changedBy: req.user._id,
        });

        // Keep User.salary.monthly (the "current salary" cache used elsewhere in the app)
        // in sync — but only if this increment has already taken effect, not if it's
        // scheduled for a future month.
        const currentMonthStart = normalizeToMonthStart(moment().month() + 1, moment().year());
        if (effectiveFrom.getTime() <= currentMonthStart.getTime()) {
            targetUser.salary.monthly = newSalary;
            await targetUser.save();
        }

        res.status(201).json({ success: true, message: "Salary increment recorded", record: newRecord });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET SALARY HISTORY
//  GET /users/:id/salary-history
// ─────────────────────────────────────────────
const getSalaryHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const targetUser = await User.findById(id);
        if (!targetUser) return res.status(404).json({ success: false, message: "Employee not found" });

        if (!canAccessSalary(req.user, targetUser)) {
            return res.status(403).json({ success: false, message: "Not authorized to view this employee's salary history" });
        }

        const history = await SalaryHistory.find({ employee: id })
            .populate("changedBy", "name")
            .sort({ effectiveFrom: -1 });

        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET INCREMENT STATS  (last increment, yearly totals)
//  GET /users/:id/increment-stats
// ─────────────────────────────────────────────
const getIncrementStats = async (req, res) => {
    try {
        const { id } = req.params;
        const targetUser = await User.findById(id);
        if (!targetUser) return res.status(404).json({ success: false, message: "Employee not found" });

        if (!canAccessSalary(req.user, targetUser)) {
            return res.status(403).json({ success: false, message: "Not authorized to view this employee's salary data" });
        }

        const currentRecord = await SalaryHistory.findOne({ employee: id, effectiveTo: null })
            .sort({ effectiveFrom: -1 });

        const { start: fyStart, label: fyLabel } = getFYBounds(new Date());

        if (!currentRecord) {
            return res.json({
                success: true,
                stats: {
                    currentSalary: targetUser.salary?.monthly || 0,
                    lastIncrementAmount: 0,
                    lastIncrementPercent: 0,
                    lastIncrementDate: null,
                    yearlyIncrementAmount: 0,
                    yearlyIncrementPercent: 0,
                    financialYear: fyLabel,
                    note: "No salary history recorded yet for this employee",
                },
            });
        }

        // Salary that was active at the start of the current financial year
        const fyBaselineRecord = await SalaryHistory.findOne({
            employee: id,
            effectiveFrom: { $lte: fyStart },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: fyStart } }],
        }).sort({ effectiveFrom: -1 });

        let baselineSalary;
        let sinceJoiningThisYear = false;

        if (fyBaselineRecord) {
            baselineSalary = fyBaselineRecord.monthlySalary;
        } else {
            // Earliest record is after FY start → employee joined mid-year
            const earliest = await SalaryHistory.findOne({ employee: id }).sort({ effectiveFrom: 1 });
            baselineSalary = earliest ? earliest.monthlySalary : currentRecord.monthlySalary;
            sinceJoiningThisYear = true;
        }

        const yearlyIncrementAmount = round2(currentRecord.monthlySalary - baselineSalary);
        const yearlyIncrementPercent = baselineSalary > 0 ? round2((yearlyIncrementAmount / baselineSalary) * 100) : 0;

        res.json({
            success: true,
            stats: {
                currentSalary: currentRecord.monthlySalary,
                lastIncrementAmount: currentRecord.incrementAmount,
                lastIncrementPercent: currentRecord.incrementPercent,
                lastIncrementDate: currentRecord.effectiveFrom,
                lastIncrementReason: currentRecord.reason,
                yearlyIncrementAmount,
                yearlyIncrementPercent,
                financialYear: fyLabel,
                sinceJoiningThisYear,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { recordSalaryIncrement, getSalaryHistory, getIncrementStats };