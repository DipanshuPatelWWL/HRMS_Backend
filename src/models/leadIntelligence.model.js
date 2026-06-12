const mongoose = require("mongoose");

// ─── Timeline Entry ───────────────────────────────────────────────────────────
const timelineEntrySchema = new mongoose.Schema(
    {
        action: { type: String, required: true },
        performedBy: { type: String, default: "system" },
        note: { type: String, default: "" },
    },
    { timestamps: true }
);

// ─── Opportunity ──────────────────────────────────────────────────────────────
const opportunitySchema = new mongoose.Schema({
    type: { type: String },        // e.g. "Needs HRMS", "Outdated website"
    description: { type: String },
    priority: {
        type: String,
        enum: ["high", "medium", "low"],
        default: "medium",
    },
});

// ─── Lead Intelligence Schema ─────────────────────────────────────────────────
// This is a SEPARATE collection that links to your existing sales.report via
// salesReportId. If you want to merge into sales.report.model.js instead,
// see the comment at the bottom of this file.
const leadIntelligenceSchema = new mongoose.Schema(
    {
        // Link to existing SalesReport document
        salesReportId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalesReport",
            default: null,
        },

        // Company info (populated by Python scraper on Day 3)
        companyName: { type: String, required: true, trim: true },
        clientEmail: { type: String, trim: true, lowercase: true, default: "" },
        clientPhone: { type: String, default: "" },
        website: { type: String, default: "" },
        linkedin: { type: String, default: "" },
        country: { type: String, default: "" },
        service: { type: String, default: "" },

        // Who generated / owns this lead
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        generatedBy: { type: String, default: "manual" }, // "manual" | "python-scraper"
        keyword: { type: String, default: "" },           // search keyword used to find this lead

        // ── Score (Day 8) ──────────────────────────────────────────────────────────
        score: { type: Number, default: 0, min: 0, max: 100 },
        scoreBreakdown: {
            companySize: { type: Number, default: 0 },
            linkedinActive: { type: Number, default: 0 },
            websiteQuality: { type: Number, default: 0 },
            hiringSignals: { type: Number, default: 0 },
            emailFound: { type: Number, default: 0 },
        },
        tag: {
            type: String,
            enum: ["hot", "warm", "cold", "unscored"],
            default: "unscored",
        },

        // ── Genuineness (spam/trust check) ────────────────────────────────────────
        genuinenessScore: { type: Number, default: null },
        genuinenessLabel: {
            type: String,
            enum: ["genuine", "unverified", "suspicious"],
            default: "unverified",
        },
        genuinenessSignals: { type: mongoose.Schema.Types.Mixed, default: {} },

        // ── Lead stage (mirrors your existing sales report stages) ─────────────────
        stage: {
            type: String,
            enum: ["New", "Contacted", "Interested", "Proposal", "Won", "Lost"],
            default: "New",
        },
        priority: {
            type: String,
            enum: ["Low", "Medium", "High"],
            default: "Medium",
        },
        status: {
            type: String,
            enum: ["Draft", "Pending Review", "Approved", "Rejected", "Active", "Completed", "Needs Follow-up"],
            default: "Draft",
        },

        // ── Website analysis (Day 15) ──────────────────────────────────────────────
        websiteAnalysis: {
            techStack: [{ type: String }],
            isMobileResponsive: { type: Boolean, default: null },
            hasContactForm: { type: Boolean, default: null },
            pageSpeedScore: { type: Number, default: null },
            lastAnalyzed: { type: Date, default: null },
            domainAgeYears: { type: Number, default: null },
            domainCreatedYear: { type: Number, default: null },
        },
        opportunities: [opportunitySchema],        // detected gaps → sales talking points

        // ── AI Email (Day 10) ──────────────────────────────────────────────────────
        emailDraft: {
            subject: { type: String, default: "" },
            body: { type: String, default: "" },
            generatedAt: { type: Date, default: null },
            sentAt: { type: Date, default: null },
            status: {
                type: String,
                enum: ["none", "draft", "sent"],
                default: "none",
            },
        },

        // ── Follow-up schedule (Day 12) ────────────────────────────────────────────
        followUpDates: [
            {
                scheduledAt: { type: Date },
                label: { type: String },              // "Day 1", "Day 4", "Day 8", "Day 15"
                completed: { type: Boolean, default: false },
                completedAt: { type: Date, default: null },
            },
        ],
        nextFollowUp: { type: Date, default: null },

        // ── Timeline ───────────────────────────────────────────────────────────────
        timeline: [timelineEntrySchema],

        // ── Notes ──────────────────────────────────────────────────────────────────
        notes: { type: String, default: "" },

        // Soft delete
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
leadIntelligenceSchema.index({ score: -1 });
leadIntelligenceSchema.index({ tag: 1 });
leadIntelligenceSchema.index({ stage: 1 });
leadIntelligenceSchema.index({ assignedTo: 1 });
leadIntelligenceSchema.index({ salesReportId: 1 });
leadIntelligenceSchema.index({ createdAt: -1 });

// ─── Helper: set tag from score ───────────────────────────────────────────────
leadIntelligenceSchema.methods.updateTag = function () {
    if (this.score >= 70) this.tag = "hot";
    else if (this.score >= 40) this.tag = "warm";
    else this.tag = "cold";
};

// ─── Helper: add timeline entry ───────────────────────────────────────────────
leadIntelligenceSchema.methods.addTimeline = function (action, performedBy = "system", note = "") {
    this.timeline.unshift({ action, performedBy, note });
};

module.exports = mongoose.model("LeadIntelligence", leadIntelligenceSchema);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: If you prefer to add intelligence fields directly to your existing
// sales.report.model.js instead of a separate collection, open that file and
// add these fields to the existing schema:
//
//   score:           { type: Number, default: 0 },
//   tag:             { type: String, enum: ["hot","warm","cold","unscored"], default: "unscored" },
//   website:         { type: String, default: "" },
//   linkedin:        { type: String, default: "" },
//   opportunities:   [opportunitySchema],
//   emailDraft:      { subject, body, generatedAt, status },
//   followUpDates:   [...],
//   websiteAnalysis: { techStack, isMobileResponsive, ... },
//   generatedBy:     { type: String, default: "manual" },
//
// Both approaches work. Separate model = cleaner; merged = simpler queries.
// ─────────────────────────────────────────────────────────────────────────────