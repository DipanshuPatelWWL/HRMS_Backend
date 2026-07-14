const mongoose = require("mongoose");

// ─── History Sub-Schema ───────────────────────────────────────────────────────
const historySchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            enum: [
                "assigned",
                "condition_updated",
                "photo_uploaded",
                "replaced",
                "retired",
                "returned",
                "desk_updated",
                "password_updated",
            ],
        },

        status: {
            type: String,
            default: "",
        },

        note: {
            type: String,
            default: "",
            trim: true,
        },

        changedBy: {
            type: String,
            required: true,
            trim: true,
        },

        changedById: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        date: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: true }
);

// ─── Asset Sub-Schema ─────────────────────────────────────────────────────────
const assetSchema = new mongoose.Schema(
    {
        assetType: {
            type: String,
            required: true,
            enum: [
                "Laptop",
                "Mouse",
                "Keyboard",
                "Monitor",
                "Headset",
                "Other",
            ],
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        barcode: {
            type: String,
            required: true,
            trim: true,
        },

        assignedDate: {
            type: Date,
            default: Date.now,
        },

        condition: {
            type: String,
            required: true,
            enum: [
                "New",
                "Good",
                "Fair",
                "Damaged",
                "Replaced",
                "Retired",
            ],
            default: "Good",
        },

        photoUrl: {
            type: String,
            default: "",
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        returnDate: {
            type: Date,
            default: null,
        },

        history: [historySchema],
    },
    { timestamps: true }
);

// ─── Main Employee Asset Record Schema ───────────────────────────────────────
const employeeAssetRecordSchema = new mongoose.Schema(
    {
        employee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        deskNumber: {
            type: String,
            default: "",
            trim: true,
        },

        systemPassword: {
            type: String,
            default: "",
        },

        assets: [assetSchema],
    },
    { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// One asset record per employee
employeeAssetRecordSchema.index(
    { employee: 1 },
    { unique: true }
);

// Faster barcode searches
assetSchema.index({ barcode: 1 });

// ─── Export Model ────────────────────────────────────────────────────────────
module.exports = mongoose.model(
    "EmployeeAssetRecord",
    employeeAssetRecordSchema
);