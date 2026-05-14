const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Pass a destination folder — defaults to "uploads/misc/" if not provided
const createUpload = (folder = "uploads/misc/") => {
    // Auto-create the folder if it doesn't exist
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, folder);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const base = path.basename(file.originalname, ext);
            cb(null, `${base}_${Date.now()}${ext}`);
        },
    });

    const fileFilter = (req, file, cb) => {
        // Allow images
        if (file.mimetype.startsWith("image/")) {
            return cb(null, true);
        }

        // Allow PDF
        if (file.mimetype === "application/pdf") {
            return cb(null, true);
        }

        cb(new Error("Only image and PDF files are allowed"), false);
    };

    return multer({
        storage,
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
        fileFilter,
    });
};

// ─────────────────────────────────────────────
// Pre-configured uploaders for each module
// ─────────────────────────────────────────────
const uploadAvatar = createUpload("uploads/avatars/");
const uploadDailyReport = createUpload("uploads/daily-reports/");
const uploadTicket = createUpload("uploads/tickets/");
const uploadAssetsImage = createUpload("uploads/assets/");

module.exports = { uploadAvatar, uploadDailyReport, uploadTicket, uploadAssetsImage };