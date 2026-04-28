const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    createAnnouncement,
    getAnnouncements,
    getAllAnnouncementsHR,
    getSingleAnnouncement,
    markAsRead,
    updateAnnouncement,
    deleteAnnouncement,
    getUnreadCount,
} = require("../controllers/announcement.controller");

// Unread count — any logged in user (used for sidebar badge)
router.get(
    "/unread-count",
    protect,
    getUnreadCount
);

// Create — HR / Manager
router.post(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    createAnnouncement
);

// All announcements for logged in user (role-filtered)
router.get(
    "/",
    protect,
    getAnnouncements
);

// All announcements for HR (no filter)
router.get(
    "/all",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllAnnouncementsHR
);

// Single announcement
router.get(
    "/:id",
    protect,
    getSingleAnnouncement
);

// Mark as read
router.put(
    "/:id/read",
    protect,
    markAsRead
);

// Update — HR / Manager
router.put(
    "/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateAnnouncement
);

// Delete — HR / Manager
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteAnnouncement
);

module.exports = router;