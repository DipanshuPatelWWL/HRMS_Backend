const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const {
    uploadAvatar: uploadAvatarMiddleware,
    uploadDocuments: uploadDocumentsMiddleware,
} = require("../middleware/upload.middleware");

const {
    createUserByHR,
    getAllUsers,
    getSingleUser,
    updateUser,
    deleteUser,
    debugUsers,
    updateMyProfile,
    changeMyPassword,
    uploadAvatar,
    updateUserStatus,
    getGovernmentId,
    updateGovernmentId,
    getBankDetails,
    updateBankDetails,
    getAllTLs,
    assignTeamToTL,
    getEmployeesByTL,
    unassignEmployeeFromTL,
    getSalesUsers,
    uploadEmployeeDocument,
    getEmployeeDocuments,
    verifyEmployeeDocument,
    updateEmployeeShift,
    bulkUpdateShift,
    getLeaveBalance
} = require("../controllers/user.controller");


// ─── Debug ────────────────────────────────────────────────────────────────────
router.get("/debug", debugUsers);


// ─── Me routes (must be before /:id to avoid "me" being treated as an id) ────
router.post("/me/avatar", protect, uploadAvatarMiddleware.single("avatar"), uploadAvatar);
router.put("/me/profile", protect, updateMyProfile);
router.put("/me/password", protect, changeMyPassword);
router.get("/me/government-id", protect, getGovernmentId);
router.put("/me/government-id", protect, updateGovernmentId);
router.get("/me/bank-details", protect, getBankDetails);
router.put("/me/bank-details", protect, updateBankDetails);

router.get("/me/documents", protect, getEmployeeDocuments);
router.post(
    "/me/documents/:type",
    protect,
    uploadDocumentsMiddleware.single("document"),
    uploadEmployeeDocument
);



// ─── Static named routes (must be before /:id) ───────────────────────────────
router.get("/tls", protect, allowRoles("hr", "manager", "superadmin"), getAllTLs);
router.patch("/assign-team", protect, allowRoles("hr", "manager", "superadmin"), assignTeamToTL);
router.patch("/unassign-employee", protect, allowRoles("hr", "manager", "superadmin"), unassignEmployeeFromTL);
router.get("/tl/:tlId/employees", protect, allowRoles("hr", "manager", "superadmin"), getEmployeesByTL);
router.put("/bulk-shift", protect, allowRoles("hr", "manager", "superadmin"), bulkUpdateShift);


// ─── Admin / HR ───────────────────────────────────────────────────────────────
router.post(
    "/create",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    createUserByHR
);

router.put(
    "/update/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateUser
);

router.delete(
    "/delete/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteUser
);

router.put(
    "/update-status/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateUserStatus
);


// ─── Sensitive fields (HR / superadmin only) ──────────────────────────────────
router.get(
    "/:id/government-id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getGovernmentId
);

router.put(
    "/:id/government-id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateGovernmentId
);

router.get(
    "/:id/bank-details",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getBankDetails
);

router.put(
    "/:id/bank-details",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateBankDetails
);


router.get(
    "/:id/documents",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getEmployeeDocuments
);
router.post(
    "/:id/documents/:type",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    uploadDocumentsMiddleware.single("document"),
    uploadEmployeeDocument
);

// verify a specific "other" doc by its _id
router.put(
    "/:id/documents/other/:otherId/verify",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    verifyEmployeeDocument
);

router.put(
    "/:id/documents/:type/verify",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    verifyEmployeeDocument
);


// ─── Shift routes ─────────────────────────────────────────────────────────────
router.put(
    "/:id/shift",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateEmployeeShift
);



router.get(
    "/sales-users",
    protect,
    allowRoles("manager"),
    getSalesUsers
);


// ─── General user routes ──────────────────────────────────────────────────────
router.get(
    "/",
    protect,
    allowRoles("hr", "tl", "manager", "superadmin"),
    getAllUsers
);

router.get(
    "/:id",
    protect,
    allowRoles("hr", "manager", "tl", "superadmin"),
    getSingleUser
);


router.get(
    "/:id/leave-balance",
    protect,
    allowRoles("hr", "manager", "tl", "superadmin"),
    getLeaveBalance
)

module.exports = router;