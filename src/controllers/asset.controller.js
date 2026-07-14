const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const EmployeeAssetRecord = require("../models/employeeAssetRecord.model");
const User = require("../models/user.model");
const Tesseract = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

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
    }).populate("employee", "name email department deskNumber employeeId");

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

    const employeeUser = await User.findOne({ employeeId });

    if (!employeeUser) {
        res.status(404);
        throw new Error("Employee not found");
    }

    const record = await EmployeeAssetRecord.findOne({
        employee: employeeUser._id,
    }).populate("employee", "name email department position employeeId deskNumber");

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
    const { assetType, name, barcode, vendor, purchaseDate, cost, warrantyExpiry, condition } = req.body;

    if (!isValidObjectId(employeeId)) {
        res.status(400);
        throw new Error("Invalid employee ID");
    }

    if (!assetType || !name || !barcode) {
        res.status(400);
        throw new Error("assetType and barcode are required");
    }

    let record = await EmployeeAssetRecord.findOne({ employee: employeeId });
    if (!record) {
        record = new EmployeeAssetRecord({ employee: employeeId, assets: [] });
    }

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
        history: [buildHistoryEntry("assigned", "Asset assigned to employee", req, condition || "Good")],
    };

    record.assets.push(newAsset);
    await record.save();

    res.status(201).json({
        success: true,
        message: "Asset added successfully",
        asset: record.assets[record.assets.length - 1],
    });
});

// ─── @desc    Update asset condition
// ─── @route   PATCH /api/assets/:assetId/condition
// ─── @access  Private — hr, manager, admin
const updateAssetCondition = asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const { condition, note } = req.body;

    const validConditions = ["New", "Good", "Fair", "Damaged", "Replaced", "Retired"];
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

    res.status(200).json({ success: true, message: "Asset condition updated", data: asset });
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
    asset.photoUrl =
        req.file.path ||
        `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    asset.history.push(buildHistoryEntry("photo_uploaded", "Asset photo updated", req));
    await record.save();

    res.status(200).json({ success: true, message: "Photo uploaded successfully", data: { photoUrl: asset.photoUrl } });
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

    res.status(200).json({ success: true, message: "Desk number updated", data: { deskNumber: record.deskNumber } });
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

    // Hash with bcrypt before saving in production
    const salt = await bcrypt.genSalt(10);
    record.systemPassword = await bcrypt.hash(systemPassword, salt);
    await record.save();

    res.status(200).json({ success: true, message: "System password updated" });
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

    asset.history.push(buildHistoryEntry("retired", note || "Asset retired", req, "Retired"));
    await record.save();

    res.status(200).json({ success: true, message: "Asset retired successfully", data: asset });
});


const returnAsset = asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const { note } = req.body;

    const record = await EmployeeAssetRecord.findOne({ "assets._id": assetId });
    if (!record) {
        res.status(404);
        throw new Error("Asset not found");
    }

    const isOwner = record.employee.toString() === req.user._id.toString();
    if (!isOwner) {
        res.status(403);
        throw new Error("Access denied");
    }

    const asset = record.assets.id(assetId);

    if (asset.returnDate || asset.isActive === false) {
        res.status(400);
        throw new Error("This asset has already been returned");
    }

    const returnedAt = new Date(); // server-side timestamp, not client-supplied

    asset.isActive = false;
    asset.returnDate = returnedAt;

    asset.history.push(
        buildHistoryEntry("returned", note || "Asset returned by employee", req, asset.condition)
    );

    await record.save();

    res.status(200).json({
        success: true,
        message: "Asset returned successfully",
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

    const isOwner = record.employee.toString() === req.user._id.toString();
    const isPrivileged = ["hr", "manager", "admin"].includes(req.user.role);

    if (!isOwner && !isPrivileged) {
        res.status(403);
        throw new Error("Access denied");
    }

    const asset = record.assets.id(assetId);
    res.status(200).json({ success: true, data: asset.history });
});

// ─── @desc    Scan barcode from uploaded image
// ─── @route   POST /api/assets/scan
// ─── @access  Private — hr, manager, admin
const scanAssetBarcode = asyncHandler(async (req, res) => {
    if (!req.file) {
        res.status(400);
        throw new Error("No image uploaded");
    }

    // ─── OCR Cleaners ──────────────────────────────────────────────────────────

    // Safe for ALL brands — only strips non-alphanumeric, no substitutions
    const fixOcrGeneric = (str) =>
        str.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9\-]/g, "");

    // Dell-specific character corrections
    const fixOcrDell = (str) =>
        fixOcrGeneric(str)
            .replace(/CH-/g, "CN-")
            .replace(/2E-/g, "CN-")
            .replace(/5E-/g, "CN-")
            .replace(/O/g, "0")
            .replace(/(?<=CN-0)B/g, "5")
            .replace(/(?<=CN-0)S/g, "5")
            .replace(/NTBR/g, "NT8R")
            .replace(/NTSR/g, "NT8R")
            .replace(/(?<=[0-9])B/g, "8")
            .replace(/B(?=[0-9])/g, "8")
            .replace(/(?<=46)[4]/g, "J")
            .replace(/L(?=[^A-Z0-9]|$)/g, "I")
            .replace(/-040L/g, "-040I");

    // Zebronics-specific corrections for ZBJxxFVxxxxx style codes
    const fixOcrZebronics = (str) => {
        let s = fixOcrGeneric(str);
        s = s
            .replace(/^S([A-Z0-9])/, "Z$1")
            .replace(/^(Z)H/, "$1B")
            .replace(/^(ZB)[1I]/, "$1J")
            .replace(/^(ZBJ)[ON]/, "$10")
            .replace(/^(ZBJ0)[I1L]/, "$11")
            .replace(/^(ZBJ01)[SP]/, "$1F")
            .replace(/^(ZBJ01F)[UY8]/, "$1V")
            .replace(/N(?=[0-9])/g, "")
            .replace(/(?<=[A-Z]{3,})[N]{1,2}(?=[0-9])/, "");
        return s;
    };

    // ─── Brand Patterns ────────────────────────────────────────────────────────

    const BARCODE_PATTERNS = [
        // Dell:       CN-0ABC12-PRC00-D5F-04KL
        { brand: "Dell", regex: /CN-[A-Z0-9]{4,8}-PRC[A-Z0-9]{2,4}(?:-[A-Z0-9]{2,5}){0,3}/ },
        // HP:         CC388A, Q5949A
        { brand: "HP", regex: /[A-Z]{1,2}[A-Z0-9]{3,5}[A-Z](?:#[A-Z0-9]{3})?/ },
        // Zebronics:  ZBJ01FV29661
        { brand: "Zebronics", regex: /Z[A-Z]{1,3}[0-9]{1,3}[A-Z]{1,3}[0-9]{4,8}/ },
        // Long serials: XTFT185VC11032400680E (UPS, monitors, devices)
        { brand: "Serial", regex: /[A-Z]{2,4}[0-9]{2,4}[A-Z]{1,3}[0-9]{6,12}[A-Z]?/ },
        // Generic brand codes: APC1234XYZ, TVS12AB3456
        { brand: "Generic", regex: /[A-Z]{2,4}[0-9]{1,4}[A-Z]{1,3}[0-9]{3,8}/ },
        // Lenovo FRU: 04X1234
        { brand: "Lenovo", regex: /0[0-9][A-Z][0-9]{4,6}/ },
        // Samsung:    UN55TU8000FXZA
        { brand: "Samsung", regex: /[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]{2,4}/ },
        // Apple:      C02XL1HAJGH5
        { brand: "Apple", regex: /[A-Z][0-9]{2}[A-Z]{2}[A-Z0-9]{6}/ },
        // Fallback
        { brand: "Unknown", regex: /[A-Z0-9]{6,24}/ },
    ];

    // ─── Token Scorer ──────────────────────────────────────────────────────────

    // Score a candidate token — higher = more likely a real barcode
    const scoreCandidate = (token) => {
        let score = 0;
        if (token.length >= 8) score += 2;
        if (token.length >= 12) score += 2;
        if (token.length >= 16) score += 1;
        const hasLetters = /[A-Z]/.test(token);
        const hasDigits = /[0-9]/.test(token);
        if (hasLetters && hasDigits) score += 3;  // mixed = good barcode
        if (/^[A-Z]+$/.test(token)) score -= 3;   // all letters = likely a word
        if (token.length < 6) score -= 5;
        return score;
    };

    // Split raw OCR into individual word tokens, match each against patterns
    const tryMatchBarcode = (raw) => {
        const words = raw
            .toUpperCase()
            .replace(/[^A-Z0-9\-\n\r\t ]/g, " ")
            .split(/[\s]+/)
            .filter((w) => w.length >= 5);

        let best = null;
        let bestScore = -Infinity;

        for (const word of words) {
            for (const { brand, regex } of BARCODE_PATTERNS) {
                const m = word.match(regex);
                if (!m) continue;
                const score = scoreCandidate(m[0]);
                if (score > bestScore) {
                    bestScore = score;
                    best = { code: m[0], brand };
                }
            }
        }

        return bestScore >= 2 ? best : null;
    };

    // ─── Preprocessing ─────────────────────────────────────────────────────────

    const preprocessedPath = path.join(
        path.dirname(req.file.path),
        `${path.basename(req.file.path)}_pre.jpg`
    );

    try {
        const meta = await sharp(req.file.path).metadata();
        const scaleFactor = meta.width < 1000 ? 3 : meta.width < 2000 ? 2 : 1;

        await sharp(req.file.path)
            .rotate()                                     // honour EXIF orientation
            .resize({
                width: meta.width * scaleFactor,
                height: meta.height * scaleFactor,
                kernel: sharp.kernel.lanczos3,
            })
            .grayscale()
            .normalise()
            .sharpen({ sigma: 2, m1: 0, m2: 3 })
            .threshold(128)                               // binarize to pure B&W
            .toFile(preprocessedPath);
    } catch (e) {
        console.warn("Preprocessing failed, using original:", e.message);
        fs.copyFileSync(req.file.path, preprocessedPath);
    }

    const sourceImage = fs.existsSync(preprocessedPath)
        ? preprocessedPath
        : req.file.path;

    // ─── OCR Loop ──────────────────────────────────────────────────────────────

    // 90° first — phone portrait + sideways label is the most common real case
    const ROTATIONS = [90, 270, 0, 180];
    // PSM 6 first — labels have multiple text lines so block mode catches all
    const PSM_MODES = ["6", "7", "13", "8"];

    let bestResult = null;
    let lastText = "";

    const worker = await Tesseract.createWorker("eng", 1, {
        logger: () => { },
        errorHandler: () => { },
    });

    for (const angle of ROTATIONS) {
        if (bestResult) break;

        const rotatedPath = path.join(
            path.dirname(req.file.path),
            `${path.basename(req.file.path)}_rot${angle}.jpg`
        );

        try {
            await sharp(sourceImage).rotate(angle).toFile(rotatedPath);

            for (const psm of PSM_MODES) {
                if (bestResult) break;

                await worker.setParameters({
                    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
                    tessedit_pageseg_mode: psm,
                    preserve_interword_spaces: "0",
                });

                const { data } = await worker.recognize(rotatedPath);
                const raw = data.text || "";
                if (!raw.trim()) continue;

                // Split into lines — try each line individually first
                const lines = raw.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
                const genericCleaned = fixOcrGeneric(raw);
                lastText = genericCleaned || lastText;

                let found = null;

                for (const line of lines) {
                    found =
                        tryMatchBarcode(fixOcrDell(line)) ||
                        tryMatchBarcode(fixOcrZebronics(line)) ||
                        tryMatchBarcode(line);
                    if (found) break;
                }

                // Fallback: try full raw text if no line matched
                if (!found) {
                    found =
                        tryMatchBarcode(fixOcrDell(raw)) ||
                        tryMatchBarcode(fixOcrZebronics(raw)) ||
                        tryMatchBarcode(raw);
                }

                if (!found) continue;

                // Dell: strip trailing garbage segments
                if (found.brand === "Dell") {
                    const segments = found.code.split("-");
                    while (segments.length > 3) {
                        const last = segments[segments.length - 1];
                        const digits = (last.match(/\d/g) || []).length;
                        const letters = (last.match(/[A-Z]/g) || []).length;
                        if (last.length < 3 || last.length > 5 || digits <= letters) {
                            segments.pop();
                        } else break;
                    }
                    found.code = segments.join("-");
                    if (found.code.split("-").length < 3) continue;
                }

                bestResult = { ...found, text: genericCleaned };
            }
        } catch (err) {
            console.error(`Rotation ${angle} failed:`, err.message);
        } finally {
            if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
        }
    }

    // ─── Cleanup ───────────────────────────────────────────────────────────────

    await worker.terminate();
    if (fs.existsSync(preprocessedPath)) fs.unlinkSync(preprocessedPath);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
        success: true,
        code: bestResult?.code ?? "",
        brand: bestResult?.brand ?? "Unknown",
        fullText: bestResult?.text ?? lastText,
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
    returnAsset,
    getAssetHistory,
    scanAssetBarcode,
};