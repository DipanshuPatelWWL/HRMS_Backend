const Leave = require("../models/leave.model");
const User = require("../models/user.model");
const Attendance = require("../models/attendance.model");
const { createNotification, broadcastNotification, notifyLeaveApplied: notifyLeaveAppliedSocket } = require("./notification.controller");
const Holiday = require("../models/holiday.model");
const { notifyLeaveApplied: notifyLeaveAppliedEmail, notifyLeaveApproved, notifyLeaveRejected } = require("../services/emailNotify");
const moment = require("moment-timezone");

// ─────────────────────────────────────────────
//  HELPER — count working days in a range
//  (excludes weekends and holidays)
// ─────────────────────────────────────────────
const countWorkingDays = async (fromDate, toDate) => {
    const start = moment.tz(fromDate, "Asia/Kolkata").startOf("day");
    const end = moment.tz(toDate, "Asia/Kolkata").endOf("day");

    const holidays = await Holiday.find({
        date: { $gte: start.toDate(), $lte: end.toDate() }
    });
    const holidayDates = new Set(
        holidays.map(h =>
            moment(h.date).tz("Asia/Kolkata").format("YYYY-MM-DD")
        )
    );

    let count = 0;
    const cursor = start.clone().startOf("day");
    while (cursor.isSameOrBefore(end, "day")) {
        const day = cursor.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.has(cursor.format("YYYY-MM-DD"));
        if (!isWeekend && !isHoliday) count++;
        cursor.add(1, "day");
    }

    return count;
};


// ─────────────────────────────────────────────
//  HELPER — remove attendance records for
//  approved leave days & deduct balance
//  (called only once — by the final approver)
// ─────────────────────────────────────────────
const finalizeApproval = async (leave) => {
    const fromIST = moment(leave.fromDate).tz("Asia/Kolkata").startOf("day");
    const toIST = moment(leave.toDate).tz("Asia/Kolkata").endOf("day");
    const dateStrings = [];
    const cursor = fromIST.clone();
    while (cursor.isSameOrBefore(toIST, "day")) {
        dateStrings.push(cursor.format("YYYY-MM-DD"));
        cursor.add(1, "day");
    }

    const attendancesToOverwrite = await Attendance.find({
        user: leave.user,
        dateString: { $in: dateStrings },
    }).lean();

    if (attendancesToOverwrite.length > 0) {
        // Strip internal MongoDB fields to prevent DuplicateKey errors on restore
        const strippedAttendances = attendancesToOverwrite.map(att => {
            const { _id, __v, createdAt, updatedAt, ...rest } = att;
            return rest;
        });
        leave.overwrittenAttendances = strippedAttendances;
    }

    await Attendance.deleteMany({
        user: leave.user,
        dateString: { $in: dateStrings },
    });

    // ── 2. Deduct leave balance (only once, by final approver)
    const user = await User.findById(leave.user);

    // ── AFTER (fixed) ──
    const leaveType = leave.type; // "casual" | "sick" | "earned"
    const typeBalance = user.leaveBalance?.[leaveType];

    const available = typeBalance
        ? Math.max(0, typeBalance.total - typeBalance.used)
        : 0;

    const paidDays = Math.min(available, leave.totalDays);
    const unpaidDays = leave.totalDays - paidDays;

    leave.paidDays = paidDays;
    leave.unpaidDays = unpaidDays;

    if (typeBalance && paidDays > 0) {
        user.leaveBalance[leaveType].used += paidDays;
        await user.save();
    }
};


// ─────────────────────────────────────────────
//  APPLY LEAVE (Employee)
// ─────────────────────────────────────────────
const applyLeave = async (req, res) => {
    try {
        const userId = req.user._id;
        const userName = req.user.name;
        const employeeId = req.user.employeeId;

        const {
            type,
            fromDate,
            toDate,
            reason,
            attachment,
            duration = "full-day",
            halfDaySession = null,
        } = req.body;

        // ── Validation ────────────────────────────
        if (!type || !fromDate || !toDate || !reason) {
            return res.status(400).json({
                success: false,
                message: "type, fromDate, toDate and reason are required",
            });
        }

        if (!["full-day", "half-day"].includes(duration)) {
            return res.status(400).json({
                success: false,
                message: "duration must be 'full-day' or 'half-day'",
            });
        }

        if (
            duration === "half-day" &&
            halfDaySession != null &&
            !["first-half", "second-half"].includes(halfDaySession)
        ) {
            return res.status(400).json({
                success: false,
                message: "halfDaySession must be 'first-half' or 'second-half'",
            });
        }

        const from = moment.tz(fromDate, "YYYY-MM-DD", "Asia/Kolkata").startOf("day").toDate();
        const to = moment.tz(toDate, "YYYY-MM-DD", "Asia/Kolkata").endOf("day").toDate();

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: "fromDate cannot be after toDate",
            });
        }

        // ── Block past-date leave applications ────
        const today = moment.tz("Asia/Kolkata").startOf("day").toDate();

        if (from < today) {
            return res.status(400).json({
                success: false,
                message: "Cannot apply leave for past dates. Contact HR for retroactive leave.",
            });
        }

        // ── Block short leave on Monday (1) and Friday (5) ────
        if (type === "short-leave") {
            const dayOfWeek = moment.tz("Asia/Kolkata").day(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
            if (dayOfWeek === 1 || dayOfWeek === 5) {
                return res.status(400).json({
                    success: false,
                    message: "Short leave is not allowed on Mondays or Fridays.",
                });
            }
        }

        // ── Count working days only ───────────────
        let totalDays = await countWorkingDays(from, to);

        if (totalDays === 0) {
            return res.status(400).json({
                success: false,
                message: "No working days in selected range (only weekends/holidays)",
            });
        }

        if (duration === "half-day") {
            const isSingleDay =
                moment(from).tz("Asia/Kolkata").format("YYYY-MM-DD") ===
                moment(to).tz("Asia/Kolkata").format("YYYY-MM-DD");

            if (!isSingleDay) {
                return res.status(400).json({
                    success: false,
                    message: "Half-day leave must be for a single day",
                });
            }

            totalDays = 0.5;
        }

        // ── Overlap check (normalized dates) ──────
        const [overlap, requestingUser] = await Promise.all([
            Leave.findOne({
                user: userId,
                status: { $in: ["pending", "approved"] },
                $or: [{ fromDate: { $lte: to }, toDate: { $gte: from } }],
            }),
            User.findById(userId)
                .select("role designation department")
        ]);

        if (overlap) {
            return res.status(400).json({
                success: false,
                message: "A leave already exists in this date range",
            });
        }

        const skipTL =
            requestingUser.role === "tl" ||
            requestingUser.designation === "Business Development Manager" ||
            requestingUser.designation === "Business Development Executive";

        // ── Create leave ──────────────────────────
        const leave = await Leave.create({
            user: userId,
            userName,
            employeeId,
            type,
            fromDate: from,
            toDate: to,
            totalDays,
            duration,
            halfDaySession: duration === "half-day" ? halfDaySession : null,
            reason,
            attachment: attachment || "",
            tlApproval: skipTL
                ? { status: "approved", actionBy: userId, actionDate: new Date() }
                : { status: "pending", actionBy: null, actionDate: null },
            skipTLApproval: skipTL,
            userRole: requestingUser.role,
            userDesignation: requestingUser.designation || "",
            userDepartment: requestingUser.department || "",
        });

        const employee = await User.findById(leave.user).select("email name");
        notifyLeaveAppliedEmail(employee.email, {
            employeeName: userName,
            leaveType: type,
            fromDate,
            toDate,
            days: totalDays,
            reason,
        }).catch(err => console.error("Leave Email Error:", err));


        // ── Notify HR, Manager and TL ✅ ─────────────────────────────────────
        const io = req.app.get("io");

        if (skipTL) {
            broadcastNotification(
                io,
                ["hr", "manager"],
                "New Leave Request 📋",
                `${userName} applied for ${type} leave (${totalDays} day${totalDays > 1 ? "s" : ""})`,
                "leave_applied",
                { leaveId: leave._id, userId }
            ).catch(err => console.error(err));
        } else {
            notifyLeaveAppliedSocket(
                io,
                userId,
                "New Leave Request 📋",
                `${userName} applied for ${type} leave (${totalDays} day${totalDays > 1 ? "s" : ""})`,
                { leaveId: leave._id, userId }
            ).catch(err => console.error(err));
        }

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
        const requestingUser = req.user;

        const filter = {};
        if (status) filter.status = status;

        // ── TL sees only their own department's leaves ──
        if (requestingUser.role === "tl") {
            const tlUser = await User.findById(requestingUser._id).select("department");
            if (tlUser?.department) {
                filter.userDepartment = tlUser.department;
            }
        }

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


const approveByTL = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        const io = req.app.get("io");

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id).populate("user", "name email");
        if (!leave) {
            return res.status(404).json({ success: false, message: "Leave not found" });
        }

        // ── TL can only act on their own department's leaves ──
        const tlUser = await User.findById(req.user._id).select("department");
        if (
            tlUser?.department &&
            leave.userDepartment &&
            tlUser.department !== leave.userDepartment
        ) {
            return res.status(403).json({
                success: false,
                message: "You can only approve leaves from your own department",
            });
        }

        if (leave.tlApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "TL has already acted on this leave" });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave is already finalized" });
        }

        leave.tlApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        if (action === "rejected") {
            leave.status = "rejected";
            await leave.save();

            await createNotification(io, leave.user._id, "Leave Rejected ❌",
                `Your ${leave.type} leave request was rejected by your TL`,
                "leave_rejected", { leaveId: leave._id }
            );

            await notifyLeaveRejected(leave.user.email, {
                employeeName: leave.user.name,
                leaveType: leave.type,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                rejectedBy: req.user.name,
                reason: req.body.reason || "",
            });

            return res.status(200).json({ success: true, message: "Leave rejected by TL", leave });
        }

        // Approved — stays "pending" until HR acts
        await leave.save();

        // Notify HR to take action
        await broadcastNotification(io, ["hr", "manager"],
            "Leave Awaiting HR Approval 📋",
            `${leave.user.name}'s ${leave.type} leave approved by TL — needs your review`,
            "leave_applied", { leaveId: leave._id }
        );

        // Notify employee TL approved, now with HR
        await createNotification(io, leave.user._id, "Leave Approved by TL ✅",
            `Your ${leave.type} leave was approved by TL and is now pending HR approval`,
            "leave_approved", { leaveId: leave._id }
        );

        res.status(200).json({
            success: true,
            message: "TL approved — forwarded to HR for final approval",
            leave,
        });

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
        const io = req.app.get("io");

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id).populate("user", "name");
        if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

        if (leave.managerApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "Manager already acted on this leave" });
        }
        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave already finalized" });
        }

        leave.managerApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        if (action === "rejected") {
            leave.status = "rejected";
            await leave.save();

            await createNotification(
                io,
                leave.user._id,
                "Leave Rejected ❌",
                `Your ${leave.type} leave request was rejected by Manager`,
                "leave_rejected",
                { leaveId: leave._id }
            );

            return res.status(200).json({ success: true, message: "Manager rejected leave", leave });
        }

        // ✅ FIX: Manager approval is FINAL — finalize immediately
        leave.status = "approved";
        await finalizeApproval(leave);
        await leave.save();

        // Notify employee
        await createNotification(
            io,
            leave.user._id,
            "Leave Approved",
            `Your ${leave.type} leave (${leave.totalDays} days) has been approved by Manager`,
            "leave_approved",
            { leaveId: leave._id, paidDays: leave.paidDays, unpaidDays: leave.unpaidDays }
        );

        // ── NEW: Notify the Manager who approved (self-confirmation) ──
        await createNotification(
            io,
            req.user._id,
            "Leave Approved ✅",
            `You approved ${leave.user.name}'s ${leave.type} leave (${leave.totalDays} days). Paid: ${leave.paidDays}, Unpaid: ${leave.unpaidDays}`,
            "leave_approved",
            { leaveId: leave._id }
        );

        res.status(200).json({ success: true, message: "Manager approved leave", leave });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const approveByHR = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        const io = req.app.get("io");

        if (!["approved", "rejected"].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const leave = await Leave.findById(id).populate("user", "name email");
        if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

        // ── Skip TL check if leave was marked to skip TL approval ──
        if (!leave.skipTLApproval && leave.tlApproval.status !== "approved") {
            return res.status(400).json({
                success: false,
                message: "TL approval is required before HR can act on this leave",
            });
        }

        if (leave.hrApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "HR has already acted on this leave" });
        }

        if (leave.status !== "pending") {
            return res.status(400).json({ success: false, message: "Leave is already finalized" });
        }

        leave.hrApproval = {
            status: action,
            actionBy: req.user._id,
            actionDate: new Date(),
        };

        leave.status = action === "approved" ? "approved" : "rejected";

        if (action === "approved") {
            await finalizeApproval(leave);
        }

        await leave.save();

        if (action === "approved") {
            // Notify employee
            await createNotification(io, leave.user._id, "Leave Approved ✅",
                `Your ${leave.type} leave (${leave.totalDays} days) has been approved by HR`,
                "leave_approved",
                { leaveId: leave._id, paidDays: leave.paidDays, unpaidDays: leave.unpaidDays }
            );

            // ── NEW: Notify the HR who approved (self-confirmation) ──
            await createNotification(io, req.user._id, "Leave Approved ✅",
                `You approved ${leave.user.name}'s ${leave.type} leave (${leave.totalDays} days). Paid: ${leave.paidDays}, Unpaid: ${leave.unpaidDays}`,
                "leave_approved",
                { leaveId: leave._id }
            );

            await notifyLeaveApproved(leave.user.email, {
                employeeName: leave.user.name,
                leaveType: leave.type,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                days: leave.totalDays,
                approvedBy: req.user.name,
            });
        } else {
            // Notify employee
            await createNotification(io, leave.user._id, "Leave Rejected ❌",
                `Your ${leave.type} leave request was rejected by HR`,
                "leave_rejected", { leaveId: leave._id }
            );

            // ── NEW: Notify the HR who rejected (self-confirmation) ──
            await createNotification(io, req.user._id, "Leave Rejected ❌",
                `You rejected ${leave.user.name}'s ${leave.type} leave request.`,
                "leave_rejected",
                { leaveId: leave._id }
            );

            await notifyLeaveRejected(leave.user.email, {
                employeeName: leave.user.name,
                leaveType: leave.type,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                rejectedBy: req.user.name,
                reason: req.body.reason || "",
            });
        }

        res.status(200).json({ success: true, message: `HR ${action}d leave`, leave });

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
        const io = req.app.get("io");

        const leave = await Leave.findById(id);
        if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

        if (leave.status !== "approved") {
            return res.status(400).json({ success: false, message: "Only approved leaves can be revoked" });
        }

        // Restore balance
        if (leave.paidDays > 0) {
            await User.findByIdAndUpdate(leave.user, {
                $inc: {
                    // "leaveBalance.total": leave.paidDays,
                    [`leaveBalance.${leave.type}.used`]: -leave.paidDays,
                },
            });
        }

        leave.status = "revoked";
        leave.paidDays = 0;
        leave.unpaidDays = 0;
        
        // Restore overwritten attendance records
        if (leave.overwrittenAttendances && leave.overwrittenAttendances.length > 0) {
            for (const att of leave.overwrittenAttendances) {
                try {
                    await Attendance.create(att);
                } catch(e) { 
                    // Ignore duplicate key errors if the user somehow punched in again
                }
            }
        }
        
        await leave.save();

        // ✅ Notify employee — io passed correctly
        await createNotification(
            io,
            leave.user,
            "Leave Revoked ⚠️",
            "Your approved leave has been revoked by HR. Please contact HR for details.",
            "leave_rejected",
            { leaveId: leave._id }
        );

        res.status(200).json({ success: true, message: "Leave revoked and balance restored", leave });

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
        if (leave.status === "approved") {
            if (leave.paidDays > 0) {
                await User.findByIdAndUpdate(leave.user, {
                    $inc: {
                        [`leaveBalance.${leave.type}.used`]: -leave.paidDays,
                    },
                });
            }
            // Restore overwritten attendance records
            if (leave.overwrittenAttendances && leave.overwrittenAttendances.length > 0) {
                for (const att of leave.overwrittenAttendances) {
                    try {
                        await Attendance.create(att);
                    } catch(e) { 
                        // Ignore duplicate key errors
                    }
                }
            }
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


const computeExpectedCasualTotal = (user) => {
    const now = new Date();
    const nowMonth = now.getMonth() + 1; // 1–12
    const nowYear = now.getFullYear();

    const bal = user.leaveBalance || {};
    const lastResetYear = bal.lastResetYear || 0;

    if (lastResetYear < nowYear) {
        return nowMonth;
    }

    return Math.max(bal.casual?.total ?? 0, nowMonth);
};

const getLeaveBalance = async (req, res) => {
    try {
        const targetId = req.params.userId || req.user._id;
        const user = await User.findById(targetId).select("leaveBalance name employeeId");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const now = new Date();
        const nowMonth = now.getMonth() + 1;
        const nowYear = now.getFullYear();

        // ── Short leave ──────────────────────────────────────────────────
        const sl = user.leaveBalance?.shortLeave || {};
        const isNewMonth =
            (sl.lastGrantedYear || nowYear) < nowYear ||
            (
                (sl.lastGrantedYear || nowYear) === nowYear &&
                (sl.lastGrantedMonth || nowMonth) < nowMonth
            );
        const shortLeaveUsed = isNewMonth ? 0 : (sl.used || 0);
        const shortLeaveAvailable = Math.max(0, 1 - shortLeaveUsed);

        const expectedCasualTotal = computeExpectedCasualTotal(user);
        const storedCasualTotal = user.leaveBalance?.casual?.total ?? 0;
        const casualUsed = user.leaveBalance?.casual?.used ?? 0;

        const lastResetYear = user.leaveBalance?.lastResetYear || 0;
        const isStaleFromLastYear = lastResetYear < nowYear;

        const casualTotal = isStaleFromLastYear
            ? expectedCasualTotal
            : Math.max(storedCasualTotal, expectedCasualTotal);

        const casualRemaining = Math.max(0, casualTotal - (isStaleFromLastYear ? 0 : casualUsed));

        // ── Build response object ────────────────────────────────────────
        const leaveBalance = user.leaveBalance?.toObject
            ? user.leaveBalance.toObject()
            : { ...(user.leaveBalance || {}) };

        // Override casual with computed values
        leaveBalance.casual = {
            ...(leaveBalance.casual || {}),
            total: casualTotal,
            used: casualUsed,
            remaining: casualRemaining,
        };

        // Override shortLeave
        leaveBalance.shortLeave = {
            ...(leaveBalance.shortLeave || {}),
            total: 1,
            used: shortLeaveUsed,
            available: shortLeaveAvailable,
        };

        res.json({
            success: true,
            leaveBalance,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  GET ALL EMPLOYEES WITH LEAVE BALANCE (HR)
// ─────────────────────────────────────────────
const getEmployeesLeaveBalances = async (req, res) => {
    try {
        const employees = await User.find({ role: { $in: ["employee", "tl"] } })
            .select("name email employeeId role leaveBalance")
            .sort({ name: 1 });

        res.status(200).json({ success: true, employees });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE EMPLOYEE LEAVE BALANCE (HR)
//  HR only sets "total" — used is system-managed
// ─────────────────────────────────────────────
const updateEmployeeLeaveBalance = async (req, res) => {
    try {
        const { userId } = req.params;
        const { type, total } = req.body;

        const validTypes = ["casual", "sick", "earned"];
        if (!type || !validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                message: "type is required and must be one of: casual, sick, earned",
            });
        }

        if (total === undefined || isNaN(Number(total)) || Number(total) < 0) {
            return res.status(400).json({
                success: false,
                message: "Valid total is required",
            });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "Employee not found" });

        // Only update the selected leave type's total
        user.leaveBalance[type].total = Number(total);
        await user.save();

        const io = req.app.get("io");
        await createNotification(
            io,
            user._id,
            "Leave Balance Updated 📋",
            `Your ${type} leave balance has been updated to ${total} days by HR.`,
            "general",
            {}
        );

        res.status(200).json({
            success: true,
            message: `${type} leave balance updated for ${user.name}`,
            leaveBalance: user.leaveBalance,
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
    getLeaveBalance,
    getEmployeesLeaveBalances,
    updateEmployeeLeaveBalance,
};
