const moment = require("moment-timezone");
const Attendance = require("../../models/attendance.model");
const Holiday = require("../../models/holiday.model");
const Leave = require("../../models/leave.model");
const User = require("../../models/user.model");
const { calculateAnnualTax } = require("./tdsCalculator");
const leaveCalculationService = require("../leaveCalculationService");
const PayrollSettings = require("../../models/payrollSettings.model");
const { resolveMonthlySalary } = require("./salaryHistoryResolver");

const isWeekend = (date) => {
    const d = moment(date).tz("Asia/Kolkata").day();
    return d === 0 || d === 6;
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

const PT_CONFIG = {
    UP: { slabs: [{ limit: Infinity, pt: 0 }] },
    DL: { slabs: [{ limit: Infinity, pt: 0 }] },
    HR: { slabs: [{ limit: Infinity, pt: 0 }] },
    MH: {
        slabs: [
            { limit: 7500, pt: 0 },
            { limit: 10000, pt: 175 },
            { limit: Infinity, pt: 200 }
        ]
    },
    KA: {
        slabs: [
            { limit: 15000, pt: 0 },
            { limit: Infinity, pt: 200 }
        ]
    },
    TG: {
        slabs: [
            { limit: 15000, pt: 0 },
            { limit: Infinity, pt: 200 }
        ]
    }
};

function getPT(stateCode, grossSalary, month) {
    const config = PT_CONFIG[stateCode];
    if (!config) return 0;

    // Special case for MH Feb
    if (stateCode === "MH" && month === 2 && grossSalary > 10000) return 300;

    for (const slab of config.slabs) {
        if (grossSalary <= slab.limit) return slab.pt;
    }
    return 0;
}

/**
 * PRODUCTION-READY SALARY ENGINE (DEDUCTIVE MODEL)
 * 
 * AUDIT FINDINGS APPLIED:
 * 1. Mid-month pro-ration for previews.
 * 2. Deductive logic: Monthly Salary - LOP.
 * 3. HRA Metro/Non-Metro support.
 * 4. Fixed/Percent Allowance support.
 * 5. Special Allowance auto-balancing.
 * 6. TDS Integration.
 * 7. State-wise PT Config architecture.
 * 8. PF Ceiling (Prorated).
 * 9. Gratuity.
 */
/**
 * Mode explanations:
 * - 'final': Standard month-end calculation. Uses whole month's attendance records.
 * - 'earned': Calculation till 'today'. Pro-rates gross earnings to days passed.
 * - 'projected': Month-end projection. Assumes 'present' for remaining days but includes LOPs already incurred.
 */
const calculateSalary = async (userId, month, year, mode = "final") => {
    const user = await User.findById(userId);
    if (!user) return null;

    const monthlySalary = await resolveMonthlySalary(userId, month, year, user.salary?.monthly || 0);
    if (!monthlySalary) return null;

    const monthStartMoment = moment.tz(`${year}-${String(month).padStart(2, "0")}-01`, "Asia/Kolkata").startOf("month");
    const monthEndMoment = monthStartMoment.clone().endOf("month");
    const monthStart = monthStartMoment.toDate();
    const monthEnd = monthEndMoment.toDate();
    const totalCalendarDays = monthStartMoment.daysInMonth();
    const todayMoment = moment().tz("Asia/Kolkata");
    const today = todayMoment.toDate();

    // ── 1. EMPLOYMENT PERIOD ──────────────────────────────────────────
    const enrollmentDate = user.createdAt
        ? moment(user.createdAt).tz("Asia/Kolkata").startOf("day").toDate()
        : null;
    const enrollmentMoment = enrollmentDate ? moment(enrollmentDate).tz("Asia/Kolkata") : null;
    const isLegacy = user.isLegacyEmployee === true;
    const enrolledThisMonth = !isLegacy && enrollmentMoment && enrollmentMoment.year() === year && enrollmentMoment.month() === month - 1;
    const effectiveStart = enrolledThisMonth ? enrollmentDate : new Date(monthStart);

    // Evaluation window for attendance/leaves
    let evaluationEnd = monthEnd;
    if (mode === "earned" && todayMoment.isSameOrBefore(monthEndMoment) && todayMoment.isSameOrAfter(monthStartMoment)) {
        evaluationEnd = todayMoment.clone().endOf("day").toDate();
    }

    // Reference point for "passed" days (for projection LOP check)
    let passedEnd = evaluationEnd;
    if (mode === "projected" && todayMoment.isSameOrBefore(monthEndMoment) && todayMoment.isSameOrAfter(monthStartMoment)) {
        passedEnd = todayMoment.clone().endOf("day").toDate();
    }

    // ── 2. HOLIDAYS ───────────────────────────────────────────────────
    const holidays = await Holiday.find({
        date: { $gte: monthStart, $lte: monthEnd }
    });
    const holidaySet = new Set(holidays.map(h =>
        moment(h.date).tz("Asia/Kolkata").startOf("day").valueOf()
    ));

    // ── 3. WORKING DAYS CALCULATION ──────────────────────────────────
    let totalWorkingDaysInMonth = 0;
    let totalWorkingDaysEmployed = 0;
    let totalWorkingDaysPassed = 0;
    let totalWorkingDaysPassedForLOP = 0;

    const effectiveStartMs = effectiveStart.getTime();
    const evaluationEndMs = evaluationEnd.getTime();
    const passedEndMs = passedEnd.getTime();

    const dayCursor = monthStartMoment.clone();
    while (dayCursor.isSameOrBefore(monthEndMoment, "day")) {
        const curMs = dayCursor.clone().startOf("day").valueOf();
        if (!isWeekend(dayCursor) && !holidaySet.has(curMs)) {
            totalWorkingDaysInMonth++;
            if (curMs >= effectiveStartMs) {
                totalWorkingDaysEmployed++;
                if (curMs <= evaluationEndMs) {
                    totalWorkingDaysPassed++;
                }
                if (curMs <= passedEndMs) {
                    totalWorkingDaysPassedForLOP++;
                }
            }
        }
        dayCursor.add(1, "day");
    }

    if (totalWorkingDaysInMonth === 0) return null;

    const perDay = round2(monthlySalary / totalWorkingDaysInMonth);

    // ── 4. LEAVES ─────────────────────────────────────────────────────
    const leaves = await Leave.find({
        user: userId, status: "approved",
        fromDate: { $lte: evaluationEnd }, toDate: { $gte: effectiveStart },
    });

    let totalUnpaidLeaveDays = 0;
    leaves.forEach(l => {
        let workingDaysInMonth = 0;
        const fromMoment = moment(l.fromDate).tz("Asia/Kolkata").startOf("day");
        const toMoment = moment(l.toDate).tz("Asia/Kolkata").startOf("day");
        const cursor = fromMoment.clone();
        while (cursor.isSameOrBefore(toMoment, "day")) {
            const dayMs = cursor.clone().startOf("day").valueOf();
            if (dayMs >= effectiveStartMs && dayMs <= evaluationEndMs && !isWeekend(cursor) && !holidaySet.has(dayMs)) {
                workingDaysInMonth++;
            }
            cursor.add(1, "day");
        }
        // Pro-rate unpaid days if leave spans months
        const ratio = l.totalDays > 0 ? (l.unpaidDays || 0) / l.totalDays : 0;
        totalUnpaidLeaveDays += workingDaysInMonth * ratio;
    });

    // ── 5. ATTENDANCE & SANDWICH ─────────────────────────────────────
    const payrollData = await leaveCalculationService.calculatePayrollDays(userId, month, year);

    const leaveDaysWithSandwich = payrollData?.leaveDaysWithSandwich || 0;
    const actualLeaveDays = payrollData?.actualLeaveDays || 0;

    const sandwichDaysAdded = Math.max(0, leaveDaysWithSandwich - actualLeaveDays);

    const availableBalance = (user.leaveBalance?.casual?.total || 0) - (user.leaveBalance?.casual?.used || 0) +
        (user.leaveBalance?.sick?.total || 0) - (user.leaveBalance?.sick?.used || 0) +
        (user.leaveBalance?.earned?.total || 0) - (user.leaveBalance?.earned?.used || 0);

    const unpaidSandwichDays = Math.max(0, sandwichDaysAdded - Math.max(0, availableBalance));

    // ── 6. LOP CALCULATION ───────────────────────────────────────────
    const halfDays = payrollData?.halfDays || 0;
    const presentDaysRaw = payrollData?.workedDays || 0;
    const paidLeaveDaysRaw = payrollData?.actualLeaveDays || 0;
    const absentDaysReported = payrollData?.absentDays || 0;

    const accountedDays = presentDaysRaw + halfDays + paidLeaveDaysRaw;
    const unaccountedDays = Math.max(0, totalWorkingDaysPassedForLOP - accountedDays);
    const absentDays = Math.max(absentDaysReported, unaccountedDays);

    const lopDays = Math.max(0, absentDays + totalUnpaidLeaveDays + unpaidSandwichDays + (halfDays * 0.5));
    const lopAmount = round2(lopDays * perDay);

    // Earnings Calculation
    const potentialDays = (mode === "earned") ? totalWorkingDaysPassed : totalWorkingDaysEmployed;
    const maxEarnings = round2((monthlySalary / totalWorkingDaysInMonth) * potentialDays);
    const grossEarnings = round2(Math.max(0, maxEarnings - lopAmount));

    // UI fields
    const totalAttendanceDeductions = round2(lopAmount);
    const presentDays = payrollData?.workedDays || 0;

    // ── 7. SALARY STRUCTURE (V2 Modernized) ──────────────────────────
    const structure = user.salary?.structure || {};
    const earningRatio = monthlySalary > 0 ? grossEarnings / monthlySalary : 0;

    let accumulated = 0;
    const resultStructure = {};

    // A. Basic (Fixed % of Gross)
    const basicPct = structure.basic?.percent || 50;
    const earnedBasic = round2((basicPct / 100) * monthlySalary * earningRatio);
    resultStructure.basic = { label: "Basic Salary", amount: earnedBasic, percent: basicPct };
    accumulated += earnedBasic;

    // B. HRA (Metro/Non-Metro/Custom)
    let hraPct = 40;
    if (structure.hra?.type === "metro") hraPct = 50;
    else if (structure.hra?.type === "custom") hraPct = structure.hra.percent || 40;

    // HRA is calculated as % of BASIC (Standard Indian Practice)
    const earnedHRA = round2((hraPct / 100) * earnedBasic);
    resultStructure.hra = { label: `HRA (${structure.hra?.type || "Non-Metro"})`, amount: earnedHRA, percent: hraPct };
    accumulated += earnedHRA;

    // C. Conveyance & Other (Fixed or %)
    ["conveyance", "otherAllowance"].forEach(key => {
        const cfg = structure[key] || { enabled: true, type: "percent", value: key === "conveyance" ? 15 : 5 };
        const label = key === "conveyance" ? "Conveyance / Internet" : "Other Allowance";

        let amount = 0;
        if (cfg.enabled) {
            if (cfg.type === "fixed") {
                amount = round2(cfg.value * earningRatio);
            } else {
                amount = round2((cfg.value / 100) * monthlySalary * earningRatio);
            }
        }
        resultStructure[key] = { label, amount, value: cfg.value, type: cfg.type };
        accumulated += amount;
    });

    // D. Special Allowance (AUTO BALANCE)
    const specialAmount = round2(Math.max(0, grossEarnings - accumulated));
    resultStructure.specialAllowance = { label: "Special Allowance", amount: specialAmount };

    // ── 8. STATUTORY & TDS ────────────────────────────────────────────
    const deductions = user.salary?.deductions || {};

    // PF Calculation with Ceiling Support (Prorated)
    // Fetch payroll settings up-front so PF/TDS blocks can both use it safely
    const payrollSettings = await PayrollSettings.findOne({ singletonKey: "singleton" });

    // PF Calculation with Ceiling Support (Prorated)
    const pfEnabled = deductions.pf?.enabled ?? false;
    let pf = 0;
    if (pfEnabled) {
        const pfPct = deductions.pf.percent || 12;
        const effectivePfMode = deductions.pf.pfMode || payrollSettings?.pfMode || "actual";
        if (effectivePfMode === "capped") {
            const maxPfBase = 15000 * earningRatio;
            const applicableBase = Math.min(earnedBasic, maxPfBase);
            pf = round2((pfPct / 100) * applicableBase);
        } else {
            pf = round2((pfPct / 100) * earnedBasic);
        }
    }

    // ESI
    const esi = deductions.esi?.enabled ? round2((deductions.esi.percent / 100) * grossEarnings) : 0;

    // Professional Tax (Config-based)
    let pt = 0;
    if (deductions.professionalTax?.enabled && grossEarnings > 0) {
        const state = deductions.professionalTax.state || "Uttar Pradesh";
        const stateMap = {
            "Uttar Pradesh": "UP", "Delhi": "DL", "Haryana": "HR",
            "Maharashtra": "MH", "Karnataka": "KA", "Telangana": "TG"
        };
        const stateCode = stateMap[state] || state;
        pt = getPT(stateCode, grossEarnings, month);
    }

    // TDS Calculation
    const fy = payrollSettings?.financialYear || "2025-26";
    const taxProj = calculateAnnualTax(monthlySalary * 12, fy);
    const tds = round2(taxProj.monthlyTDS * earningRatio);

    const totalStatutory = round2(pf + esi + pt + tds);
    const netSalary = round2(Math.max(0, grossEarnings - totalStatutory));

    // ── 9. EMPLOYER CONTRIBUTIONS ─────────────────────────────────────
    const gratuity = round2(earnedBasic * 0.0481);

    return {
        monthlySalary,
        perDaySalary: perDay,
        totalCalendarDays,
        totalWorkingDays: totalWorkingDaysInMonth,
        workingDaysPassed: totalWorkingDaysPassed,
        remainingWorkingDays: Math.max(0, totalWorkingDaysInMonth - totalWorkingDaysPassed),
        presentDays,
        halfDays,
        absentDays,
        lopDays,
        lopAmount,
        absentAmt: 0,
        paidLeave: payrollData.actualLeaveDays || 0,
        halfDayDeduct: 0,
        unpaidLeaveAmt: 0,
        totalAttendanceDeductions,
        grossEarnings,
        salaryStructure: resultStructure,
        statutoryDeductions: {
            pf: {
                enabled: pfEnabled,
                amount: pf,
                percent: deductions.pf?.percent || 12,
                label: "Provident Fund",
                pfNumber: user.salary?.deductions?.pf?.pfNumber || ""
            },
            esi: {
                enabled: deductions.esi?.enabled || false,
                amount: esi,
                percent: deductions.esi?.percent || 0.75,
                label: "ESI",
                esiNumber: user.salary?.deductions?.esi?.esiNumber || ""
            },
            professionalTax: {
                enabled: deductions.professionalTax?.enabled || false,
                amount: pt,
                fixedAmount: deductions.professionalTax?.fixedAmount || 0,
                label: "Professional Tax"
            },
            tds: {
                amount: tds,
                label: "Income Tax (TDS)",
                annualGross: taxProj.annualGross,
                standardDeduction: taxProj.standardDeduction,
                taxableIncome: taxProj.taxableIncome,
                annualTax: taxProj.annualTax,
                effectiveRate: taxProj.effectiveRate
            }
        },
        totalStatutoryDeductions: totalStatutory,
        totalAttendanceDeductions,
        deductions: round2(totalAttendanceDeductions + totalStatutory),
        employerContributions: { gratuity },
        netSalary
    };
};

module.exports = { calculateSalary, round2 };
