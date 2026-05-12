const Lead = require("../models/sales.report.model");
const User = require("../models/user.model");
const { sendMail } = require("../services/emailClient");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const isSales = (user) =>
    user?.department?.toLowerCase() === "sales";

const addTimeline = (lead, action, message, userId) => {
    lead.timeline.push({
        action,
        message,
        by: userId,
    });
};

// ─────────────────────────────────────────────
// CREATE LEAD
// ─────────────────────────────────────────────

exports.createLead = async (req, res) => {
    try {

        if (!isSales(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Only Sales department can create leads",
            });
        }

        const lead = await Lead.create({
            ...req.body,

            created_by: req.user._id,

            review_status: "draft",

            lead_stage: "new",

            timeline: [
                {
                    action: "LEAD_CREATED",
                    message: `Lead created by ${req.user.name}`,
                    by: req.user._id,
                },
            ],
        });

        res.status(201).json({
            success: true,
            message: "Lead created successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// UPDATE LEAD
// ─────────────────────────────────────────────

exports.updateLead = async (req, res) => {
    try {

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        // ownership check
        if (lead.created_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own leads",
            });
        }

        // allow edit only in draft
        if (lead.review_status !== "draft") {
            return res.status(400).json({
                success: false,
                message: "Cannot edit after sending to manager",
            });
        }

        Object.assign(lead, req.body);

        addTimeline(
            lead,
            "LEAD_UPDATED",
            `Lead updated by ${req.user.name}`,
            req.user._id
        );

        await lead.save();

        res.status(200).json({
            success: true,
            message: "Lead updated successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// SEND TO MANAGER
// ─────────────────────────────────────────────

exports.sendToManager = async (req, res) => {
    try {

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        // ownership check
        if (lead.created_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "You can only submit your own leads",
            });
        }

        if (lead.review_status !== "draft") {
            return res.status(400).json({
                success: false,
                message: "Lead already submitted",
            });
        }

        lead.review_status = "pending_review";

        addTimeline(
            lead,
            "SENT_TO_MANAGER",
            `Lead submitted to manager by ${req.user.name}`,
            req.user._id
        );

        await lead.save();

        // optional manager email
        sendMail({
            to: process.env.MANAGER_EMAIL,
            subject: "New Lead Submitted",
            html: `
                <h3>New Lead Submitted</h3>

                <p><b>Client:</b> ${lead.client_name}</p>
                <p><b>Email:</b> ${lead.client_email}</p>
                <p><b>Service:</b> ${lead.services}</p>
                <p><b>Country:</b> ${lead.country}</p>
            `,
        }).catch((err) => {
            console.log(err.message);
        });

        res.status(200).json({
            success: true,
            message: "Lead sent to manager successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// MANAGER GET LEADS
// ─────────────────────────────────────────────

exports.getManagerLeads = async (req, res) => {
    try {

        const {
            review_status,
            lead_stage,
            priority,
        } = req.query;

        const filter = {
            is_deleted: false,
        };

        if (review_status) {
            filter.review_status = review_status;
        }

        if (lead_stage) {
            filter.lead_stage = lead_stage;
        }

        if (priority) {
            filter.priority = priority;
        }

        const leads = await Lead.find(filter)
            .populate("created_by", "name email employeeId")
            .populate("assigned_to", "name email employeeId")
            .populate("approved_by", "name email")
            .populate("rejected_by", "name email")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leads.length,
            leads,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// APPROVE / REJECT LEAD
// ─────────────────────────────────────────────

exports.updateLeadReviewStatus = async (req, res) => {
    try {

        const { id } = req.params;
        const { review_status, reject_reason } = req.body;

        if (!["approved", "rejected"].includes(review_status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid review status",
            });
        }

        const lead = await Lead.findById(id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        if (lead.review_status !== "pending_review") {
            return res.status(400).json({
                success: false,
                message: "Lead already reviewed",
            });
        }

        lead.review_status = review_status;
        lead.review_date = new Date();

        // APPROVED
        if (review_status === "approved") {

            lead.approved_by = req.user._id;

            addTimeline(
                lead,
                "LEAD_APPROVED",
                `Lead approved by ${req.user.name}`,
                req.user._id
            );

        }

        // REJECTED
        if (review_status === "rejected") {

            if (!reject_reason) {
                return res.status(400).json({
                    success: false,
                    message: "Reject reason is required",
                });
            }

            lead.rejected_by = req.user._id;
            lead.reject_reason = reject_reason;

            addTimeline(
                lead,
                "LEAD_REJECTED",
                `Lead rejected by ${req.user.name}`,
                req.user._id
            );
        }

        await lead.save();

        res.status(200).json({
            success: true,
            message: `Lead ${review_status} successfully`,
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// ASSIGN LEAD
// ─────────────────────────────────────────────

exports.assignLead = async (req, res) => {
    try {

        const { id } = req.params;

        const {
            userId,
            assignment_note,
        } = req.body;

        const lead = await Lead.findById(id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        if (lead.review_status !== "approved") {
            return res.status(400).json({
                success: false,
                message: "Only approved leads can be assigned",
            });
        }

        const employee = await User.findById(userId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found",
            });
        }

        if (lead.assigned_to) {
            return res.status(400).json({
                success: false,
                message: "Lead already assigned",
            });
        }

        lead.assigned_to = employee._id;
        lead.assigned_by = req.user._id;
        lead.assignment_note = assignment_note || "";
        lead.assigned_at = new Date();

        lead.lead_stage = "assigned";

        addTimeline(
            lead,
            "LEAD_ASSIGNED",
            `Lead assigned to ${employee.name}`,
            req.user._id
        );

        await lead.save();

        const populatedLead = await Lead.findById(lead._id)
            .populate('assigned_to', 'name email employeeId');

        res.status(200).json({
            success: true,
            message: `Lead assigned to ${employee.name}`,
            lead: populatedLead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// GET ASSIGNED LEADS
// ─────────────────────────────────────────────

exports.getAssignedLeads = async (req, res) => {
    try {

        const leads = await Lead.find({
            assigned_to: req.user._id,
            is_deleted: false,
        })
            .populate("created_by", "name email")
            .populate("assigned_by", "name email")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leads.length,
            leads,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// UPDATE LEAD STAGE
// ─────────────────────────────────────────────

exports.updateLeadStage = async (req, res) => {
    try {

        const { id } = req.params;

        const {
            lead_stage,
            lost_reason,
        } = req.body;

        const allowedStages = [
            "new",
            "assigned",
            "contacted",
            "meeting_scheduled",
            "proposal_sent",
            "negotiation",
            "won",
            "lost",
            "on_hold",
        ];

        if (!allowedStages.includes(lead_stage)) {
            return res.status(400).json({
                success: false,
                message: "Invalid lead stage",
            });
        }

        const lead = await Lead.findById(id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        const isAssignedUser =
            lead.assigned_to?.toString() ===
            req.user._id.toString();

        const isManager =
            req.user.role === "manager";

        if (!isAssignedUser && !isManager) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized to update this lead",
            });
        }

        lead.lead_stage = lead_stage;

        if (lead_stage === "lost") {
            lead.lost_reason = lost_reason || "";
        }

        addTimeline(
            lead,
            "LEAD_STAGE_UPDATED",
            `Lead moved to ${lead_stage}`,
            req.user._id
        );

        await lead.save();

        res.status(200).json({
            success: true,
            message: "Lead stage updated successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// GET MY LEADS
// ─────────────────────────────────────────────

exports.getMyLeads = async (req, res) => {
    try {

        const leads = await Lead.find({
            created_by: req.user._id,
            is_deleted: false,
        })
            .populate("assigned_to", "name email employeeId")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leads.length,
            leads,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// ADD REMARK
// ─────────────────────────────────────────────

exports.addRemark = async (req, res) => {
    try {

        const { message } = req.body;

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        const isAssignedUser =
            lead.assigned_to?.toString() ===
            req.user._id.toString();

        const isManager =
            req.user.role === "manager";

        if (!isAssignedUser && !isManager) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized",
            });
        }

        lead.remarks.push({
            message,
            added_by: req.user._id,
        });

        addTimeline(
            lead,
            "REMARK_ADDED",
            `Remark added by ${req.user.name}`,
            req.user._id
        );

        await lead.save();

        res.status(200).json({
            success: true,
            message: "Remark added successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// ADD FOLLOW-UP
// ─────────────────────────────────────────────

exports.addFollowUp = async (req, res) => {
    try {

        const { next_follow_up } = req.body;

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        lead.next_follow_up = next_follow_up;
        lead.last_follow_up = new Date();

        lead.follow_up_count += 1;

        addTimeline(
            lead,
            "FOLLOW_UP_UPDATED",
            `Follow-up updated by ${req.user.name}`,
            req.user._id
        );

        await lead.save();

        res.status(200).json({
            success: true,
            message: "Follow-up updated successfully",
            lead,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// GET LEAD TIMELINE
// ─────────────────────────────────────────────

exports.getLeadTimeline = async (req, res) => {
    try {

        const lead = await Lead.findById(req.params.id)
            .populate("timeline.by", "name email");

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        const isAssignedUser =
            lead.assigned_to?.toString() ===
            req.user._id.toString();

        const isManager =
            req.user.role === "manager";

        if (!isAssignedUser && !isManager) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized",
            });
        }

        res.status(200).json({
            success: true,
            timeline: lead.timeline,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// SOFT DELETE LEAD
// ─────────────────────────────────────────────

exports.deleteLead = async (req, res) => {
    try {

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        lead.is_deleted = true;
        lead.deleted_at = new Date();

        addTimeline(
            lead,
            "LEAD_DELETED",
            `Lead deleted by ${req.user.name}`,
            req.user._id
        );

        await lead.save();

        res.status(200).json({
            success: true,
            message: "Lead deleted successfully",
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};