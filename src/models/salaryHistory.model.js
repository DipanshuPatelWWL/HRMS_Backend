const mongoose = require("mongoose");

const salaryHistorySchema = new mongoose.Schema(
    {
        employee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        monthlySalary: { type: Number, required: true },
        previousSalary: { type: Number, default: 0 },
        incrementAmount: { type: Number, default: 0 },
        incrementPercent: { type: Number, default: 0 },

        // Always normalized to the 1st of a month (IST) — v1 rule, no mid-month increments
        effectiveFrom: { type: Date, required: true, index: true },
        // null = currently active salary
        effectiveTo: { type: Date, default: null, index: true },

        reason: { type: String, default: "", trim: true },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

salaryHistorySchema.index({ employee: 1, effectiveFrom: 1 });
salaryHistorySchema.index({ employee: 1, effectiveTo: 1 });

module.exports = mongoose.model("SalaryHistory", salaryHistorySchema);