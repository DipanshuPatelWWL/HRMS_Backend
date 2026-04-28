const Notification = require("../models/notification.model");
const User = require("../models/user.model");

/* ─── Map type → socket event name ──────────────────────────────────────── */
const TYPE_TO_EVENT = {
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

/* ─────────────────────────────────────────────────────────────────────────
   createNotification(io, userId, title, message, type, meta)
   ──────────────────────────────────────────────────────────
   Call this from any controller after an important action.

   Example:
     await createNotification(
       req.io,
       leave.user._id,
       "Leave Approved ✅",
       `Your ${leave.type} leave has been approved.`,
       "leave_approved",
       { leaveId: leave._id }
     );
───────────────────────────────────────────────────────────────────────── */
const createNotification = async (
    io,
    userId,
    title,
    message = "",
    type = "general",
    meta = {}
) => {
    /* 1. Save to DB */
    const notification = await Notification.create({
        user: userId,
        title,
        message,
        type,
        meta,
    });

    /* 2. Emit via Socket.IO */
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
        io.to(`user:${userId}`).emit("newNotification", payload);

        /* Also emit the specific event e.g. "leaveApproved" */
        const specificEvent = TYPE_TO_EVENT[type];
        if (specificEvent) {
            io.to(`user:${userId}`).emit(specificEvent, payload);
        }
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

/* ─── HTTP route handlers ────────────────────────────────────────────────── */

/* GET /notifications */
const getMyNotifications = async (req, res) => {
    try {
        const data = await Notification.find({ user: req.user._id })
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
        const count = await Notification.countDocuments({
            user: req.user._id,
            isRead: false,
        });
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
        await Notification.updateMany(
            { user: req.user._id, isRead: false },
            { isRead: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to mark all as read" });
    }
};

/* DELETE /notifications/clear */
const clearAll = async (req, res) => {
    try {
        await Notification.deleteMany({ user: req.user._id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to clear" });
    }
};

module.exports = {
    createNotification,
    broadcastNotification,
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllRead,
    clearAll,
};