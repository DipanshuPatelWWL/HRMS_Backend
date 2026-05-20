const Payroll = require("../models/payroll.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification } = require("./notification.controller");

// ─────────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const d = new Date(date).getDay();
    return d === 0 || d === 6;
};

// ─────────────────────────────────────────────
//  BUILD SALARY DATA
//
//  FORMULA:
//    perDay      = monthlySalary / totalCalendarDays  (28 / 30 / 31)
//    halfDayPay  = perDay / 2
//
//    deductions  = (absentDays  × perDay)
//                + (halfDays    × halfDayPay)
//                + (unpaidLeave × perDay)
//
//    netSalary   = monthlySalary - deductions
//
//  POLICY:
//    • Full attendance          → full salary (no deduction)
//    • Weekends + holidays      → no deduction (implicit in full salary)
//    • Paid casual leave (CL)   → no deduction
//    • Absent working day       → deduct perDay
//    • Half day                 → deduct halfDayPay
//    • Unpaid / sick / earned   → deduct perDay per day
//
//  EXAMPLE (30-day month, salary 8000):
//    perDay = 8000 / 30 = 266.67
//    2 absent → 266.67 × 2 = 533.34 deducted
//    net = 8000 - 533.34 = 7466.66 
// ─────────────────────────────────────────────


const buildSalaryData = async (userId, month, year) => {
    const user = await User.findById(userId);
    if (!user || !user.salary?.monthly) return null;

    const monthlySalary = user.salary.monthly;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const totalCalendarDays = new Date(year, month, 0).getDate();

    // ── Holidays ──────────────────────────────────────────
    const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
    const holidaySet = new Set(
        holidays.map(h => {
            const d = new Date(h.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        })
    );
    const holidayCount = holidays.length;

    // ── Weekends ──────────────────────────────────────────
    let totalWeekends = 0;
    for (let d = 1; d <= totalCalendarDays; d++) {
        if (isWeekend(new Date(year, month - 1, d))) totalWeekends++;
    }

    // ── Working days = Mon–Fri minus holidays ─────────────
    // This is what the employee is EXPECTED to work
    let totalWorkingDays = 0;
    for (let d = 1; d <= totalCalendarDays; d++) {
        const cur = new Date(year, month - 1, d);
        cur.setHours(0, 0, 0, 0);
        if (!isWeekend(cur) && !holidaySet.has(cur.getTime())) {
            totalWorkingDays++;
        }
    }

    if (totalCalendarDays === 0) return null; // safety guard

    // ── Salary Structure ──────────────────────────────────
    const structure = user.salary?.structure || {};
    const deductionCfg = user.salary?.deductions || {};

    const COMPONENT_DEFAULTS = {
        basic: { enabled: true, percent: 40 },
        hra: { enabled: true, percent: 20 },
        specialAllowance: { enabled: true, percent: 25 },
        conveyance: { enabled: true, percent: 10 },
        otherAllowance: { enabled: true, percent: 5 },
    };

    const COMPONENT_LABELS = {
        basic: "Basic Salary",
        hra: "HRA",
        specialAllowance: "Special Allowance",
        conveyance: "Conveyance / Internet",
        otherAllowance: "Other Allowance",
    };

    // Build component amounts
    const salaryStructureSnapshot = {};
    for (const key of Object.keys(COMPONENT_DEFAULTS)) {
        const cfg = structure[key] || COMPONENT_DEFAULTS[key];
        const enabled = cfg.enabled ?? COMPONENT_DEFAULTS[key].enabled;
        const percent = cfg.percent ?? COMPONENT_DEFAULTS[key].percent;
        const amount = enabled ? round2((percent / 100) * monthlySalary) : 0;
        salaryStructureSnapshot[key] = { enabled, percent, amount, label: COMPONENT_LABELS[key] };
    }

    const grossEarnings = round2(
        Object.values(salaryStructureSnapshot).reduce((s, c) => s + c.amount, 0)
    );
    const basicAmt = salaryStructureSnapshot.basic.amount;

    // ── Statutory Deductions ──────────────────────────────
    const pfEnabled = deductionCfg.pf?.enabled ?? false;
    const esiEnabled = deductionCfg.esi?.enabled ?? false;
    const ptEnabled = deductionCfg.professionalTax?.enabled ?? false;

    const pfPercent = deductionCfg.pf?.percent ?? 12;
    const esiPercent = deductionCfg.esi?.percent ?? 0.75;
    const ptFixed = deductionCfg.professionalTax?.fixedAmount ?? 0;

    const pfNumber = deductionCfg.pf?.pfNumber || "";
    const esiNumber = deductionCfg.esi?.esiNumber || "";

    const pfAmount = pfEnabled ? round2((pfPercent / 100) * basicAmt) : 0;
    const esiAmount = esiEnabled ? round2((esiPercent / 100) * grossEarnings) : 0;
    const ptAmount = ptEnabled ? round2(ptFixed) : 0;

    const statutoryDeductionsSnapshot = {
        pf: { enabled: pfEnabled, percent: pfPercent, amount: pfAmount, label: "Provident Fund (PF)", pfNumber },
        esi: { enabled: esiEnabled, percent: esiPercent, amount: esiAmount, label: "ESI", esiNumber },
        professionalTax: { enabled: ptEnabled, fixedAmount: ptFixed, amount: ptAmount, label: "Professional Tax" },
    };
    const totalStatutoryDeductions = round2(pfAmount + esiAmount + ptAmount);

    // ── Per-day rate ──────────────────────────────────────
    // perDay based on gross monthly divided by calendar days
    const perDay = round2(monthlySalary / totalCalendarDays);
    const halfDayPay = round2(perDay / 2);

    // ── Approved leaves this month ────────────────────────
    const leaves = await Leave.find({
        user: userId,
        status: "approved",
        fromDate: { $lte: end },
        toDate: { $gte: start },
    });

    // Build set of leave working-day timestamps (to exclude from absent calculation)
    const leaveDaySet = new Set();
    leaves.forEach(l => {
        const from = new Date(l.fromDate);
        const to = new Date(l.toDate);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const day = new Date(d);
            day.setHours(0, 0, 0, 0);
            if (
                day >= start &&
                day <= end &&
                !isWeekend(day) &&
                !holidaySet.has(day.getTime())
            ) {
                leaveDaySet.add(day.getTime());
            }
        }
    });

    let paidLeave = 0;
    let unpaidLeave = 0;

    leaves.forEach(l => {
        if (l.type === "casual") {
            paidLeave += l.paidDays || 0;
            unpaidLeave += l.unpaidDays || 0;
        } else {
            unpaidLeave += l.totalDays || 0;
        }
    });

    // ── Attendance records ────────────────────────────────
    const records = await Attendance.find({
        user: userId,
        date: { $gte: start, $lte: end },
    });

    let present = 0;  // full present days (NOT including half-day records)
    let halfDays = 0;  // half-day records

    records.forEach(a => {
        const d = new Date(a.date);
        d.setHours(0, 0, 0, 0);

        // Skip weekends — no deduction, no earning needed
        if (isWeekend(d)) return;

        // Skip holidays — no deduction, no earning needed
        if (holidaySet.has(d.getTime())) return;

        // Skip leave days — already counted via paidLeave/unpaidLeave
        if (leaveDaySet.has(d.getTime())) return;

        if (a.isHalfDay) {
            halfDays++;
        } else if (a.status === "present") {
            present++;
        }
    });

    // ── Absent days ───────────────────────────────────────

    const coveredSlots = present + (halfDays * 0.5) + leaveDaySet.size;
    const absentDays = Math.max(0, totalWorkingDays - coveredSlots);

    // ── Attendance Deductions ─────────────────────────────
    const absentAmt = round2(absentDays * perDay);
    const halfDayDeduct = round2(halfDays * halfDayPay);
    const unpaidLeaveAmt = round2(unpaidLeave * perDay);
    const totalAttendanceDeductions = round2(absentAmt + halfDayDeduct + unpaidLeaveAmt);

    // ── Total Deductions & Net ────────────────────────────
    const totalDeductions = round2(totalAttendanceDeductions + totalStatutoryDeductions);
    const netSalary = round2(Math.max(0, monthlySalary - totalDeductions));

    return {
        monthlySalary,
        grossEarnings,
        perDaySalary: perDay,
        halfDaySalary: halfDayPay,
        salaryStructure: salaryStructureSnapshot,
        statutoryDeductions: statutoryDeductionsSnapshot,
        totalStatutoryDeductions,
        presentDays: present,
        halfDays,
        absentDays,
        paidLeave,
        unpaidLeave,
        holidays: holidayCount,
        weekends: totalWeekends,
        totalWorkingDays,
        totalCalendarDays,
        absentAmt,
        halfDayDeduct,
        unpaidLeaveAmt,
        deductions: totalDeductions,
        netSalary,
    };
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────
//  GENERATE PAYROLL  (HR)
// ─────────────────────────────────────────────
const generatePayroll = async (req, res) => {
    try {
        const { month, year, employeeId } = req.body;
        const io = req.app.get("io");

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required" });
        }

        const m = parseInt(month);
        const y = parseInt(year);

        let users;
        if (employeeId) {
            const u = await User.findById(employeeId);
            if (!u) return res.status(404).json({ success: false, message: "Employee not found" });
            users = [u];
        } else {
            users = await User.find({
                status: "active",
                role: { $in: ["employee", "tl", "manager"] },
                "salary.monthly": { $gt: 0 },
            });
        }

        const results = [];
        const skipped = [];
        const errors = [];

        for (const user of users) {
            try {
                const exists = await Payroll.findOne({ employee: user._id, month: m, year: y });
                if (exists) {
                    skipped.push({ name: user.name, reason: "Already generated" });
                    continue;
                }

                const data = await buildSalaryData(user._id, m, y);
                if (!data) {
                    skipped.push({ name: user.name, reason: "No salary configured" });
                    continue;
                }

                const payroll = await Payroll.create({
                    employee: user._id,
                    month: m,
                    year: y,
                    generatedBy: req.user._id,
                    ...data,
                });

                results.push(payroll);

                const monthName = new Date(y, m - 1)
                    .toLocaleString("default", { month: "long" });

                await createNotification(
                    io,
                    user._id,
                    "Payslip Generated 📄",
                    `Your payslip for ${monthName} ${y} has been generated`,
                    "payroll",
                    { payrollId: payroll._id }
                );

            } catch (err) {
                errors.push({ name: user.name, error: err.message });
            }
        }

        res.status(201).json({
            success: true,
            message: `Generated ${results.length} payslip(s)`,
            generated: results.length,
            skipped: skipped.length,
            errors: errors.length,
            details: { skipped, errors },
            payrolls: results,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET ALL PAYROLLS  (HR)
// ─────────────────────────────────────────────
const getAllPayrolls = async (req, res) => {
    try {
        const { month, year, status } = req.query;
        const filter = {};
        if (month) filter.month = parseInt(month);
        if (year) filter.year = parseInt(year);
        if (status) filter.status = status;

        const payrolls = await Payroll.find(filter)
            .populate(
                "employee",
                "name email employeeId guardianName fatherName parentName department designation role joiningDate dob salary bankDetails governmentId"
            )
            .populate("paidBy", "name")
            .sort({ year: -1, month: -1, createdAt: -1 });

        res.json({ success: true, count: payrolls.length, payrolls });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  MARK AS PAID  (HR)
// ─────────────────────────────────────────────
const markAsPaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;
        const io = req.app.get("io");

        const payroll = await Payroll.findById(id).populate("employee", "name _id");
        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found" });

        if (payroll.status === "paid") {
            return res.status(400).json({ success: false, message: "Already marked as paid" });
        }

        payroll.status = "paid";
        payroll.paidAt = new Date();
        payroll.paidBy = req.user._id;
        payroll.remarks = remarks || "";

        // Auto-release to employee when marked as paid
        payroll.isReleased = true;
        payroll.releasedAt = new Date();
        payroll.releasedBy = req.user._id;

        await payroll.save();

        const monthName = new Date(payroll.year, payroll.month - 1)
            .toLocaleString("default", { month: "long" });

        await createNotification(
            io,
            payroll.employee._id,
            "Salary Paid 💰",
            `Your salary of ₹${payroll.netSalary.toLocaleString()} for ${monthName} ${payroll.year} has been paid`,
            "payroll",
            { payrollId: payroll._id }
        );

        res.json({ success: true, message: "Marked as paid", payroll });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  BULK MARK PAID  (HR)
// ─────────────────────────────────────────────
const bulkMarkPaid = async (req, res) => {
    try {
        const { ids, remarks } = req.body;
        const io = req.app.get("io");

        if (!ids?.length) return res.status(400).json({ success: false, message: "ids array required" });

        const payrolls = await Payroll.find({ _id: { $in: ids }, status: "draft" })
            .populate("employee", "name _id");

        let count = 0;
        for (const p of payrolls) {
            p.status = "paid";
            p.paidAt = new Date();
            p.paidBy = req.user._id;
            p.remarks = remarks || "";

            // Auto-release to employee when marked as paid
            p.isReleased = true;
            p.releasedAt = new Date();
            p.releasedBy = req.user._id;

            await p.save();
            count++;

            const monthName = new Date(p.year, p.month - 1)
                .toLocaleString("default", { month: "long" });

            await createNotification(
                io,
                p.employee._id,
                "Salary Paid 💰",
                `Your salary of ₹${p.netSalary.toLocaleString()} for ${monthName} ${p.year} has been paid`,
                "payroll",
                { payrollId: p._id }
            );
        }

        res.json({ success: true, message: `${count} payroll(s) marked as paid` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  DELETE PAYROLL  (HR — draft only)
// ─────────────────────────────────────────────
const deletePayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found" });
        if (payroll.status === "paid") {
            return res.status(400).json({ success: false, message: "Cannot delete a paid payroll" });
        }
        await Payroll.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Payroll deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET MY PAYROLLS  (Employee)
// ─────────────────────────────────────────────
const getMyPayrolls = async (req, res) => {
    try {
        // Employees only see released payrolls; HR/Manager see all their own
        const isAdminViewer = ["hr", "manager"].includes(req.user.role);
        const filter = { employee: req.user._id };
        if (!isAdminViewer) {
            filter.isReleased = true;
        }

        const payrolls = await Payroll.find(filter)
            .populate(
                "employee",
                "name email employeeId guardianName fatherName parentName department designation role joiningDate dob salary bankDetails governmentId"
            )
            .populate("paidBy", "name")
            .sort({ year: -1, month: -1 });

        res.json({ success: true, count: payrolls.length, payrolls });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET SINGLE PAYROLL  (HR or owner)
// ─────────────────────────────────────────────
const getPayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id)
            .populate(
                "employee",
                "name email employeeId guardianName fatherName parentName department designation role joiningDate dob salary bankDetails governmentId"
            )
            .populate("paidBy", "name");

        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found" });

        const isOwner = payroll.employee._id.toString() === req.user._id.toString();
        const isHR = ["hr", "manager"].includes(req.user.role);

        if (!isOwner && !isHR) {
            return res.status(403).json({ success: false, message: "Not authorized" });
        }

        // Employee can only view if payroll is released (paid)
        if (isOwner && !isHR && !payroll.isReleased) {
            return res.status(403).json({ success: false, message: "Payslip not yet released by HR" });
        }

        res.json({ success: true, payroll });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  PAYROLL SUMMARY STATS  (HR dashboard)
// ─────────────────────────────────────────────
const getPayrollStats = async (req, res) => {
    try {
        const { month, year } = req.query;
        const filter = {};
        if (month) filter.month = parseInt(month);
        if (year) filter.year = parseInt(year);

        const all = await Payroll.find(filter);
        const paid = all.filter(p => p.status === "paid");
        const draft = all.filter(p => p.status === "draft");

        const totalNet = all.reduce((s, p) => s + p.netSalary, 0);
        const paidAmount = paid.reduce((s, p) => s + p.netSalary, 0);
        const draftAmount = draft.reduce((s, p) => s + p.netSalary, 0);

        res.json({
            success: true,
            stats: {
                total: all.length,
                paid: paid.length,
                draft: draft.length,
                totalNet: round2(totalNet),
                paidAmount: round2(paidAmount),
                draftAmount: round2(draftAmount),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const releasePayroll = async (req, res) => {
    try {
        const { id } = req.params;
        const payroll = await Payroll.findById(id);
        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found" });

        if (payroll.isReleased) {
            return res.status(400).json({ success: false, message: "Already released" });
        }

        payroll.isReleased = true;
        payroll.releasedAt = new Date();
        payroll.releasedBy = req.user._id;
        await payroll.save();

        res.json({ success: true, message: "Payslip released to employee", payroll });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    generatePayroll,
    getAllPayrolls,
    markAsPaid,
    bulkMarkPaid,
    deletePayroll,
    getMyPayrolls,
    getPayroll,
    getPayrollStats,
    releasePayroll
};