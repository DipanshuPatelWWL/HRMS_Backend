const Announcement = require("../models/announcement.model");
const User = require("../models/user.model");

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

        // 🎯 If specific users selected
        if (targetUsers && targetUsers.length > 0) {
            targetUsers.forEach((userId) => {
                io.to(userId.toString()).emit("newAnnouncement", populated);
            });
        } else {
            // 📢 Send to all
            io.emit("newAnnouncement", populated);
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


        // Build query
        const filter = {
            $and: [
                {
                    $or: [
                        { targetRole: "all" },
                        { targetRole: userRole },
                        { targetUsers: userId }, // 🎯 important
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

        // Mark which ones the user has read
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

        // ✅ Remove duplicates from readBy
        const uniqueReadMap = new Map();

        announcement.readBy.forEach((u) => {
            uniqueReadMap.set(u._id.toString(), u);
        });

        const uniqueRead = Array.from(uniqueReadMap.values());

        // Extract unique IDs
        const readIds = uniqueRead.map(u => u._id.toString());

        const creatorId = announcement.createdBy._id.toString();

        const notRead = allUsers.filter(
            u =>
                !readIds.includes(u._id.toString()) &&
                u._id.toString() !== creatorId
        );

        const analytics = {
            read: uniqueRead,
            notRead,
            total: allUsers.length,
        };

        res.json({
            success: true,
            announcement,
            analytics,
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

        // Add user to readBy if not already there
        if (!announcement.readBy.some(
            (id) => id.toString() === req.user._id.toString()
        )) {
            announcement.readBy.push(req.user._id);
            await announcement.save();
        }

        res.status(200).json({
            success: true,
            message: "Marked as read",
        });
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

        res.status(200).json({
            success: true,
            message: "Announcement deleted",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET UNREAD COUNT (for notification badge) ───────────────────────────────
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
                {
                    readBy: { $ne: userId },
                },
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