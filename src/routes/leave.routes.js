const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    applyLeave,
    getMyLeaves,
    getAllLeaves,
    approveByTL,
    approveByManager,
    approveByHR,
    cancelLeave,
    revokeLeave,
    deleteLeave,
    getLeaveBalance,
    getEmployeesLeaveBalances,
    updateEmployeeLeaveBalance,
} = require("../controllers/leave.controller");

// Employee views own leave balance
router.get(
    "/balance",
    protect,
    allowRoles("employee", "tl", "manager", "hr", "superadmin"),
    getLeaveBalance
);

// Employee applies leave
router.post(
    "/apply",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    applyLeave
);

// Employee views own leaves
router.get(
    "/my",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    getMyLeaves
);

// HR / Manager view all leaves
router.get(
    "/all",
    protect,
    allowRoles("hr", "manager", "superadmin", "tl"),
    getAllLeaves
);

// TL approval
router.put(
    "/tl-approve/:id",
    protect,
    allowRoles("tl"),
    approveByTL
);

// Manager approval
router.put(
    "/manager-approve/:id",
    protect,
    allowRoles("manager"),
    approveByManager
);

// HR final approval
router.put(
    "/hr-approve/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    approveByHR
);

// Employee can cancel their own pending leave
router.put(
    "/cancel/:id",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    cancelLeave
);

// HR can revoke an approved leave (restores balance)
router.put(
    "/revoke/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    revokeLeave
);

// Delete leave record (also restores balance if approved)
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteLeave
);


// HR views all employees leave balances
router.get(
    "/balances/all",
    protect,
    allowRoles("hr", "manager"),
    getEmployeesLeaveBalances
);

// HR updates a specific employee's leave balance total
router.put(
    "/balance/:userId",
    protect,
    allowRoles("hr", "manager"),
    updateEmployeeLeaveBalance
);

module.exports = router;