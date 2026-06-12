const Announcement = require("../models/announcement.model");
const User = require("../models/user.model");
const { createNotification } = require("./notification.controller");
const { notifyAnnouncement } = require("../services/emailNotify");
const moment = require("moment-timezone");

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
        res.status(201).json({
            success: true,
            message: "Announcement created",
            announcement: populated,
        });

        // Run notifications and emails AFTER response
        setImmediate(async () => {
            try {
                const io = req.app.get("io");

                const notifTitle = `📢 ${title}`;
                const notifMessage = body?.slice(0, 100);
                const meta = {
                    announcementId: announcement._id,
                };

                // Get users
                let query = {};
                if (targetUsers?.length > 0) {
                    query = { _id: { $in: targetUsers } };
                } else if (targetRole === "all") {
                    // Send only to employees and TLs
                    query = { role: { $in: ["employee", "tl"] } };
                } else {
                    query = { role: targetRole };
                }

                const users = await User.find(query)
                    .select("_id email role name")
                    .lean();

                const filteredUsers = users.filter(
                    (u) =>
                        u._id.toString() !== req.user._id.toString() &&
                        !["hr", "manager", "superadmin"].includes(u.role)
                );

                // 1. Socket Updates (Real-time)
                filteredUsers.forEach((u) => {
                    io.to(`user_${u._id}`).emit("newAnnouncement", populated);
                });

                // 2. Persistent Notifications (DB + Socket)
                await Promise.allSettled(
                    filteredUsers.map((u) =>
                        createNotification(
                            io,
                            u._id,
                            notifTitle,
                            notifMessage,
                            "announcement",
                            meta
                        )
                    )
                );

                // 3. Email Notifications (Sequential for SMTP safety)
                for (const u of filteredUsers) {
                    try {
                        // Double check safeguard
                        if (
                            u._id.toString() === req.user._id.toString() ||
                            ["hr", "manager", "superadmin"].includes(u.role)
                        ) {
                            continue;
                        }

                        await notifyAnnouncement(u.email, {
                            title,
                            body,
                            postedBy: req.user?.name || "HR",
                        });

                        // Optional: Small delay to prevent SMTP burst for large lists
                        if (filteredUsers.length > 50) {
                            await new Promise(r => setTimeout(r, 100));
                        }
                    } catch (emailErr) {
                        // Keep console.error for genuine failures
                        console.error("Email error for:", u.email, emailErr.message);
                    }
                }

            } catch (err) {
                console.error(
                    "Announcement background task failed:",
                    err
                );
            }
        });

        return;

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─── GET ALL (filtered by role + joining date) ──────────────────────────────
const getAnnouncements = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user._id;

        // Get full user data
        const user = await User.findById(userId).select("joiningDate role");

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

        // ✅ Employees should only see announcements
        // created AFTER their joining date
        if (
            user?.joiningDate &&
            user.role === "employee"
        ) {
            filter.$and.push({
                createdAt: {
                    $gte: new Date(user.joiningDate),
                },
            });
        }

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
        res.status(500).json({
            success: false,
            message: error.message,
        });
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

        // Only count actual announcement recipients: employee, tl
        const allowedRoles = ["employee", "tl"];
        let allUsers = [];

        if (announcement.targetUsers && announcement.targetUsers.length > 0) {
            allUsers = await User.find(
                {
                    _id: { $in: announcement.targetUsers },
                    role: { $in: allowedRoles }
                },
                "name role"
            );
        } else if (announcement.targetRole === "all") {
            // "all" should only include employee and tl for analytics
            allUsers = await User.find(
                { role: { $in: allowedRoles } },
                "name role"
            );
        } else if (allowedRoles.includes(announcement.targetRole)) {
            allUsers = await User.find(
                { role: announcement.targetRole },
                "name role"
            );
        }

        const uniqueReadMap = new Map();
        announcement.readBy.forEach((u) => {
            // Exclude manager, hr, superadmin from seen list
            if (u && allowedRoles.includes(u.role)) {
                uniqueReadMap.set(u._id.toString(), u);
            }
        });

        const uniqueRead = Array.from(uniqueReadMap.values());
        const readIds = uniqueRead.map(u => u._id.toString());
        const creatorId = announcement.createdBy?._id?.toString();

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