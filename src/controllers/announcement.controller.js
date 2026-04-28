const Announcement = require("../models/announcement.model");
const User = require("../models/user.model");
const { createNotification } = require("./notification.controller");

// ─── CREATE (HR / Manager) ───────────────────────────────────────────────────
const createAnnouncement = async (req, res) => {
    try {
        const { title, body, targetRole, targetUsers, pinned, important, expiresAt } = req.body;

        if (!title || !body) {
            return res.status(400).json({
                success: false,
                message: "title and body are required",
            });
        }

        const announcement = await Announcement.create({
            title,
            body,
            createdBy: req.user._id,
            targetRole: targetRole || "all",
            targetUsers: targetUsers || [],
            pinned: pinned || false,
            important: important || false,
            expiresAt: expiresAt || null,
        });

        const populated = await Announcement.findById(announcement._id)
            .populate("createdBy", "name email role");

        const io = req.app.get("io");

        // ── Socket emit (your existing logic — kept as is) ──────────────────
        if (targetUsers && targetUsers.length > 0) {
            targetUsers.forEach((userId) => {
                io.to(userId.toString()).emit("newAnnouncement", populated);
            });
        } else {
            io.emit("newAnnouncement", populated);
        }

        // ── Notifications ────────────────────────────────────────────────────
        const notifTitle = `📢 ${title}`;
        const notifMessage = body?.slice(0, 100);
        const meta = { announcementId: announcement._id };

        if (targetUsers && targetUsers.length > 0) {
            // Notify only the selected users
            await Promise.allSettled(
                targetUsers.map(userId =>
                    createNotification(io, userId, notifTitle, notifMessage, "announcement", meta)
                )
            );
        } else {
            // Notify all users matching the targetRole
            const roleFilter = targetRole === "all"
                ? {}
                : { role: targetRole };

            const users = await User.find(roleFilter).select("_id").lean();

            await Promise.allSettled(
                users
                    .filter(u => u._id.toString() !== req.user._id.toString()) // don't notify yourself
                    .map(u =>
                        createNotification(io, u._id, notifTitle, notifMessage, "announcement", meta)
                    )
            );
        }

        res.status(201).json({
            success: true,
            message: "Announcement created",
            announcement: populated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL (filtered by role) ──────────────────────────────────────────────
const getAnnouncements = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user._id;

        const filter = {
            $and: [
                {
                    $or: [
                        { targetRole: "all" },
                        { targetRole: userRole },
                        { targetUsers: userId },
                    ],
                },
                {
                    $or: [
                        { expiresAt: null },
                        { expiresAt: { $gt: new Date() } },
                    ],
                },
            ],
        };

        const announcements = await Announcement.find(filter)
            .populate("createdBy", "name role")
            .sort({ pinned: -1, createdAt: -1 });

        const withRead = announcements.map((a) => ({
            ...a.toObject(),
            isRead: a.readBy.some(
                (id) => id.toString() === req.user._id.toString()
            ),
        }));

        res.status(200).json({
            success: true,
            count: withRead.length,
            announcements: withRead,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL FOR HR (no filter, includes expired) ────────────────────────────
const getAllAnnouncementsHR = async (req, res) => {
    try {
        const announcements = await Announcement.find()
            .populate("createdBy", "name email role")
            .sort({ pinned: -1, createdAt: -1 });

        res.status(200).json({
            success: true,
            count: announcements.length,
            announcements,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET SINGLE ──────────────────────────────────────────────────────────────
const getSingleAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id)
            .populate("createdBy", "name email role")
            .populate("readBy", "name email role");

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        let allUsers = [];

        if (announcement.targetUsers && announcement.targetUsers.length > 0) {
            allUsers = await User.find(
                { _id: { $in: announcement.targetUsers } },
                "name role"
            );
        } else if (announcement.targetRole === "all") {
            allUsers = await User.find({}, "name role");
        } else {
            allUsers = await User.find(
                { role: announcement.targetRole },
                "name role"
            );
        }

        const uniqueReadMap = new Map();
        announcement.readBy.forEach((u) => {
            uniqueReadMap.set(u._id.toString(), u);
        });
        const uniqueRead = Array.from(uniqueReadMap.values());
        const readIds = uniqueRead.map(u => u._id.toString());
        const creatorId = announcement.createdBy._id.toString();

        const notRead = allUsers.filter(
            u =>
                !readIds.includes(u._id.toString()) &&
                u._id.toString() !== creatorId
        );

        res.json({
            success: true,
            announcement,
            analytics: {
                read: uniqueRead,
                notRead,
                total: allUsers.length,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── MARK AS READ ────────────────────────────────────────────────────────────
const markAsRead = async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        if (!announcement.readBy.some(
            (id) => id.toString() === req.user._id.toString()
        )) {
            announcement.readBy.push(req.user._id);
            await announcement.save();
        }

        res.status(200).json({ success: true, message: "Marked as read" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE (HR / Manager) ───────────────────────────────────────────────────
const updateAnnouncement = async (req, res) => {
    try {
        const { title, body, targetRole, targetUsers, pinned, important, expiresAt } = req.body;

        const announcement = await Announcement.findById(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        if (title !== undefined) announcement.title = title;
        if (body !== undefined) announcement.body = body;
        if (targetRole !== undefined) announcement.targetRole = targetRole;
        if (targetUsers !== undefined) announcement.targetUsers = targetUsers;
        if (pinned !== undefined) announcement.pinned = pinned;
        if (important !== undefined) announcement.important = important;
        if (expiresAt !== undefined) announcement.expiresAt = expiresAt;

        await announcement.save();

        const populated = await Announcement.findById(announcement._id)
            .populate("createdBy", "name email role");

        // Emit update event so frontend lists refresh in real-time
        const io = req.app.get("io");
        io.emit("updatedAnnouncement", populated);

        res.status(200).json({
            success: true,
            message: "Announcement updated",
            announcement: populated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE (HR / Manager) ───────────────────────────────────────────────────
const deleteAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
            });
        }

        // Emit delete event so frontend removes it instantly
        const io = req.app.get("io");
        io.emit("deletedAnnouncement", req.params.id);

        res.status(200).json({ success: true, message: "Announcement deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET UNREAD COUNT ────────────────────────────────────────────────────────
const getUnreadCount = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user._id;

        const count = await Announcement.countDocuments({
            $and: [
                {
                    $or: [
                        { targetRole: "all" },
                        { targetRole: userRole },
                        { targetUsers: userId },
                    ],
                },
                { readBy: { $ne: userId } },
                {
                    $or: [
                        { expiresAt: null },
                        { expiresAt: { $gt: new Date() } },
                    ],
                },
            ],
        });

        res.status(200).json({ success: true, unreadCount: count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createAnnouncement,
    getAnnouncements,
    getAllAnnouncementsHR,
    getSingleAnnouncement,
    markAsRead,
    updateAnnouncement,
    deleteAnnouncement,
    getUnreadCount,
};