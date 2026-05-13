const mongoose = require("mongoose");

const replySchema = new mongoose.Schema(
    {
        message: {
            type: String,
            required: true,
            trim: true,
        },
        sentBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        isStaff: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

const ticketSchema = new mongoose.Schema(
    {
        ticketId: {
            type: String,
            unique: true,
        },

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },

        description: {
            type: String,
            required: [true, "Description is required"],
            trim: true,
        },

        category: {
            type: String,
            enum: ["it", "hr", "admin", "payroll", "attendance", "other"],
            default: "other",
        },

        priority: {
            type: String,
            enum: ["low", "medium", "high", "critical"],
            default: "medium",
        },

        status: {
            type: String,
            enum: ["open", "in-progress", "resolved", "closed"],
            default: "open",
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        attachments: [
            {
                url: { type: String },
                originalName: { type: String },
                mimetype: { type: String },
            },
        ],

        replies: [replySchema],

        resolvedAt: {
            type: Date,
            default: null,
        },

        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        closedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Auto-generate ticket ID like TKT-0001
ticketSchema.pre("save", async function () {
    if (this.isNew) {
        const count = await mongoose.model("Ticket").countDocuments();
        this.ticketId = `TKT-${String(count + 1).padStart(4, "0")}`;
    }
});

module.exports = mongoose.model("Ticket", ticketSchema);