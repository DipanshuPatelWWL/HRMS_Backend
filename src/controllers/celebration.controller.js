const Celebration = require("../models/celebration.model");
const User = require("../models/user.model");
const moment = require("moment-timezone");


// ─────────────────────────────────────────────
// CREATE CELEBRATION
// ─────────────────────────────────────────────

const createCelebration = async (req, res) => {
    try {
        const {
            employeeId,
            templateId,
            templateStyle,
            eventType,
            sendToEmployee,
            sendToOthers,
            recipients,
            customMessage,
            uploadedImage,
            scheduledAt,
        } = req.body;

        // templateId is now optional — only employeeId, eventType, scheduledAt are required
        if (!employeeId || !eventType || !scheduledAt) {
            return res.status(400).json({
                success: false,
                message: "Employee, event type, and scheduled date are required",
            });
        }

        const employee = await User.findById(employeeId);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found",
            });
        }

        // Strip the employee from recipients to prevent duplicate emails
        const cleanedRecipients = Array.isArray(recipients)
            ? recipients.filter(r => r?.toString() !== employeeId?.toString())
            : [];

        const celebrationData = {
            employeeId,
            eventType,
            sendToEmployee,
            sendToOthers,
            recipients: cleanedRecipients,
            customMessage,
            uploadedImage,
            scheduledAt,
            templateStyle: templateStyle || "dark_purple",
        };

        // Only attach templateId if it's a valid non-empty value
        if (templateId && templateId.trim() !== "") {
            celebrationData.templateId = templateId;
        }

        const celebration = await Celebration.create(celebrationData);

        res.status(201).json({
            success: true,
            message: "Celebration scheduled successfully",
            celebration,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// GET UPCOMING CELEBRATIONS
// ─────────────────────────────────────────────

const getUpcomingCelebrations = async (req, res) => {
    try {
        const nowIST = moment().tz("Asia/Kolkata");
        const todayMidnight = nowIST.clone().startOf("day");

        const users = await User.find({ status: "active" });

        let events = [];

        users.forEach((user) => {

            // ── BIRTHDAY ──────────────────────────
            if (user.dob) {
                const dob = moment.tz(user.dob, "Asia/Kolkata");

                let nextBirthday = dob.clone().year(nowIST.year());

                // Roll to next year if already passed
                if (nextBirthday.isBefore(todayMidnight, "day")) {
                    nextBirthday.year(nowIST.year() + 1);
                }

                const diffDays = nextBirthday.diff(todayMidnight, "days");

                if (diffDays >= 0 && diffDays <= 30) {
                    events.push({
                        employeeId: user._id,
                        employeeName: user.name,
                        avatar: user.avatar || "",
                        eventType: "birthday",
                        eventDate: nextBirthday.toDate(),
                        daysLeft: diffDays,
                    });
                }
            }

            // ── WORK ANNIVERSARY ──────────────────
            if (user.joiningDate) {
                const joining = moment.tz(user.joiningDate, "Asia/Kolkata");

                // Only show if they've worked at least 1 year
                let yearsWorked = nowIST.year() - joining.year();
                
                // If anniversary hasn't happened yet this year, use previous year's anniversary to calculate yearsWorked
                let nextAnniversary = joining.clone().year(nowIST.year());
                
                if (nextAnniversary.isBefore(todayMidnight, "day")) {
                    nextAnniversary.year(nowIST.year() + 1);
                }
                
                const finalYearsWorked = nextAnniversary.year() - joining.year();
                if (finalYearsWorked < 1) return;

                const diffDays = nextAnniversary.diff(todayMidnight, "days");

                if (diffDays >= 0 && diffDays <= 30) {
                    events.push({
                        employeeId: user._id,
                        employeeName: user.name,
                        avatar: user.avatar || "",
                        eventType: "anniversary",
                        eventDate: nextAnniversary.toDate(),
                        daysLeft: diffDays,
                        anniversaryYear: finalYearsWorked,
                    });
                }
            }
        });

        events.sort((a, b) => a.daysLeft - b.daysLeft);

        res.status(200).json({
            success: true,
            count: events.length,
            events,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// UPDATE CELEBRATION
// ─────────────────────────────────────────────

const updateCelebration = async (req, res) => {
    try {
        const updates = { ...req.body };

        // If templateId is empty string, remove it from update to avoid cast error
        if (updates.templateId === "" || updates.templateId === null) {
            delete updates.templateId;
        }

        // Strip the employee from recipients to prevent duplicate emails
        if (Array.isArray(updates.recipients) && updates.employeeId) {
            updates.recipients = updates.recipients.filter(
                r => r?.toString() !== updates.employeeId?.toString()
            );
        }

        const celebration = await Celebration.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        );

        if (!celebration) {
            return res.status(404).json({
                success: false,
                message: "Celebration not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Celebration updated successfully",
            celebration,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// DELETE CELEBRATION
// ─────────────────────────────────────────────

const deleteCelebration = async (req, res) => {
    try {
        const celebration = await Celebration.findByIdAndDelete(req.params.id);

        if (!celebration) {
            return res.status(404).json({
                success: false,
                message: "Celebration not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Celebration deleted successfully",
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// ─────────────────────────────────────────────
// GET ALL CELEBRATIONS
// ─────────────────────────────────────────────

const getAllCelebrations = async (req, res) => {
    try {
        const celebrations = await Celebration.find()
            .populate("employeeId", "name email avatar")
            .populate("templateId", "templateName")
            .sort({ scheduledAt: 1 });

        res.status(200).json({
            success: true,
            count: celebrations.length,
            celebrations,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


module.exports = {
    createCelebration,
    getUpcomingCelebrations,
    updateCelebration,
    deleteCelebration,
    getAllCelebrations,
};