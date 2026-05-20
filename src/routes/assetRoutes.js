const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const { uploadAssetsImage: upload } = require("../middleware/upload.middleware");
const {
    getMyAssets,
    getEmployeeAssets,
    addAsset,
    updateAssetCondition,
    uploadAssetPhoto,
    updateDeskNumber,
    updateSystemPassword,
    retireAsset,
    getAssetHistory,
    scanAssetBarcode,
} = require("../controllers/asset.controller");

const HR_ROLES = ["hr", "manager"];

// ─── Employee self-view ───────────────────────────────────────────────────────
// GET /api/assets/me
router.get("/me", protect, getMyAssets);

// ─── OCR Scan ─────────────────────────────────────────────────────────────────
// POST /api/assets/scan
router.post(
    "/scan",
    protect,
    allowRoles(...HR_ROLES),
    upload.single("image"),   // reuses your existing uploadAssetsImage middleware
    scanAssetBarcode
);

// ─── HR / Admin routes ────────────────────────────────────────────────────────
// GET  /api/assets/employee/:employeeId         → fetch employee assets
// POST /api/assets/employee/:employeeId         → add new asset
router
    .route("/employee/:employeeId")
    .get(protect, allowRoles(...HR_ROLES), getEmployeeAssets)
    .post(protect, allowRoles(...HR_ROLES), addAsset);

// PATCH /api/assets/employee/:employeeId/desk   → update desk number
router.patch(
    "/employee/:employeeId/desk",
    protect,
    allowRoles(...HR_ROLES),
    updateDeskNumber
);

// PATCH /api/assets/employee/:employeeId/password → update system password
router.patch(
    "/employee/:employeeId/password",
    protect,
    allowRoles(...HR_ROLES),
    updateSystemPassword
);

// ─── Per-asset routes ─────────────────────────────────────────────────────────
// PATCH /api/assets/:assetId/condition  → update condition
router.patch(
    "/:assetId/condition",
    protect,
    allowRoles(...HR_ROLES),
    updateAssetCondition
);

// PATCH /api/assets/:assetId/photo      → upload photo
router.patch(
    "/:assetId/photo",
    protect,
    allowRoles(...HR_ROLES),
    upload.single("photo"),
    uploadAssetPhoto
);

// PATCH /api/assets/:assetId/retire     → retire asset
router.patch(
    "/:assetId/retire",
    protect,
    allowRoles(...HR_ROLES),
    retireAsset
);

// GET  /api/assets/:assetId/history     → view history (hr or owner)
router.get("/:assetId/history", protect, getAssetHistory);

module.exports = router;