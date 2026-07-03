const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const { getPayrollSettings, updatePayrollSettings } = require("../controllers/payrollSettings.controller");

router.get("/", protect, allowRoles("hr", "superadmin"), getPayrollSettings);
router.put("/", protect, allowRoles("hr", "superadmin"), updatePayrollSettings);

module.exports = router;
