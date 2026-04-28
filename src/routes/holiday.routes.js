// routes/holiday.routes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const { markHoliday, deleteHoliday, getHolidays, updateHoliday } = require("../controllers/holiday.controller");

// Only HR / superadmin can mark or delete holidays
router.post("/", protect, allowRoles("hr", "superadmin"), markHoliday);
router.delete("/:id", protect, allowRoles("hr", "superadmin"), deleteHoliday);
router.put("/:id", protect, allowRoles("hr", "superadmin"), updateHoliday);

// Everyone can view holidays (to show on their calendar)
router.get("/", protect, getHolidays);

module.exports = router;