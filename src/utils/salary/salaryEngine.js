const Attendance = require("../../models/attendance.model");
const Holiday = require("../../models/holiday.model");
const Leave = require("../../models/leave.model");
const User = require("../../models/user.model");

const isWeekend = (date) => {
    const d = new Date(date).getDay();
    return d === 0 || d === 6;
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * SINGLE SOURCE OF TRUTH for salary calculation.
 * Used by payroll.controller.js and salary.controller.js
 *
 * FORMULA:
 *   perDay          = monthlySalary / totalWorkingDays
 *   presentEarning  = presentDays  * perDay
 *   halfDayEarning  = halfDays     * (perDay / 2)
 *   paidLeaveEarning= paidLeave    * perDay
 *   grossEarnings   = presentEarning + halfDayEarning + paidLeaveEarning
 *   absentDeduct    = absentDays   * perDay
 *   unpaidDeduct    = unpaidLeave  * perDay
 *   netSalary       = grossEarnings - absentDeduct - unpaidDeduct - statutory
 */
const calculateSalary = async (userId, month, year) => {
    const user = await User.findById(userId);
    if (!user || !user.salary?.monthly) return null;

    const monthlySalary = user.salary.monthly;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const totalCalendarDays = new Date(year, month, 0).getDate();

    // ── Effective start (respect HRMS enrollment) ─────────
    const enrollmentDate = user.createdAt
        ? new Date(new Date(user.createdAt).setHours(0, 0, 0, 0))
        : null;

    const isLegacy = user.isLegacyEmployee === true;

    const enrolledThisMonth = !isLegacy &&
        enrollmentDate &&
        enrollmentDate.getFullYear() === year &&
        enrollmentDate.getMonth() === month - 1;

    const effectiveStart = enrolledThisMonth
        ? enrollmentDate
        : new Date(monthStart);

    // ── Holidays ──────────────────────────────────────────
    const holidays = await Holiday.find({
        date: { $gte: effectiveStart, $lte: monthEnd }
    });
    const holidaySet = new Set(
        holidays.map(h => {
            const d = new Date(h.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        })
    );
    const holidayCount = holidays.length;

    // ── Working days (effectiveStart → monthEnd) ──────────
    let totalWorkingDays = 0;
    let totalWeekends = 0;
    for (
        let d = new Date(effectiveStart);
        d <= monthEnd;
        d.setDate(d.getDate() + 1)
    ) {
        const cur = new Date(d);
        cur.setHours(0, 0, 0, 0);
        if (isWeekend(cur)) {
            totalWeekends++;
        } else if (!holidaySet.has(cur.getTime())) {
            totalWorkingDays++;
        }
    }

    if (totalWorkingDays === 0) return null;

    // ── Per day rate ──────────────────────────────────────
    // Based on working days NOT calendar days for accuracy
    const perDay = round2(monthlySalary / totalWorkingDays);
    const halfDayPay = round2(perDay / 2);

    // ── Salary structure snapshot ─────────────────────────
    const structure = user.salary?.structure || {};
    const DEFAULTS = {
        basic: { enabled: true, percent: 40 },
        hra: { enabled: true, percent: 20 },
        specialAllowance: { enabled: true, percent: 25 },
        conveyance: { enabled: true, percent: 10 },
        otherAllowance: { enabled: true, percent: 5 },
    };
    const LABELS = {
        basic: "Basic Salary",
        hra: "HRA",
        specialAllowance: "Special Allowance",
        conveyance: "Conveyance / Internet",
        otherAllowance: "Other Allowance",
    };

    const salaryStructure = {};
    for (const key of Object.keys(DEFAULTS)) {
        const cfg = structure[key] || DEFAULTS[key];
        const enabled = cfg.enabled ?? DEFAULTS[key].enabled;
        const percent = cfg.percent ?? DEFAULTS[key].percent;
        salaryStructure[key] = {
            enabled,
            percent,
            amount: enabled ? round2((percent / 100) * monthlySalary) : 0,
            label: LABELS[key],
        };
    }

    const basicAmt = salaryStructure.basic.amount;

    // ── Statutory deductions ──────────────────────────────
    const deductionCfg = user.salary?.deductions || {};

    const pfEnabled = deductionCfg.pf?.enabled ?? false;
    const esiEnabled = deductionCfg.esi?.enabled ?? false;
    const ptEnabled = deductionCfg.professionalTax?.enabled ?? false;

    const pfPercent = deductionCfg.pf?.percent ?? 12;
    const esiPercent = deductionCfg.esi?.percent ?? 0.75;
    const ptFixed = deductionCfg.professionalTax?.fixedAmount ?? 0;

    const grossForStructure = round2(
        Object.values(salaryStructure).reduce((s, c) => s + c.amount, 0)
    );

    const pfAmount = pfEnabled ? round2((pfPercent / 100) * basicAmt) : 0;
    const esiAmount = esiEnabled ? round2((esiPercent / 100) * grossForStructure) : 0;
    const ptAmount = ptEnabled ? round2(ptFixed) : 0;

    const statutoryDeductions = {
        pf: {
            enabled: pfEnabled,
            percent: pfPercent,
            amount: pfAmount,
            label: "Provident Fund (PF)",
            pfNumber: deductionCfg.pf?.pfNumber || "",
        },
        esi: {
            enabled: esiEnabled,
            percent: esiPercent,
            amount: esiAmount,
            label: "ESI",
            esiNumber: deductionCfg.esi?.esiNumber || "",
        },
        professionalTax: {
            enabled: ptEnabled,
            fixedAmount: ptFixed,
            amount: ptAmount,
            label: "Professional Tax",
        },
    };
    const totalStatutoryDeductions = round2(pfAmount + esiAmount + ptAmount);

    // ── Approved leaves ───────────────────────────────────
    const leaves = await Leave.find({
        user: userId,
        status: "approved",
        fromDate: { $lte: monthEnd },
        toDate: { $gte: effectiveStart },
    });

    // Build leave day set (working days only)
    const leaveDaySet = new Set(); // all leave working days
    const paidDaySet = new Set(); // paid leave days
    const unpaidDaySet = new Set(); // unpaid leave days

    leaves.forEach(l => {
        const from = new Date(l.fromDate);
        const to = new Date(l.toDate);
        from.setHours(0, 0, 0, 0);

        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const day = new Date(d);
            day.setHours(0, 0, 0, 0);

            if (
                day >= effectiveStart &&
                day <= monthEnd &&
                !isWeekend(day) &&
                !holidaySet.has(day.getTime())
            ) {
                leaveDaySet.add(day.getTime());

                // "unpaid" type → always unpaid regardless of balance
                if (l.type === "unpaid") {
                    unpaidDaySet.add(day.getTime());
                    return;
                }

                // For casual/sick/earned → use paidDays stored at approval time
                const totalLeaveDays = l.totalDays || 1;
                const paidRatio = (l.paidDays || 0) / totalLeaveDays;

                if ((l.paidDays || 0) > 0 && paidRatio > 0) {
                    paidDaySet.add(day.getTime());
                } else {
                    unpaidDaySet.add(day.getTime());
                }
            }
        }
    });

    const paidLeave = paidDaySet.size;
    const unpaidLeave = unpaidDaySet.size;

    // ── Attendance records ────────────────────────────────
    const records = await Attendance.find({
        user: userId,
        date: { $gte: effectiveStart, $lte: monthEnd },
    });

    let presentDays = 0;
    let halfDays = 0;

    records.forEach(a => {
        const d = new Date(a.date);
        d.setHours(0, 0, 0, 0);

        if (isWeekend(d)) return;
        if (holidaySet.has(d.getTime())) return;
        if (leaveDaySet.has(d.getTime())) return;

        if (a.isHalfDay) halfDays++;
        else if (a.status === "present") presentDays++;
    });

    // ── Absent days ───────────────────────────────────────
    const coveredSlots = presentDays + (halfDays * 0.5) + leaveDaySet.size;
    const absentDays = Math.max(0, totalWorkingDays - coveredSlots);

    // ── Earnings (build up from zero) ─────────────────────
    const presentEarning = round2(presentDays * perDay);
    const halfDayEarning = round2(halfDays * halfDayPay);
    const paidLeaveEarning = round2(paidLeave * perDay);
    const grossEarnings = round2(
        presentEarning + halfDayEarning + paidLeaveEarning
    );

    // ── Attendance deductions ─────────────────────────────
    const absentAmt = round2(absentDays * perDay);
    const halfDayDeduct = round2(halfDays * halfDayPay);
    const unpaidLeaveAmt = round2(unpaidLeave * perDay);
    const totalAttendanceDeductions = round2(
        absentAmt + unpaidLeaveAmt
        // halfDayDeduct already reflected in earning (earned half instead of full)
    );

    const totalDeductions = round2(
        totalAttendanceDeductions + totalStatutoryDeductions
    );

    const netSalary = round2(Math.max(0, grossEarnings - totalAttendanceDeductions - totalStatutoryDeductions));

    return {
        // ── Config ──────────────────────────────────────
        monthlySalary,
        totalWorkingDays,
        totalCalendarDays,
        totalWeekends,
        perDaySalary: perDay,
        halfDaySalary: halfDayPay,

        // ── Attendance ──────────────────────────────────
        presentDays,
        halfDays,
        absentDays,
        paidLeave,
        unpaidLeave,
        holidays: holidayCount,

        // ── Earnings ────────────────────────────────────
        presentEarning,
        halfDayEarning,
        paidLeaveEarning,
        grossEarnings,

        // ── Structure ───────────────────────────────────
        salaryStructure,

        // ── Statutory ───────────────────────────────────
        statutoryDeductions,
        totalStatutoryDeductions,

        // ── Deductions ──────────────────────────────────
        absentAmt,
        halfDayDeduct,
        unpaidLeaveAmt,
        totalAttendanceDeductions,
        deductions: totalDeductions,

        // ── Final ───────────────────────────────────────
        netSalary,
    };
};

module.exports = { calculateSalary, round2 };