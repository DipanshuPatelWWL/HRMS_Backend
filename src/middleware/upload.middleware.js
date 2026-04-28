const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/avatars/"); // folder banana padega
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `avatar_${req.user._id}_${Date.now()}${ext}`);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
};

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter,
});

module.exports = upload;