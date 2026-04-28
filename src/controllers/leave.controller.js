const Leave = require("../models/leave.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const { createNotification } = require("./notification.controller");
const Holiday = require("../models/holiday.model");

// ─────────────────────────────────────────────
//  HELPER — count working days in a range
//  (excludes weekends and holidays)
// ─────────────────────────────────────────────
const countWorkingDays = async (fromDate, toDate) => {
    const start = new Date(fromDate);
    const end = new Date(toDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
    const holidayDates = holidays.map(h => {
        const d = new Date(h.date);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    });

    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = d.getDay();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(new Date(d).setHours(0, 0, 0, 0));
        if (!isWeekend && !isHoliday) count++;
    }

    return count;
};


// ─────────────────────────────────────────────
//  HELPER — remove attendance records for
//  approved leave days & deduct balance
//  (called only once — by the final approver)
// ─────────────────────────────────────────────
const finalizeApproval = async (leave) => {
    const from = new Date(leave.fromDate);
    const to = new Date(leave.toDate);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    // ── 1. Remove any attendance records that fall inside the leave range
    //       (handles retroactive leave for days already punched in)
    await Attendance.deleteMany({
        user: leave.user,
        date: { $gte: from, $lte: to },
    });

    // ── 2. Deduct leave balance (only once, by final approver)
    const user = await User.findById(leave.user);

    const availableBalance = user.leaveBalance.total;
    const paidDays = Math.min(availableBalance, leave.totalDays);
    const unpaidDays = leave.totalDays - paidDays;

    leave.paidDays = paidDays;
    leave.unpaidDays = unpaidDays;

    user.leaveBalance.total -= paidDays;
    user.leaveBalance.used += paidDays;
    await user.save();
};


// ─────────────────────────────────────────────
//  APPLY LEAVE (Employee)
// ─────────────────────────────────────────────
const applyLeave = async (req, res) => {
    try {
        const userId = req.user._id;
        const userName = req.user.name;
        const employeeId = req.user.employeeId;

        const { type, fromDate, toDate, reason, attachment } = req.body;

        // ── Validation ────────────────────────────
        if (!type || !fromDate || !toDate || !reason) {
            return res.status(400).json({
                success: false,
                message: "type, fromDate, toDate and reason are required",
            });
        }

        const from = new Date(fromDate);
        const to = new Date(toDate);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: "fromDate cannot be after toDate",
            });
        }

        // ── Block past-date leave applications ────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (from < today) {
            return res.status(400).json({
                success: false,
                message: "Cannot apply leave for past dates. Contact HR for retroactive leave.",
            });
        }

        // ── Count working days only ───────────────
        const totalDays = await countWorkingDays(from, to);

        if (totalDays === 0) {
            return res.status(400).json({
                success: false,
                message: "No working days in selected range (only weekends/holidays)",
            });
        }

        // ── Overlap check (normalized dates) ──────
        const overlap = await Leave.findOne({
            user: userId,
            status: { $in: ["pending", "approved"] },
            $or: [{ fromDate: { $lte: to }, toDate: { $gte: from } }],
        });

        if (overlap) {
            return res.status(400).json({
                success: false,
                message: "A leave already exists in this date range",
            });
        }

        // ── Create leave ──────────────────────────
        const leave = await Leave.create({
            user: userId,
            userName,
            employeeId,
            type,
            fromDate: from,
            toDate: to,
            totalDays,
            reason,
            attachment: attachment || "",
        });

        res.status(201).json({
            success: true,
            message: "Leave applied successfully",
            leave,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET MY LEAVES (Employee)
// ─────────────────────────────────────────────
const getMyLeaves = async (req, res) => {
    try {
        const leaves = await Leave.find({ user: req.user._id })
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leaves.length,
            leaves,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET ALL LEAVES (HR / Manager)
// ─────────────────────────────────────────────
const getAllLeaves = async (req, res) => {
    try {
        const { status, limit } = req.query;

        const filter = {};
        if (status) filter.status = status;

        let query = Leave.find(filter)
            .populate("user", "name email role employeeId")
            .sort({ createdAt: -1 });

        if (limit) query = query.limit(parseInt(limit));

        const leaves = await query;

        res.status(200).json({
            success: true,
            count: leaves.length,
            leaves,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  TL APPROVAL
//  TL can approve (passes to Manager) or
//  reject (final — stops the chain)
// ─────────────────────────────────────────────
const approveByTL = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        if (leave.tlApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "TL already acted on this leave" });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave already finalized" });
        }

        leave.tlApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        // TL rejection is final — approval just passes chain to Manager
        if (action === "rejected") {
            leave.status = "rejected";

            await createNotification(
                leave.user,
                "Leave Rejected",
                "Your leave request has been rejected by your TL",
                "leave"
            );
        }

        await leave.save();

        res.status(200).json({ success: true, message: `TL ${action}`, leave });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  MANAGER APPROVAL
//  Manager can approve (passes to HR) or
//  reject (final — stops the chain)
//  ✅ FIX: Does NOT deduct balance or finalize
//          status on approval — only HR does that
// ─────────────────────────────────────────────
const approveByManager = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        if (leave.managerApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "Manager already acted on this leave" });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave already finalized" });
        }

        // TL must approve before Manager can act (if TL approval exists in workflow)
        if (leave.tlApproval.status === "pending") {
            return res.status(400).json({
                success: false,
                message: "TL approval is still pending",
            });
        }

        leave.managerApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        if (action === "rejected") {
            // Manager rejection is final
            leave.status = "rejected";

            await createNotification(
                leave.user,
                "Leave Rejected",
                "Your leave request has been rejected by your Manager",
                "leave"
            );
        }
        // ✅ If approved → do NOT touch leave.status or balance
        //    Status stays "pending", passes to HR for final decision

        await leave.save();

        res.status(200).json({ success: true, message: `Manager ${action}`, leave });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  HR APPROVAL (final authority)
//  ✅ FIX: Only HR triggers balance deduction
//          and attendance cleanup — once, here
// ─────────────────────────────────────────────
const approveByHR = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        if (leave.hrApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "HR already acted on this leave" });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave already finalized" });
        }

        // Manager must approve before HR can act
        if (leave.managerApproval.status === "pending") {
            return res.status(400).json({
                success: false,
                message: "Manager approval is still pending",
            });
        }

        leave.hrApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        leave.status = action === "approved" ? "approved" : "rejected";

        if (action === "approved") {
            // ✅ Only called once — here, by the final approver
            await finalizeApproval(leave);
        }

        await leave.save();

        await createNotification(
            leave.user,
            action === "approved" ? "Leave Approved" : "Leave Rejected",
            action === "approved"
                ? "Your leave request has been approved"
                : "Your leave request has been rejected by HR",
            "leave"
        );

        res.status(200).json({ success: true, message: `HR ${action}`, leave });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  CANCEL LEAVE (Employee — pending only)
//  ✅ FIX: Clear message if leave is approved
//          directing employee to contact HR
// ─────────────────────────────────────────────
const cancelLeave = async (req, res) => {
    try {
        const { id } = req.params;

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        // Only the owner can cancel
        if (leave.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not allowed" });
        }

        // ✅ FIX: Clear separate message for approved vs non-pending
        if (leave.status === "approved") {
            return res.status(400).json({
                success: false,
                message: "Approved leave cannot be self-cancelled. Please contact HR to revoke.",
            });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: "Only pending leaves can be cancelled",
            });
        }

        leave.status = "cancelled";
        await leave.save();

        res.status(200).json({
            success: true,
            message: "Leave cancelled successfully",
            leave,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  REVOKE APPROVED LEAVE (HR)
//  ✅ Restores balance + restores attendance
//     records (marks days as absent so salary
//     calc stays consistent)
// ─────────────────────────────────────────────
const revokeLeave = async (req, res) => {
    try {
        const { id } = req.params;

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        if (leave.status !== "approved") {
            return res.status(400).json({
                success: false,
                message: "Only approved leaves can be revoked",
            });
        }

        // ── Restore leave balance ─────────────────
        if (leave.paidDays > 0) {
            await User.findByIdAndUpdate(leave.user, {
                $inc: {
                    "leaveBalance.total": leave.paidDays,
                    "leaveBalance.used": -leave.paidDays,
                },
            });
        }

        leave.status = "revoked";
        leave.paidDays = 0;
        leave.unpaidDays = 0;
        await leave.save();

        await createNotification(
            leave.user,
            "Leave Revoked",
            "Your approved leave has been revoked by HR",
            "leave"
        );

        res.status(200).json({
            success: true,
            message: "Leave revoked and balance restored",
            leave,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  DELETE LEAVE RECORD (HR)
//  ✅ Restores balance + cleans up
// ─────────────────────────────────────────────
const deleteLeave = async (req, res) => {
    try {
        const { id } = req.params;

        const leave = await Leave.findById(id);
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        // If approved and had paid days, restore balance before deleting
        if (leave.status === "approved" && leave.paidDays > 0) {
            await User.findByIdAndUpdate(leave.user, {
                $inc: {
                    "leaveBalance.total": leave.paidDays,
                    "leaveBalance.used": -leave.paidDays,
                },
            });
        }

        await Leave.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Leave record deleted successfully",
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    applyLeave,
    getMyLeaves,
    getAllLeaves,
    approveByTL,
    approveByManager,
    approveByHR,
    cancelLeave,
    revokeLeave,
    deleteLeave,
};