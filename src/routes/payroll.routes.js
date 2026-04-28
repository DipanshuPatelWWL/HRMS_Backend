const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    processPayroll,
    getMyPayrolls,
    getAllPayrolls,
    updatePayroll,
    markAsPaid,
} = require("../controllers/payroll.controller");



router.post(
    "/process",
    protect,
    allowRoles("hr", "superadmin"),
    processPayroll
);

router.get(
    "/my",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    getMyPayrolls
);


router.get(
    "/",
    protect,
    allowRoles("hr", "superadmin"),
    getAllPayrolls
);

router.put(
    "/:id",
    protect,
    allowRoles("hr", "superadmin"),
    updatePayroll
);

router.put(
    "/pay/:id",
    protect,
    allowRoles("hr", "superadmin"),
    markAsPaid
);

module.exports = router;