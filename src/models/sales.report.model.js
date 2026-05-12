// const mongoose = require("mongoose");

// const salesReportSchema = new mongoose.Schema(
//     {
//         date: {
//             type: Date,
//             default: Date.now,
//         },

//         marketer: String,
//         client_name: String,
//         client_email: String,
//         services: String,
//         country: String,
//         message: String,

//         status: {
//             type: String,
//             enum: [
//                 "draft",
//                 "sent_to_manager",
//                 "approved",
//                 "rejected"
//             ],
//             default: "draft",
//         },

//         // who created lead (sales employee)
//         user: {
//             type: mongoose.Schema.Types.ObjectId,
//             ref: "User",
//             required: true,
//         },

//         // optional: which manager approved/rejected
//         action_by: {
//             type: mongoose.Schema.Types.ObjectId,
//             ref: "User",
//         },

//         reject_reason: {
//             type: String,
//             default: "",
//         },
//         action_date: Date,

//         forwarded_to: {
//             type: mongoose.Schema.Types.ObjectId,
//             ref: "User",
//         },

//         forwarded_by: {
//             type: mongoose.Schema.Types.ObjectId,
//             ref: "User",
//         },

//         forward_note: {
//             type: String,
//             default: "",
//         },

//         forwarded_at: Date,
//     },
//     { timestamps: true }
// );

// module.exports = mongoose.model("SalesReport", salesReportSchema);















const mongoose = require("mongoose");

const salesLeadSchema = new mongoose.Schema(
    {
        // ─────────────────────────────
        // BASIC LEAD INFO
        // ─────────────────────────────

        date: {
            type: Date,
            default: Date.now,
        },

        marketer: {
            type: String,
            trim: true,
        },

        client_name: {
            type: String,
            required: true,
            trim: true,
        },

        client_email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },

        client_phone: {
            type: String,
            default: "",
        },

        company_name: {
            type: String,
            default: "",
        },

        services: {
            type: String,
            required: true,
        },

        country: {
            type: String,
            default: "",
        },

        budget: {
            type: Number,
            default: 0,
        },

        message: {
            type: String,
            default: "",
        },

        // ─────────────────────────────
        // LEAD SOURCE
        // ─────────────────────────────

        lead_source: {
            type: String,
            enum: [
                "website",
                "facebook",
                "linkedin",
                "instagram",
                "whatsapp",
                "referral",
                "cold_call",
                "email",
                "other",
            ],
            default: "website",
        },

        // ─────────────────────────────
        // PRIORITY
        // ─────────────────────────────

        priority: {
            type: String,
            enum: ["low", "medium", "high", "urgent"],
            default: "medium",
        },

        // ─────────────────────────────
        // REVIEW FLOW (MANAGER SIDE)
        // ─────────────────────────────

        review_status: {
            type: String,
            enum: [
                "draft",
                "pending_review",
                "approved",
                "rejected",
            ],
            default: "draft",
        },

        approved_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        rejected_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        reject_reason: {
            type: String,
            default: "",
        },

        review_date: Date,

        // ─────────────────────────────
        // SALES PIPELINE STAGE
        // ─────────────────────────────

        lead_stage: {
            type: String,
            enum: [
                "new",
                "assigned",
                "contacted",
                "meeting_scheduled",
                "proposal_sent",
                "negotiation",
                "won",
                "lost",
                "on_hold",
            ],
            default: "new",
        },

        lost_reason: {
            type: String,
            default: "",
        },

        // ─────────────────────────────
        // OWNERSHIP
        // ─────────────────────────────

        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        assigned_to: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        assigned_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        assignment_note: {
            type: String,
            default: "",
        },

        assigned_at: Date,

        // ─────────────────────────────
        // FOLLOW UPS
        // ─────────────────────────────

        next_follow_up: Date,

        last_follow_up: Date,

        follow_up_count: {
            type: Number,
            default: 0,
        },

        // ─────────────────────────────
        // INTERNAL REMARKS
        // ─────────────────────────────

        remarks: [
            {
                message: {
                    type: String,
                    required: true,
                },

                added_by: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },

                createdAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],

        // ─────────────────────────────
        // ACTIVITY TIMELINE
        // ─────────────────────────────

        timeline: [
            {
                action: {
                    type: String,
                },

                message: {
                    type: String,
                },

                by: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },

                createdAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],

        // ─────────────────────────────
        // ATTACHMENTS
        // ─────────────────────────────

        attachments: [
            {
                file_name: String,
                file_url: String,
                uploaded_by: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },
                uploaded_at: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],

        // ─────────────────────────────
        // SOFT DELETE
        // ─────────────────────────────

        is_deleted: {
            type: Boolean,
            default: false,
        },

        deleted_at: Date,
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("SalesLead", salesLeadSchema);