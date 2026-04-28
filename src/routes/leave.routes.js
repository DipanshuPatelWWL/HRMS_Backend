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
} = require("../controllers/leave.controller");

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
    allowRoles("hr", "manager", "superadmin"),
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
    allowRoles("hr", "superadmin"),
    approveByHR
);

// ✅ FIX: Employee included so they can cancel their own pending leave
router.put(
    "/cancel/:id",
    protect,
    allowRoles("employee", "tl", "manager", "hr"),
    cancelLeave
);

// ✅ NEW: HR can revoke an approved leave (restores balance)
router.put(
    "/revoke/:id",
    protect,
    allowRoles("hr", "superadmin"),
    revokeLeave
);

// Delete leave record (also restores balance if approved)
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "superadmin"),
    deleteLeave
);

module.exports = router;