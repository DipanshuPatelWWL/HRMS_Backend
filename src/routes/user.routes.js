const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const upload = require("../middleware/upload.middleware");

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
} = require("../controllers/user.controller");


// ─── Debug ────────────────────────────────────────────────────────────────────
router.get("/debug", debugUsers);


// ─── Me routes (must be before /:id to avoid "me" being treated as an id) ────
router.post("/me/avatar", protect, upload.single("avatar"), uploadAvatar);
router.put("/me/profile", protect, updateMyProfile);
router.put("/me/password", protect, changeMyPassword);
router.get("/me/government-id", protect, getGovernmentId);
router.put("/me/government-id", protect, updateGovernmentId);
router.get("/me/bank-details", protect, getBankDetails);
router.put("/me/bank-details", protect, updateBankDetails);


// ─── Admin / HR ───────────────────────────────────────────────────────────────
router.post(
    "/create",
    protect,
    allowRoles("hr", "superadmin"),
    createUserByHR
);

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

router.put(
    "/update/:id",
    protect,
    allowRoles("hr", "superadmin"),
    updateUser
);

router.delete(
    "/delete/:id",
    protect,
    allowRoles("hr", "superadmin"),
    deleteUser
);

router.put(
    "/update-status/:id",
    protect,
    allowRoles("hr", "superadmin"),
    updateUserStatus
);


// ─── Sensitive fields (HR / superadmin only) ──────────────────────────────────
router.get(
    "/:id/government-id",
    protect,
    allowRoles("hr", "superadmin"),
    getGovernmentId
);

router.put(
    "/:id/government-id",
    protect,
    allowRoles("hr", "superadmin"),
    updateGovernmentId
);

router.get(
    "/:id/bank-details",
    protect,
    allowRoles("hr", "superadmin"),
    getBankDetails
);

router.put(
    "/:id/bank-details",
    protect,
    allowRoles("hr", "superadmin"),
    updateBankDetails
);


module.exports = router;