const Payroll = require("../models/payroll.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification } = require("./notification.controller");
const { calculateSalary } = require("../utils/salary/salaryEngine");
const moment = require("moment-timezone");

// ─────────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const d = moment(date).tz("Asia/Kolkata").day();
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

                const data = await calculateSalary(user._id, m, y);
                if (!data) {
                    skipped.push({ name: user.name, reason: "No salary configured" });
                    continue;
                }

                const payroll = await Payroll.create({
                    employee: user._id,
                    month: m,
                    year: y,
                    generatedBy: req.user._id,
                    status: "draft",
                    isReleased: false,
                    ...data,
                });

                results.push(payroll);

                const monthName = moment.tz({ year: y, month: m - 1 }, "Asia/Kolkata")
                    .format("MMMM");

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
        payroll.paidAt = moment().tz("Asia/Kolkata").toDate();
        payroll.paidBy = req.user._id;
        payroll.remarks = remarks || "";

        // Auto-release to employee when marked as paid
        payroll.isReleased = true;
        payroll.releasedAt = moment().tz("Asia/Kolkata").toDate();
        payroll.releasedBy = req.user._id;

        await payroll.save();

        const monthName = moment.tz({ year: payroll.year, month: payroll.month - 1 }, "Asia/Kolkata")
            .format("MMMM");

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
            p.paidAt = moment().tz("Asia/Kolkata").toDate();
            p.paidBy = req.user._id;
            p.remarks = remarks || "";

            // Auto-release to employee when marked as paid
            p.isReleased = true;
            p.releasedAt = moment().tz("Asia/Kolkata").toDate();
            p.releasedBy = req.user._id;

            await p.save();
            count++;

            const monthName = moment.tz({ year: p.year, month: p.month - 1 }, "Asia/Kolkata")
                .format("MMMM");

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
        payroll.releasedAt = moment().tz("Asia/Kolkata").toDate();
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