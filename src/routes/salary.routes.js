const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const { getMonthlySalary, updateSalaryAccess, updateSalaryStructure } = require("../controllers/salary.controller");

router.get(
    "/:userId/monthly",
    protect,
    allowRoles("hr", "employee", "tl", "manager"),
    getMonthlySalary
);

router.put(
    "/salary-access/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateSalaryAccess
);


// HR/Manager configures salary structure + deductions per employee
router.put(
    "/:userId/structure",
    protect,
    allowRoles("hr", "manager"),
    updateSalaryStructure
);

module.exports = router;