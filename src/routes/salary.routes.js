const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const { getMonthlySalary, updateSalaryAccess } = require("../controllers/salary.controller");

router.get(
    "/:userId/monthly",
    protect,
    allowRoles("hr", "employee", "superadmin"),
    getMonthlySalary
);

router.put(
    "/salary-access/:id",
    protect,
    allowRoles("hr", "superadmin"),
    updateSalaryAccess
);

module.exports = router;