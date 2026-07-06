const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    getAllRequests,
    approveDevice,
    rejectDevice,
    revokeDevice,
    getEmployeeDevices,
    requestDeviceApproval,
    getMyDeviceRequests,
} = require("../controllers/deviceApproval.controller");


router.post(
    "/request",
    protect,
    requestDeviceApproval
);


router.get(
    "/my",
    protect,
    getMyDeviceRequests
);

// HR views all requests
router.get(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllRequests
);

// HR approves
router.put(
    "/:id/approve",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    approveDevice
);

// HR rejects
router.put(
    "/:id/reject",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    rejectDevice
);

// HR revokes approved device
router.post(
    "/revoke",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    revokeDevice
);

// Get devices for one employee
router.get(
    "/:userId/devices",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getEmployeeDevices
);

module.exports = router;