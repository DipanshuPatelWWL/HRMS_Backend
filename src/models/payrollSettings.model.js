const mongoose = require("mongoose");

const payrollSettingsSchema = new mongoose.Schema(
    {
        // Internal field to enforce only ONE document
        singletonKey: {
            type: String,
            default: "singleton",
            unique: true,
            required: true
        },
        financialYear: {
            type: String,
            default: "2025-26",
            required: true
        },
        taxRegime: {
            type: String,
            enum: ["old", "new"],
            default: "new"
        },
        pfMode: {
            type: String,
            enum: ["actual", "capped"],
            default: "actual"
        },
        defaultHraType: {
            type: String,
            enum: ["metro", "non-metro", "custom"],
            default: "non-metro"
        },
        professionalTaxState: {
            type: String,
            default: "Uttar Pradesh"
        },
        isGeneratingPayroll: {
            type: Boolean,
            default: false
        },
        lockAcquiredAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("PayrollSettings", payrollSettingsSchema);
