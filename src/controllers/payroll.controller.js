const Payroll = require("../models/payroll.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { createNotification } = require("./notification.controller");

// ─────────────────────────────────────────────
//  HELPERS  (mirrors salary.controller logic)
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const d = new Date(date).getDay();
    return d === 0 || d === 6;
};

// const buildSalaryData = async (userId, month, year) => {
//     const user = await User.findById(userId);
//     if (!user || !user.salary?.monthly) return null;

//     const start = new Date(year, month - 1, 1);
//     const end = new Date(year, month, 0, 23, 59, 59, 999);
//     const totalCalendarDays = new Date(year, month, 0).getDate();

//     const perDay = Number((user.salary.monthly / totalCalendarDays).toFixed(2));
//     const halfDayPay = Number((perDay / 2).toFixed(2));

//     // ── Holidays ──────────────────────────────────────────
//     const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
//     const holidaySet = new Set(
//         holidays.map(h => {
//             const d = new Date(h.date);
//             d.setHours(0, 0, 0, 0);
//             return d.getTime();
//         })
//     );
//     const holidayCount = holidays.length;

//     // ── Weekends ──────────────────────────────────────────
//     let totalWeekends = 0;
//     for (let d = 1; d <= totalCalendarDays; d++) {
//         if (isWeekend(new Date(year, month - 1, d))) totalWeekends++;
//     }

//     // ── Working days (Mon–Fri minus holidays) ─────────────
//     let workingDays = 0;
//     for (let d = 1; d <= totalCalendarDays; d++) {
//         const cur = new Date(year, month - 1, d);
//         cur.setHours(0, 0, 0, 0);
//         if (!isWeekend(cur) && !holidaySet.has(cur.getTime())) workingDays++;
//     }

//     // ── Approved leaves for this month ───────────────────
//     const leaves = await Leave.find({
//         user: userId,
//         status: "approved",
//         fromDate: { $lte: end },
//         toDate: { $gte: start },
//     });

//     const leaveDaySet = new Set();
//     leaves.forEach(l => {
//         const from = new Date(l.fromDate);
//         const to = new Date(l.toDate);
//         for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
//             const day = new Date(d);
//             day.setHours(0, 0, 0, 0);
//             if (
//                 day >= start &&
//                 day <= end &&
//                 !isWeekend(day) &&
//                 !holidaySet.has(day.getTime())
//             ) {
//                 leaveDaySet.add(day.getTime());
//             }
//         }
//     });

//     let paidLeave = 0;
//     let unpaidLeave = 0;
//     leaves.forEach(l => {
//         paidLeave += l.paidDays || 0;
//         unpaidLeave += l.unpaidDays || 0;
//     });

//     // ── Attendance records ────────────────────────────────
//     const records = await Attendance.find({
//         user: userId,
//         date: { $gte: start, $lte: end },
//     });

//     let present = 0;
//     let halfDays = 0;
//     let totalOvertime = 0;

//     records.forEach(a => {
//         const d = new Date(a.date);
//         d.setHours(0, 0, 0, 0);
//         if (isWeekend(d)) return;
//         if (holidaySet.has(d.getTime())) return;
//         if (leaveDaySet.has(d.getTime())) return;

//         if (a.isHalfDay) {
//             halfDays++;
//         } else if (a.status === "present") {
//             present++;
//         }

//         totalOvertime += a.overtime || 0;
//     });

//     const coveredDays = present + halfDays + leaveDaySet.size;
//     const absent = Math.max(0, workingDays - coveredDays);

//     const basicEarnings = Number(((present + paidLeave + holidayCount + totalWeekends) * perDay).toFixed(2));
//     const halfDayEarnings = Number((halfDays * halfDayPay).toFixed(2));
//     const overtimePay = 0;

//     const deductions = Number(((unpaidLeave + absent) * perDay).toFixed(2));
//     const netSalary = Number(Math.max(0, basicEarnings + halfDayEarnings + overtimePay - deductions).toFixed(2));

//     return {
//         monthlySalary: user.salary.monthly,
//         perDaySalary: perDay,
//         presentDays: present,
//         halfDays,
//         absentDays: absent,
//         paidLeave,
//         unpaidLeave,
//         holidays: holidayCount,
//         weekends: totalWeekends,
//         totalWorkingDays: workingDays,
//         totalCalendarDays,
//         basicEarnings,
//         halfDayEarnings,
//         overtimePay,
//         deductions,
//         netSalary,
//     };
// };


// ─────────────────────────────────────────────
//  GENERATE PAYROLL  (HR)
// ─────────────────────────────────────────────


const buildSalaryData = async (userId, month, year) => {
    const user = await User.findById(userId);
    if (!user || !user.salary?.monthly) return null;

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const totalCalendarDays = new Date(year, month, 0).getDate();

    const perDay = Number((user.salary.monthly / totalCalendarDays).toFixed(2));
    const halfDayPay = Number((perDay / 2).toFixed(2));

    const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
    const holidaySet = new Set(
        holidays.map(h => {
            const d = new Date(h.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        })
    );
    const holidayCount = holidays.length;

    let totalWeekends = 0;
    for (let d = 1; d <= totalCalendarDays; d++) {
        if (isWeekend(new Date(year, month - 1, d))) totalWeekends++;
    }

    let workingDays = 0;
    for (let d = 1; d <= totalCalendarDays; d++) {
        const cur = new Date(year, month - 1, d);
        cur.setHours(0, 0, 0, 0);
        if (!isWeekend(cur) && !holidaySet.has(cur.getTime())) workingDays++;
    }

    const leaves = await Leave.find({
        user: userId,
        status: "approved",
        fromDate: { $lte: end },
        toDate: { $gte: start },
    });

    const leaveDaySet = new Set();
    leaves.forEach(l => {
        const from = new Date(l.fromDate);
        const to = new Date(l.toDate);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const day = new Date(d);
            day.setHours(0, 0, 0, 0);
            if (day >= start && day <= end && !isWeekend(day) && !holidaySet.has(day.getTime())) {
                leaveDaySet.add(day.getTime());
            }
        }
    });

    let paidLeave = 0;
    let unpaidLeave = 0;
    leaves.forEach(l => {
        paidLeave += l.paidDays || 0;
        unpaidLeave += l.unpaidDays || 0;
    });

    const records = await Attendance.find({
        user: userId,
        date: { $gte: start, $lte: end },
    });

    let present = 0;
    let halfDays = 0;
    let totalOvertime = 0;

    records.forEach(a => {
        const d = new Date(a.date);
        d.setHours(0, 0, 0, 0);
        if (isWeekend(d)) return;
        if (holidaySet.has(d.getTime())) return;
        if (leaveDaySet.has(d.getTime())) return;
        if (a.punchIn && !a.punchOut) return; // ← NEW LINE

        if (a.isHalfDay) {
            halfDays++;
        } else if (a.status === "present") {
            present++;
        }
        totalOvertime += a.overtime || 0;
    });

    const coveredDays = present + halfDays + leaveDaySet.size;
    const absent = Math.max(0, workingDays - coveredDays);

    const basicEarnings = Number(((present + paidLeave + holidayCount + totalWeekends) * perDay).toFixed(2));
    const halfDayEarnings = Number((halfDays * halfDayPay).toFixed(2));
    const overtimePay = 0;

    const deductions = Number(((unpaidLeave + absent) * perDay).toFixed(2));
    const netSalary = Number(Math.max(0, basicEarnings + halfDayEarnings + overtimePay - deductions).toFixed(2));

    return {
        monthlySalary: user.salary.monthly,
        perDaySalary: perDay,
        presentDays: present,
        halfDays,
        absentDays: absent,
        paidLeave,
        unpaidLeave,
        holidays: holidayCount,
        weekends: totalWeekends,
        totalWorkingDays: workingDays,
        totalCalendarDays,
        basicEarnings,
        halfDayEarnings,
        overtimePay,
        deductions,
        netSalary,
    };
};




const generatePayroll = async (req, res) => {
    try {
        const { month, year, employeeId } = req.body;
        const io = req.app.get("io");

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required" });
        }

        const m = parseInt(month), y = parseInt(year);

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
                if (exists) { skipped.push({ name: user.name, reason: "Already generated" }); continue; }

                const data = await buildSalaryData(user._id, m, y);
                if (!data) { skipped.push({ name: user.name, reason: "No salary configured" }); continue; }

                const payroll = await Payroll.create({
                    employee: user._id,
                    month: m,
                    year: y,
                    generatedBy: req.user._id,
                    ...data,
                });

                results.push(payroll);

                await createNotification(
                    io,
                    user._id,
                    "Payslip Generated 📄",
                    `Your payslip for ${new Date(y, m - 1).toLocaleString("default", { month: "long" })} ${y} has been generated`,
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
            await p.save();
            count++;

            const monthName = new Date(p.year, p.month - 1).toLocaleString("default", { month: "long" });
            await createNotification(io, p.employee._id, "Salary Paid 💰",
                `Your salary of ₹${p.netSalary.toLocaleString()} for ${monthName} ${p.year} has been paid`,
                "payroll", { payrollId: p._id }
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
        if (payroll.status === "paid") return res.status(400).json({ success: false, message: "Cannot delete a paid payroll" });

        await Payroll.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Payroll deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET MY PAYROLLS  (Employee)
//  ✅ FIX: Added .populate("employee") so the
//     PDF generator receives full employee data
//     instead of a bare ObjectId string.
// ─────────────────────────────────────────────
const getMyPayrolls = async (req, res) => {
    try {
        const payrolls = await Payroll.find({ employee: req.user._id })
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
                totalNet: Number(totalNet.toFixed(2)),
                paidAmount: Number(paidAmount.toFixed(2)),
                draftAmount: Number(draftAmount.toFixed(2)),
            },
        });
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
};