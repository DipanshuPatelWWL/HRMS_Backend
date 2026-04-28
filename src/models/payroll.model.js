const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        //  Payroll period
        month: {
            type: Number,
            required: true,
        },

        year: {
            type: Number,
            required: true,
        },

        baseSalary: {
            type: Number,
            required: true,
        },

        bonus: {
            type: Number,
            default: 0,
        },

        deductions: {
            type: Number,
            default: 0,
        },

        netSalary: {
            type: Number,
            required: true,
        },

        status: {
            type: String,
            enum: ["pending", "processed", "paid"],
            default: "pending",
        },

        payslipUrl: {
            type: String,
            default: "",
        },
    },
    {
        timestamps: true,
    }
);

payrollSchema.index(
    { user: 1, month: 1, year: 1 },
    { unique: true }
);

module.exports = mongoose.model("Payroll", payrollSchema);