const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const { getMonthlySalary, updateSalaryAccess } = require("../controllers/salary.controller");

router.get(
    "/:userId/monthly",
    protect,
    allowRoles("hr", "employee", "tl", "manager"),
    getMonthlySalary
);

router.put(
    "/salary-access/:id",
    protect,
    allowRoles("hr", "manager", "manager"),
    updateSalaryAccess
);

module.exports = router;