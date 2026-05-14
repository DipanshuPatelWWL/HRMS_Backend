const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const EmployeeAssetRecord = require("../models/employeeAssetRecord.model");
const User = require("../models/user.model");

// ─── Helper ───────────────────────────────────────────────────────────────────
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const buildHistoryEntry = (action, note, req, status = "") => ({
    action,
    status,
    note,
    changedBy: req.user.name,
    changedById: req.user._id,
    date: new Date(),
});

// ─── @desc    Get logged-in employee's own assets
// ─── @route   GET /api/assets/me
// ─── @access  Private (any authenticated user)
const getMyAssets = asyncHandler(async (req, res) => {
    const record = await EmployeeAssetRecord.findOne({
        employee: req.user._id,
    }).populate(
        "employee",
        "name email department deskNumber employeeId"
    );

    if (!record) {
        return res.status(200).json({
            success: true,
            data: { assets: [], deskNumber: "", systemPassword: "" },
        });
    }

    res.status(200).json({
        success: true,
        data: {
            employee: record.employee,
            assets: record.assets,
            deskNumber: record.deskNumber,
            systemPassword: record.systemPassword,
        },
    });
});

// ─── @desc    Get any employee's assets (HR/Admin)
// ─── @route   GET /api/assets/employee/:employeeId
// ─── @access  Private — hr, manager, admin
const getEmployeeAssets = asyncHandler(async (req, res) => {
    const { employeeId } = req.params;

    const employeeUser = await User.findOne({
        employeeId: employeeId,
    });

    if (!employeeUser) {
        res.status(404);
        throw new Error("Employee not found");
    }

    const record = await EmployeeAssetRecord.findOne({
        employee: employeeUser._id,
    }).populate(
        "employee",
        "name email department position employeeId deskNumber"
    );

    if (!record) {
        return res.status(200).json({
            success: true,
            employee: employeeUser,
            assets: [],
            deskNumber: "",
            systemPassword: "",
        });
    }

    res.status(200).json({
        success: true,
        employee: record.employee,
        assets: record.assets,
        deskNumber: record.deskNumber,
        systemPassword: record.systemPassword,
    });
});

// ─── @desc    Add a new asset to an employee
// ─── @route   POST /api/assets/employee/:employeeId
// ─── @access  Private — hr, manager, admin
const addAsset = asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const {
        assetType,
        name,
        barcode,
        vendor,
        purchaseDate,
        cost,
        warrantyExpiry,
        condition,
    } = req.body;

    if (!isValidObjectId(employeeId)) {
        res.status(400);
        throw new Error("Invalid employee ID");
    }

    // Required field validation
    if (!assetType || !name || !barcode) {
        res.status(400);
        throw new Error("assetType and barcode are required");
    }

    // Find or create the employee asset record
    let record = await EmployeeAssetRecord.findOne({ employee: employeeId });

    if (!record) {
        record = new EmployeeAssetRecord({ employee: employeeId, assets: [] });
    }

    // Duplicate barcode check within the same employee record
    const barcodeExists = record.assets.some((a) => a.barcode === barcode);
    if (barcodeExists) {
        res.status(409);
        throw new Error(`Barcode '${barcode}' is already assigned to this employee`);
    }

    const newAsset = {
        assetType,
        name,
        barcode,

        vendor: vendor || "",

        purchaseDate: purchaseDate || null,

        assignedDate: new Date(),

        cost: cost || 0,

        warrantyExpiry: warrantyExpiry || null,

        condition: condition || "Good",
        history: [
            buildHistoryEntry(
                "assigned",
                `Asset assigned to employee`,
                req,
                condition || "Good"
            ),
        ],
    };

    record.assets.push(newAsset);
    await record.save();

    const addedAsset = record.assets[record.assets.length - 1];

    res.status(201).json({
        success: true,
        message: "Asset added successfully",
        asset: addedAsset,
    });
});

// ─── @desc    Update asset condition
// ─── @route   PATCH /api/assets/:assetId/condition
// ─── @access  Private — hr, manager, admin
const updateAssetCondition = asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const { condition, note } = req.body;

    const validConditions = [
        "New",
        "Good",
        "Fair",
        "Damaged",
        "Replaced",
        "Retired",
    ];
    if (!condition || !validConditions.includes(condition)) {
        res.status(400);
        throw new Error(`condition must be one of: ${validConditions.join(", ")}`);
    }

    const record = await EmployeeAssetRecord.findOne({ "assets._id": assetId });

    if (!record) {
        res.status(404);
        throw new Error("Asset not found");
    }

    const asset = record.assets.id(assetId);
    const prevCondition = asset.condition;

    asset.condition = condition;
    if (condition === "Retired") asset.isActive = false;

    asset.history.push(
        buildHistoryEntry(
            "condition_updated",
            note || `Condition changed from ${prevCondition} to ${condition}`,
            req,
            condition
        )
    );

    await record.save();

    res.status(200).json({
        success: true,
        message: "Asset condition updated",
        data: asset,
    });
});

// ─── @desc    Upload asset photo
// ─── @route   PATCH /api/assets/:assetId/photo
// ─── @access  Private — hr, manager, admin
const uploadAssetPhoto = asyncHandler(async (req, res) => {
    const { assetId } = req.params;

    if (!req.file) {
        res.status(400);
        throw new Error("No file uploaded");
    }

    const record = await EmployeeAssetRecord.findOne({ "assets._id": assetId });

    if (!record) {
        res.status(404);
        throw new Error("Asset not found");
    }

    const asset = record.assets.id(assetId);

    // Cloudinary returns secure_url; local multer returns filename
    asset.photoUrl =
        req.file.path ||
        `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    asset.history.push(
        buildHistoryEntry("photo_uploaded", "Asset photo updated", req)
    );

    await record.save();

    res.status(200).json({
        success: true,
        message: "Photo uploaded successfully",
        data: { photoUrl: asset.photoUrl },
    });
});

// ─── @desc    Update desk number
// ─── @route   PATCH /api/assets/employee/:employeeId/desk
// ─── @access  Private — hr, manager, admin
const updateDeskNumber = asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const { deskNumber } = req.body;

    if (!isValidObjectId(employeeId)) {
        res.status(400);
        throw new Error("Invalid employee ID");
    }

    if (!deskNumber && deskNumber !== "") {
        res.status(400);
        throw new Error("deskNumber is required");
    }

    let record = await EmployeeAssetRecord.findOne({ employee: employeeId });

    if (!record) {
        record = new EmployeeAssetRecord({ employee: employeeId, assets: [] });
    }

    record.deskNumber = deskNumber;
    await record.save();

    res.status(200).json({
        success: true,
        message: "Desk number updated",
        data: { deskNumber: record.deskNumber },
    });
});

// ─── @desc    Update system password
// ─── @route   PATCH /api/assets/employee/:employeeId/password
// ─── @access  Private — hr, manager, admin
const updateSystemPassword = asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const { systemPassword } = req.body;

    if (!isValidObjectId(employeeId)) {
        res.status(400);
        throw new Error("Invalid employee ID");
    }

    if (!systemPassword) {
        res.status(400);
        throw new Error("systemPassword is required");
    }

    let record = await EmployeeAssetRecord.findOne({ employee: employeeId });

    if (!record) {
        record = new EmployeeAssetRecord({ employee: employeeId, assets: [] });
    }

    // TODO: hash with bcrypt before saving in production
    record.systemPassword = systemPassword;
    await record.save();

    res.status(200).json({
        success: true,
        message: "System password updated",
    });
});

// ─── @desc    Retire (soft delete) an asset
// ─── @route   PATCH /api/assets/:assetId/retire
// ─── @access  Private — hr, manager, admin
const retireAsset = asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const { note } = req.body;

    const record = await EmployeeAssetRecord.findOne({ "assets._id": assetId });

    if (!record) {
        res.status(404);
        throw new Error("Asset not found");
    }

    const asset = record.assets.id(assetId);

    asset.condition = "Retired";
    asset.isActive = false;

    asset.history.push(
        buildHistoryEntry(
            "retired",
            note || "Asset retired",
            req,
            "Retired"
        )
    );

    await record.save();

    res.status(200).json({
        success: true,
        message: "Asset retired successfully",
        data: asset,
    });
});

// ─── @desc    Get single asset's full history
// ─── @route   GET /api/assets/:assetId/history
// ─── @access  Private — hr, manager, admin OR owner
const getAssetHistory = asyncHandler(async (req, res) => {
    const { assetId } = req.params;

    const record = await EmployeeAssetRecord.findOne({ "assets._id": assetId });

    if (!record) {
        res.status(404);
        throw new Error("Asset not found");
    }

    // Employees can only view their own asset history
    const isOwner = record.employee.toString() === req.user._id.toString();
    const isPrivileged = ["hr", "manager", "admin"].includes(req.user.role);

    if (!isOwner && !isPrivileged) {
        res.status(403);
        throw new Error("Access denied");
    }

    const asset = record.assets.id(assetId);

    res.status(200).json({
        success: true,
        data: asset.history,
    });
});

module.exports = {
    getMyAssets,
    getEmployeeAssets,
    addAsset,
    updateAssetCondition,
    uploadAssetPhoto,
    updateDeskNumber,
    updateSystemPassword,
    retireAsset,
    getAssetHistory,
};