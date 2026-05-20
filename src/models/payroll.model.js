const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema(
    {
        employee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // ── Period ──────────────────────────────────
        month: { type: Number, required: true },   // 1–12
        year: { type: Number, required: true },   // e.g. 2025

        // ── Salary Figures ───────────────────────────
        monthlySalary: { type: Number, required: true },
        perDaySalary: { type: Number, required: true },
        halfDaySalary: { type: Number, default: 0 },
        grossEarnings: { type: Number, default: 0 },

        // ── Salary Structure Snapshot (at time of generation) ──
        salaryStructure: {
            basic: { enabled: Boolean, percent: Number, amount: Number },
            hra: { enabled: Boolean, percent: Number, amount: Number },
            specialAllowance: { enabled: Boolean, percent: Number, amount: Number },
            conveyance: { enabled: Boolean, percent: Number, amount: Number },
            otherAllowance: { enabled: Boolean, percent: Number, amount: Number },
        },

        // ── Statutory Deductions Snapshot ────────────
        statutoryDeductions: {
            pf: { enabled: Boolean, percent: Number, amount: Number, label: String, pfNumber: String },
            esi: { enabled: Boolean, percent: Number, amount: Number, label: String, esiNumber: String },
            professionalTax: { enabled: Boolean, fixedAmount: Number, amount: Number, label: String },
        },
        totalStatutoryDeductions: { type: Number, default: 0 },

        // ── Attendance Breakdown ─────────────────────
        presentDays: { type: Number, default: 0 },
        halfDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        paidLeave: { type: Number, default: 0 },
        unpaidLeave: { type: Number, default: 0 },
        holidays: { type: Number, default: 0 },
        weekends: { type: Number, default: 0 },
        totalWorkingDays: { type: Number, default: 0 },
        totalCalendarDays: { type: Number, default: 0 },

        // ── Attendance Deductions ────────────────────
        absentAmt: { type: Number, default: 0 },
        halfDayDeduct: { type: Number, default: 0 },
        unpaidLeaveAmt: { type: Number, default: 0 },

        // ── Earnings / Deductions ────────────────────
        basicEarnings: { type: Number, default: 0 },
        halfDayEarnings: { type: Number, default: 0 },
        overtimePay: { type: Number, default: 0 },
        deductions: { type: Number, default: 0 },  // total attendance deductions
        netSalary: { type: Number, required: true },

        // ── Status ───────────────────────────────────
        status: {
            type: String,
            enum: ["draft", "paid"],
            default: "draft",
        },
        paidAt: { type: Date },
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        remarks: { type: String, default: "" },

        // ── Generation metadata ──────────────────────
        generatedAt: { type: Date, default: Date.now },
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

        // ── Visibility ───────────────────────────────
        // false = only HR/Manager can see; true = employee can see + download
        isReleased: { type: Boolean, default: false },
        releasedAt: { type: Date, default: null },
        releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

// Unique payslip per employee per month/year
payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("Payroll", payrollSchema);