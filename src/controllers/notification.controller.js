const Notification = require("../models/notification.model");
const User = require("../models/user.model");

/* ─── Map type → socket event name ──────────────────────────────────────── */
const TYPE_TO_EVENT = {
    attendance: "attendancePunch",
    announcement: "newAnnouncement",
    leave_applied: "leaveApplied",
    leave_approved: "leaveApproved",
    leave_rejected: "leaveRejected",
    task_assigned: "taskAssigned",
    task_updated: "taskUpdated",
    task_done: "taskCompleted",
    ticket_replied: "ticketReplied",
    ticket_resolved: "ticketResolved",
    payroll: "payrollGenerated",
};

const createNotification = async (
    io,
    userId,
    title,
    message = "",
    type = "general",
    meta = {}
) => {
    /* 1. Dedup — skip if identical notification created in last 10s */
    const recentDuplicate = await Notification.findOne({
        user: userId,
        type,
        title,
        createdAt: { $gte: new Date(Date.now() - 10_000) },
    }).lean();

    if (recentDuplicate) return recentDuplicate;

    /* 2. Save to DB */
    const notification = await Notification.create({
        user: userId,
        title,
        message,
        type,
        meta,
    });

    /* 3. Emit via Socket.IO */
    if (io) {
        const payload = {
            _id: notification._id,
            type,
            title,
            message,
            meta,
            isRead: false,
            createdAt: notification.createdAt,
        };

        /* Every user is in the room "user:<their_id>" — see server.js setup */
        io.to(`user_${userId}`).emit("newNotification", payload);
    }

    return notification;
};

/* ─────────────────────────────────────────────────────────────────────────
   broadcastNotification(io, roles, title, message, type, meta)
   ─────────────────────────────────────────────────────────────
   Notify ALL users who have a certain role.

   Example — notify every HR + manager when a leave is applied:
     await broadcastNotification(
       req.io,
       ["hr", "manager"],
       "New Leave Request 📋",
       `${req.user.name} applied for casual leave.`,
       "leave_applied",
       { leaveId: leave._id }
     );
───────────────────────────────────────────────────────────────────────── */
const broadcastNotification = async (
    io,
    roles = [],
    title,
    message = "",
    type = "general",
    meta = {}
) => {
    if (!roles.length) return;

    const users = await User.find({ role: { $in: roles } }).select("_id").lean();

    /* Run all in parallel, don't let one failure stop the rest */
    await Promise.allSettled(
        users.map(u => createNotification(io, u._id, title, message, type, meta))
    );
};

const notifyLeaveApplied = async (io, applicantId, title, message = "", meta = {}) => {
    const applicant = await User.findById(applicantId)
        .select("reportingTo")
        .lean();

    const targetIds = new Set();

    /* Only THIS employee's direct TL */
    if (applicant?.reportingTo) {
        targetIds.add(applicant.reportingTo.toString());
    }

    /* All HR users */
    const hrUsers = await User.find({ role: "hr" }).select("_id").lean();
    hrUsers.forEach(u => targetIds.add(u._id.toString()));

    if (!targetIds.size) return;

    await Promise.allSettled(
        [...targetIds].map(uid =>
            createNotification(io, uid, title, message, "leave_applied", meta)
        )
    );
};


const notifyAttendance = async (io, employeeId, title, message = "", meta = {}) => {
    return createNotification(io, employeeId, title, message, "attendance", meta);
};

/* ─── HTTP route handlers ────────────────────────────────────────────────── */

/* GET /notifications */
const getMyNotifications = async (req, res) => {
    try {
        const { role, _id: userId } = req.user;

        if (role === "hr" || role === "manager" || role === "superadmin") {
            const data = await Notification.find({ user: userId })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean();
            return res.json({ success: true, data });
        }

        if (role === "tl") {
            const data = await Notification.find({ user: userId })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean();
            return res.json({ success: true, data });
        }

        // Employee — strictly their own notifications only
        const data = await Notification.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
};

/* GET /notifications/unread-count */
const getUnreadCount = async (req, res) => {
    try {
        const { role, _id: userId } = req.user;

        let query;

        if (role === "hr" || role === "manager" || role === "superadmin") {
            query = { isRead: false, user: userId };
        } else if (role === "tl") {
            query = { isRead: false, user: userId };
        } else {
            // Employee — only their own
            query = { isRead: false, user: userId };
        }

        const count = await Notification.countDocuments(query);
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to get count" });
    }
};

/* PUT /notifications/:id */
const markAsRead = async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to mark as read" });
    }
};

/* PUT /notifications/mark-all-read */
const markAllRead = async (req, res) => {
    try {
        const { role, _id: userId } = req.user;

        let filter;

        if (role === "hr" || role === "manager" || role === "superadmin") {
            filter = { isRead: false, user: userId };
        } else if (role === "tl") {
            filter = { isRead: false, user: userId };
        } else {
            filter = { isRead: false, user: userId };
        }

        await Notification.updateMany(filter, { isRead: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to mark all as read" });
    }
};

/* DELETE /notifications/clear */
const clearAll = async (req, res) => {
    try {
        const { role, _id: userId } = req.user;

        let filter;

        if (role === "hr" || role === "manager" || role === "superadmin") {
            filter = { user: userId };
        } else if (role === "tl") {
            filter = { user: userId };
        } else {
            filter = { user: userId };
        }

        await Notification.deleteMany(filter);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to clear" });
    }
};

module.exports = {
    createNotification,
    broadcastNotification,
    notifyLeaveApplied,
    notifyAttendance,
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllRead,
    clearAll,
};