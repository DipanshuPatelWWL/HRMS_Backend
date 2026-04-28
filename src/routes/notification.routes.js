const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");

const {
    getMyNotifications,
    markAsRead,
} = require("../controllers/notification.controller");

router.get("/", protect, getMyNotifications);
router.put("/:id", protect, markAsRead);

module.exports = router;