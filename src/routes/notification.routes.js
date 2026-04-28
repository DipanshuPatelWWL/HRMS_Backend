const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");

const {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllRead,
    clearAll,
} = require("../controllers/notification.controller");

/* GET  /notifications              – fetch all (latest 50) for logged-in user */
router.get("/", protect, getMyNotifications);

/* GET  /notifications/unread-count – fast badge count without fetching all */
router.get("/unread-count", protect, getUnreadCount);

/* PUT  /notifications/mark-all-read – mark every unread → read in one shot  */
router.put("/mark-all-read", protect, markAllRead);

/* PUT  /notifications/:id          – mark a single notification as read      */
router.put("/:id", protect, markAsRead);

/* DELETE /notifications/clear      – wipe all notifications for the user     */
router.delete("/clear", protect, clearAll);

module.exports = router;