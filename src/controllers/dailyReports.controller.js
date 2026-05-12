const DailyReport = require("../models/dailyReports.model");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// @desc    Create / Submit a daily report
// @route   POST /api/daily-report
// @access  Private (Employee)
// ─────────────────────────────────────────────
const createDailyReport = async (req, res) => {
    try {
        const { task_name, day, status, message } = req.body;

        if (!task_name || !day) {
            return res.status(400).json({
                success: false,
                message: "task_name and day are required fields.",
            });
        }

        const reportData = {
            task_name,
            day,
            status: status || "pending",
            message: message || "",
            file: req.file ? req.file.path : "",  // multer sets req.file
        };

        const report = await DailyReport.create(reportData);

        return res.status(201).json({
            success: true,
            message: "Daily report submitted successfully.",
            data: report,
        });
    } catch (error) {
        console.error("createDailyReport error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// @desc    Get all daily reports (admin / self)
// @route   GET /api/daily-report
// @access  Private
// ─────────────────────────────────────────────
const getAllDailyReports = async (req, res) => {
    try {
        // Optional filters via query params: ?status=pending&day=Monday
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.day) filter.day = req.query.day;
        if (req.query.date) {
            const start = new Date(req.query.date);
            const end = new Date(req.query.date);
            end.setHours(23, 59, 59, 999);
            filter.date = { $gte: start, $lte: end };
        }

        // Manager only sees reports sent by employees
        filter.sent = true;
        const reports = await DailyReport.find(filter).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: reports.length,
            data: reports,
        });
    } catch (error) {
        console.error("getAllDailyReports error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// @desc    Get a single daily report by ID
// @route   GET /api/daily-report/:id
// @access  Private
// ─────────────────────────────────────────────
const getDailyReportById = async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        return res.status(200).json({
            success: true,
            data: report,
        });
    } catch (error) {
        console.error("getDailyReportById error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// @desc    Update a daily report
// @route   PUT /api/daily-report/:id
// @access  Private (Employee - own report)
// ─────────────────────────────────────────────
const updateDailyReport = async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        const { task_name, day, status, message } = req.body;

        // If a new file is uploaded, delete the old one from disk
        if (req.file) {
            if (report.file && fs.existsSync(report.file)) {
                fs.unlinkSync(report.file);
            }
            report.file = req.file.path;
        }

        if (task_name !== undefined) report.task_name = task_name;
        if (day !== undefined) report.day = day;
        if (status !== undefined) report.status = status;
        if (message !== undefined) report.message = message;

        const updatedReport = await report.save();

        return res.status(200).json({
            success: true,
            message: "Daily report updated successfully.",
            data: updatedReport,
        });
    } catch (error) {
        console.error("updateDailyReport error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// @desc    Update only the status of a report
// @route   PATCH /api/daily-report/:id/status
// @access  Private (Admin)
// ─────────────────────────────────────────────
const updateReportStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!["pending", "completed"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Status must be 'pending' or 'completed'.",
            });
        }

        const report = await DailyReport.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: `Report status updated to '${status}'.`,
            data: report,
        });
    } catch (error) {
        console.error("updateReportStatus error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};

// ─────────────────────────────────────────────
// @desc    Mark a daily report as "sent"
// @route   PATCH /api/daily-report/:id/send
// @access  Private (Employee - own report)
// ─────────────────────────────────────────────
const sendDailyReport = async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        if (report.sent) {
            return res.status(400).json({
                success: false,
                message: "Report has already been sent.",
            });
        }

        report.sent = true;
        const updatedReport = await report.save();

        return res.status(200).json({
            success: true,
            message: "Report sent successfully.",
            data: updatedReport,
        });
    } catch (error) {
        console.error("sendDailyReport error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error.",
            error: error.message,
        });
    }
};

module.exports = {
    createDailyReport,
    getAllDailyReports,
    getDailyReportById,
    updateDailyReport,
    updateReportStatus,
    sendDailyReport,
};