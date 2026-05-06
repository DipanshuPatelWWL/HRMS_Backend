const Lead = require("../models/sales.report.model");
const { sendMail } = require("../services/emailClient");

// helper for department check
const isSales = (user) =>
    user?.department?.toLowerCase() === "sales";

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
            user: req.user._id,
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
// SEND TO MANAGER
// ─────────────────────────────────────────────
exports.sendToManager = async (req, res) => {
    try {
        if (!isSales(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Only Sales department can send leads",
            });
        }

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        // ownership check 🔐
        if (lead.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "You can only send your own leads",
            });
        }

        // prevent duplicate send
        if (lead.status !== "draft") {
            return res.status(400).json({
                success: false,
                message: "Lead already sent or processed",
            });
        }

        lead.status = "sent_to_manager";
        await lead.save();

        // populate for email
        await lead.populate("user", "name email");

        // 📧 send email (non-blocking)
        sendMail({
            to: process.env.MANAGER_EMAIL,
            subject: "📢 New Lead Submitted",
            html: `
                <h3>New Lead Received</h3>
                <p><b>Client:</b> ${lead.client_name}</p>
                <p><b>Email:</b> ${lead.client_email}</p>
                <p><b>Service:</b> ${lead.services}</p>
                <p><b>Country:</b> ${lead.country}</p>
                <p><b>Message:</b> ${lead.message || "-"}</p>
                <p><b>Submitted By:</b> ${lead.user?.name}</p>
            `,
        }).catch(err => console.error("Email failed:", err.message));

        res.json({
            success: true,
            message: "Lead sent to manager",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// MANAGER: GET LEADS
// ─────────────────────────────────────────────
exports.getManagerLeads = async (req, res) => {
    try {
        const { status } = req.query;

        // NO default filter — return ALL leads unless status explicitly passed
        const filter = status ? { status } : {};

        const leads = await Lead.find(filter)
            .populate("user", "name email employeeId")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, count: leads.length, leads });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// MANAGER: APPROVE / REJECT
// ─────────────────────────────────────────────
exports.updateLeadStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reject_reason } = req.body;

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        if (status === "rejected" && !reject_reason?.trim()) {
            return res.status(400).json({ success: false, message: "Reject reason is required" });
        }

        const lead = await Lead.findById(id);   // ← Lead, not SalesReport
        if (!lead) return res.status(404).json({ success: false, message: "Report not found" });

        if (lead.status !== "sent_to_manager") {
            return res.status(400).json({ success: false, message: "Only pending reports can be actioned" });
        }

        lead.status = status;
        lead.action_by = req.user._id;
        lead.action_date = new Date();
        if (status === "rejected") lead.reject_reason = reject_reason.trim();

        await lead.save();

        res.status(200).json({ success: true, message: `Report ${status}`, lead });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// SALES: GET MY LEADS
// ─────────────────────────────────────────────
exports.getMyLeads = async (req, res) => {
    try {
        if (!isSales(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        const leads = await Lead.find({
            user: req.user._id,
        })
            .select('date marketer client_name client_email services country message status reject_reason action_date createdAt updatedAt')
            .sort({ createdAt: -1 });

        res.json({
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

exports.updateLead = async (req, res) => {
    try {
        if (!isSales(req.user)) {
            return res.status(403).json({
                success: false,
                message: "Only Sales can update leads",
            });
        }

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: "Lead not found",
            });
        }

        // 🔐 ownership check
        if (lead.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own leads",
            });
        }

        // ❗ prevent edit after send
        if (lead.status !== "draft") {
            return res.status(400).json({
                success: false,
                message: "Cannot edit after sending",
            });
        }

        const updated = await Lead.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );

        res.json({
            success: true,
            message: "Lead updated successfully",
            lead: updated,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};