const CelebrationTemplate = require("../models/celebrationTemplate.model");

// Default templates auto-seeded on first fetch if DB is empty
const DEFAULT_TEMPLATES = [
    {
        templateName: "Royal Night Birthday",
        eventType: "birthday",
        style: "dark_purple",
        subject: "🎂 Happy Birthday, {{employeeName}}!",
        body: "On behalf of the entire team, we wish you a fantastic birthday filled with joy and celebration!",
    },
    {
        templateName: "Corporate Blue Anniversary",
        eventType: "anniversary",
        style: "corporate_blue",
        subject: "🏢 Happy Work Anniversary, {{employeeName}}!",
        body: "Thank you for your dedication and hard work. Here's to many more years of success together!",
    },
    {
        templateName: "Warm Gold Celebration",
        eventType: "custom",
        style: "warm_gold",
        subject: "🎉 Congratulations, {{employeeName}}!",
        body: "We are so proud of your achievement. You truly deserve this recognition!",
    },
    {
        templateName: "Light Minimal Birthday",
        eventType: "birthday",
        style: "light_minimal",
        subject: "🎂 Wishing You a Wonderful Birthday, {{employeeName}}!",
        body: "Wishing you a great birthday and a memorable year. From all of us.",
    },
];


// ─────────────────────────────────────────────
// GET ALL TEMPLATES  (auto-seeds defaults if empty)
// ─────────────────────────────────────────────

const getAllTemplates = async (req, res) => {
    try {
        let templates = await CelebrationTemplate.find({ isActive: true }).sort({ createdAt: 1 });

        // Auto-seed default templates if none exist
        if (templates.length === 0) {
            templates = await CelebrationTemplate.insertMany(DEFAULT_TEMPLATES);
        }

        res.status(200).json({
            success: true,
            count: templates.length,
            templates,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// GET SINGLE TEMPLATE
// ─────────────────────────────────────────────

const getTemplate = async (req, res) => {
    try {
        const template = await CelebrationTemplate.findById(req.params.id);

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found",
            });
        }

        res.status(200).json({ success: true, template });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
// CREATE TEMPLATE
// ─────────────────────────────────────────────

const createTemplate = async (req, res) => {
    try {
        const { templateName, eventType, subject, body, style } = req.body;

        if (!templateName) {
            return res.status(400).json({
                success: false,
                message: "Template name is required",
            });
        }

        const template = await CelebrationTemplate.create({
            templateName,
            eventType: eventType || "all",
            subject: subject || "",
            body: body || "",
            style: style || "dark_purple",
        });

        res.status(201).json({
            success: true,
            message: "Template created successfully",
            template,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
// UPDATE TEMPLATE
// ─────────────────────────────────────────────

const updateTemplate = async (req, res) => {
    try {
        const template = await CelebrationTemplate.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Template updated successfully",
            template,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
// DELETE TEMPLATE
// ─────────────────────────────────────────────

const deleteTemplate = async (req, res) => {
    try {
        const template = await CelebrationTemplate.findByIdAndDelete(req.params.id);

        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Template deleted successfully",
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getAllTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
};