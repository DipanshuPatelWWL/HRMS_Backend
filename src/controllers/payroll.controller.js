const Payroll = require("../models/payroll.model");
const PayrollSettings = require("../models/payrollSettings.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { calculateSalary } = require("../utils/salary/salaryEngine");
const moment = require("moment-timezone");
const { notifyPersonalPayslip } = require("../services/emailNotify");
const { createNotification } = require("./notification.controller");

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];
// ─────────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const d = moment(date).tz("Asia/Kolkata").day();
    return d === 0 || d === 6;
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────
//  GENERATE PAYROLL  (HR)
// ─────────────────────────────────────────────
const generatePayroll = async (req, res) => {
    let lockedSettings = null;
    const MAX_LOCK_AGE = 30 * 60 * 1000; // 30 minutes
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - MAX_LOCK_AGE);

    try {
        // 1. Atomic Lock check & acquire (handles fresh locks and stale locks)
        lockedSettings = await PayrollSettings.findOneAndUpdate(
            {
                singletonKey: "singleton",
                $or: [
                    { isGeneratingPayroll: false },
                    { isGeneratingPayroll: true, lockAcquiredAt: { $lte: staleThreshold } },
                    { isGeneratingPayroll: true, lockAcquiredAt: null } // Handle corrupt/legacy states safely
                ]
            },
            {
                $set: {
                    isGeneratingPayroll: true,
                    lockAcquiredAt: now
                }
            },
            { new: true }
        );

        if (!lockedSettings) {
            // Either the job is running (and not stale) OR the singleton doesn't exist
            const anySettings = await PayrollSettings.findOne({ singletonKey: "singleton" });
            if (!anySettings) {
                try {
                    lockedSettings = await PayrollSettings.create({
                        singletonKey: "singleton",
                        isGeneratingPayroll: true,
                        lockAcquiredAt: now
                    });
                } catch (err) {
                    if (err.code === 11000) {
                        return res.status(429).json({ success: false, message: "A payroll generation job is already in progress. Please wait." });
                    }
                    throw err;
                }
            } else {
                return res.status(429).json({ success: false, message: "A payroll generation job is already in progress. Please wait." });
            }
        }

        const { month, year, employeeId } = req.body;
        const io = req.app.get("io");

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                message: "month and year are required"
            });
        }

        const generatorRole = req.user.role;

        const allowedTargetRoles = {
            hr: ["employee", "tl"],
            manager: ["employee", "tl", "hr"],
            superadmin: [
                "employee",
                "tl",
                "hr",
                "manager",
                "superadmin",
            ],
        };

        if (!allowedTargetRoles[generatorRole]) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to generate payroll",
            });
        }

        const m = parseInt(month);
        const y = parseInt(year);

        const nowIST = moment().tz("Asia/Kolkata");
        const currentMonth = nowIST.month() + 1;
        const currentYear = nowIST.year();

        // if (y > currentYear || (y === currentYear && m > currentMonth)) {
        //     return res.status(400).json({ success: false, message: "Cannot generate payroll for future months." });
        // }

        // if (y === currentYear && m === currentMonth) {
        //     const lastDay = nowIST.clone().endOf("month").date();
        //     if (nowIST.date() < lastDay) {
        //         return res.status(400).json({ success: false, message: "Final payroll for the current month can only be generated on the last day of the month. Please use the Salary Preview feature until then." });
        //     }
        // }

        let users;

        if (employeeId) {
            const u = await User.findById(employeeId);

            if (!u) {
                return res.status(404).json({
                    success: false,
                    message: "Employee not found"
                });
            }

            if (!allowedTargetRoles[generatorRole].includes(u.role)) {
                return res.status(403).json({
                    success: false,
                    message: `You are not authorized to generate payroll for ${u.role}`,
                });
            }

            if (
                generatorRole !== "superadmin" &&
                u._id.toString() === req.user._id.toString()
            ) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot generate your own payroll",
                });
            }

            users = [u];
        } else {
            // Boundaries of the payroll period being generated (IST)
            const periodStart = moment
                .tz(`${y}-${m}-01`, "YYYY-M-DD", "Asia/Kolkata")
                .startOf("day")
                .toDate();

            const periodEnd = moment
                .tz(`${y}-${m}-01`, "YYYY-M-DD", "Asia/Kolkata")
                .endOf("month")
                .toDate();

            // HR:
            //   Employee + TL
            //
            // Manager:
            //   Employee + TL + HR
            //
            // Superadmin:
            //   Everyone
            const targetRoles = allowedTargetRoles[generatorRole];

            users = await User.find({
                role: { $in: targetRoles },

                "salary.monthly": { $gt: 0 },

                joiningDate: {
                    $lte: periodEnd
                },

                $and: [
                    {
                        // Exclude employees who left before
                        // the payroll period started.
                        $nor: [
                            {
                                exitDate: {
                                    $lt: periodStart
                                }
                            },
                            {
                                relievingDate: {
                                    $lt: periodStart
                                }
                            },
                        ],
                    },

                    {
                        $or: [
                            {
                                deletedAt: null
                            },
                            {
                                deletedAt: {
                                    $exists: false
                                }
                            },
                            {
                                deletedAt: {
                                    $gte: periodStart
                                }
                            },
                        ],
                    },
                ],
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

                const isCurrentMonth = (m === nowIST.month() + 1 && y === nowIST.year());
                const mode = isCurrentMonth ? "earned" : "final";

                const data = await calculateSalary(user._id, m, y, mode);
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

            } catch (err) {
                if (err.code === 11000) {
                    skipped.push({ name: user.name, reason: "Duplicate generation attempt" });
                } else {
                    errors.push({ name: user.name, error: err.message });
                }
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
    } finally {
        if (lockedSettings) {
            await PayrollSettings.updateOne(
                { singletonKey: "singleton" },
                { $set: { isGeneratingPayroll: false, lockAcquiredAt: null } }
            );
        }
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

        let employeeMatch = {};

        if (req.user.role === "hr") {
            employeeMatch = {
                role: { $in: ["employee", "tl"] }
            };
        } else if (req.user.role === "manager") {
            employeeMatch = {
                role: { $in: ["employee", "tl", "hr"] }
            };
        } else if (req.user.role === "superadmin") {
            employeeMatch = {
                role: {
                    $in: [
                        "employee",
                        "tl",
                        "hr",
                        "manager",
                        "superadmin"
                    ]
                }
            };
        }

        const payrolls = await Payroll.find(filter)
            .populate({
                path: "employee",
                match: employeeMatch,
                select: "name email employeeId guardianName fatherName parentName department designation role joiningDate dob salary bankDetails governmentId exitDate relievingDate deletedAt"
            })
            .populate("paidBy", "name")
            .sort({
                year: -1,
                month: -1,
                createdAt: -1
            });

        const filteredPayrolls = payrolls.filter(p => {
            if (!p.employee) return false;
            if (p.status === "paid") return true;

            const periodStart = moment
                .tz(`${p.year}-${p.month}-01`, "YYYY-M-DD", "Asia/Kolkata")
                .startOf("day")
                .toDate();
            const periodEnd = moment
                .tz(`${p.year}-${p.month}-01`, "YYYY-M-DD", "Asia/Kolkata")
                .endOf("month")
                .toDate();

            const exitedBeforePeriod =
                (p.employee.exitDate && p.employee.exitDate < periodStart) ||
                (p.employee.relievingDate && p.employee.relievingDate < periodStart) ||
                (p.employee.deletedAt && p.employee.deletedAt < periodStart);
            const joinedAfterPeriod =
                p.employee.joiningDate && p.employee.joiningDate > periodEnd;

            return !exitedBeforePeriod && !joinedAfterPeriod;
        });

        res.json({ success: true, count: filteredPayrolls.length, payrolls: filteredPayrolls });
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

        const payroll = await Payroll.findById(id).populate("employee", "name email _id");
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

        // ── Notify this employee only ──
        const emp = payroll.employee;
        if (emp) {
            createNotification(
                io,
                emp._id,
                "Salary Credited 💵",
                `Your salary for ${MONTHS[payroll.month - 1]} ${payroll.year} has been processed. Net pay: ₹${(payroll.netSalary || 0).toLocaleString("en-IN")}`,
                "payroll",
                { payrollId: payroll._id, month: payroll.month, year: payroll.year }
            ).catch(err => console.error("Notification error:", err));

            if (emp.email) {
                notifyPersonalPayslip(emp.email, {
                    employeeName: emp.name,
                    month: payroll.month,
                    year: payroll.year,
                    netSalary: payroll.netSalary,
                    payslipUrl: null,
                }).catch(err => console.error("Email error:", err));
            }
        }

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
            .populate("employee", "name email _id");

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

            // ── Notify each selected employee individually ──
            const emp = p.employee;
            if (emp) {
                createNotification(
                    io,
                    emp._id,
                    "Salary Credited 💵",
                    `Your salary for ${MONTHS[p.month - 1]} ${p.year} has been processed. Net pay: ₹${(p.netSalary || 0).toLocaleString("en-IN")}`,
                    "payroll",
                    { payrollId: p._id, month: p.month, year: p.year }
                ).catch(err => console.error(`Notification error for ${emp.name}:`, err));

                if (emp.email) {
                    notifyPersonalPayslip(emp.email, {
                        employeeName: emp.name,
                        month: p.month,
                        year: p.year,
                        netSalary: p.netSalary,
                        payslipUrl: null,
                    }).catch(err => console.error(`Email error for ${emp.name}:`, err));
                }
            }
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
        const isAdminViewer = ["hr", "manager", "superadmin"].includes(req.user.role);
        const filter = { employee: req.user._id };
        if (!isAdminViewer) {
            filter.isReleased = true;
        }

        let employeeMatch = {};

        if (req.user.role === "hr") {
            employeeMatch = {
                role: { $in: ["employee", "tl"] }
            };
        } else if (req.user.role === "manager") {
            employeeMatch = {
                role: { $in: ["employee", "tl", "hr"] }
            };
        } else if (req.user.role === "superadmin") {
            employeeMatch = {
                role: {
                    $in: [
                        "employee",
                        "tl",
                        "hr",
                        "manager",
                        "superadmin"
                    ]
                }
            };
        }

        const payrolls = await Payroll.find(filter)
            .populate({
                path: "employee",
                match: employeeMatch,
                select: "name email employeeId guardianName fatherName parentName department designation role joiningDate dob salary bankDetails governmentId exitDate relievingDate deletedAt"
            })
            .populate("paidBy", "name")
            .sort({
                year: -1,
                month: -1,
                createdAt: -1
            });

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

        const isOwner =
            payroll.employee._id.toString() === req.user._id.toString();

        const isPayrollAdmin =
            ["hr", "manager", "superadmin"].includes(req.user.role);

        if (!isOwner && !isPayrollAdmin) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
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

        const validEmployees = await User.find({ role: { $nin: ["manager", "superadmin"] } }).select("_id").lean();
        const validIds = validEmployees.map(u => u._id);

        filter.employee = { $in: validIds };

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


const getSalaryPreview = async (req, res) => {
    try {
        const { employeeId, month, year } = req.query;

        if (!employeeId || !month || !year) {
            return res.status(400).json({ success: false, message: "employeeId, month and year are required" });
        }

        const isAdmin = ["hr", "manager", "superadmin"].includes(req.user.role);
        if (employeeId !== req.user._id.toString() && !isAdmin) {
            return res.status(403).json({ success: false, message: "Unauthorized salary preview" });
        }

        const m = parseInt(month);
        const y = parseInt(year);

        const earned = await calculateSalary(employeeId, m, y, "earned");
        const projected = await calculateSalary(employeeId, m, y, "projected");

        if (!earned || !projected) {
            return res.status(404).json({ success: false, message: "No salary configuration found for this employee or user not found" });
        }

        res.json({
            success: true,
            preview: {
                monthlySalary: earned.monthlySalary,
                presentDays: earned.presentDays,
                absentDays: earned.absentDays,
                attendanceDeductions: earned.totalAttendanceDeductions,

                // Value Rename: represents actual earned amount till today
                earnedTillDate: earned.grossEarnings,

                // Projections for month end
                projectedMonthEndGross: projected.grossEarnings,
                projectedMonthEndTDS: projected.statutoryDeductions.tds.amount,
                projectedMonthEndNet: projected.netSalary,

                // Useful for UI badges
                isCurrentMonth: (new Date().getMonth() + 1 === m && new Date().getFullYear() === y)
            }
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



// ─────────────────────────────────────────────
//  BULK RECALCULATE PAYROLL (HR — refresh all drafts for a month)
// ─────────────────────────────────────────────
const bulkRecalculatePayroll = async (req, res) => {
    try {
        const { month, year } = req.body || {};
        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required" });
        }

        const drafts = await Payroll.find({ month: parseInt(month), year: parseInt(year), status: "draft" });
        const nowIST = moment().tz("Asia/Kolkata");
        const isCurrentMonth = (parseInt(month) === nowIST.month() + 1 && parseInt(year) === nowIST.year());
        const mode = isCurrentMonth ? "earned" : "final";

        let updated = 0;
        const failed = [];

        for (const p of drafts) {
            try {
                const data = await calculateSalary(p.employee, p.month, p.year, mode);
                if (data) {
                    Object.assign(p, data);
                    await p.save();
                    updated++;
                } else {
                    failed.push(p._id);
                }
            } catch (err) {
                failed.push(p._id);
            }
        }

        res.json({ success: true, message: `Recalculated ${updated} draft payroll(s)`, updated, failed });
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
    getSalaryPreview,
    releasePayroll,
    bulkRecalculatePayroll,

};
