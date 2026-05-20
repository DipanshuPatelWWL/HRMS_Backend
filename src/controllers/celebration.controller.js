const Celebration = require("../models/celebration.model");
const User = require("../models/user.model");


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
        const today = new Date();

        // Normalize to midnight for accurate day diff
        const todayMidnight = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
        );

        const users = await User.find({ status: "active" });

        let events = [];

        users.forEach((user) => {

            // ── BIRTHDAY ──────────────────────────
            if (user.dob) {
                const dob = new Date(user.dob);

                let nextBirthday = new Date(
                    today.getFullYear(),
                    dob.getMonth(),
                    dob.getDate()
                );

                // Roll to next year if already passed
                if (nextBirthday < todayMidnight) {
                    nextBirthday = new Date(
                        today.getFullYear() + 1,
                        dob.getMonth(),
                        dob.getDate()
                    );
                }

                const diffDays = Math.round(
                    (nextBirthday - todayMidnight) / (1000 * 60 * 60 * 24)
                );

                if (diffDays >= 0 && diffDays <= 30) {
                    events.push({
                        employeeId: user._id,
                        employeeName: user.name,
                        avatar: user.avatar || "",
                        eventType: "birthday",
                        eventDate: nextBirthday,
                        daysLeft: diffDays,
                    });
                }
            }

            // ── WORK ANNIVERSARY ──────────────────
            if (user.joiningDate) {
                const joining = new Date(user.joiningDate);

                // Only show if they've worked at least 1 year
                const yearsWorked = today.getFullYear() - joining.getFullYear();
                if (yearsWorked < 1) return;

                let nextAnniversary = new Date(
                    today.getFullYear(),
                    joining.getMonth(),
                    joining.getDate()
                );

                // Roll to next year if already passed
                if (nextAnniversary < todayMidnight) {
                    nextAnniversary = new Date(
                        today.getFullYear() + 1,
                        joining.getMonth(),
                        joining.getDate()
                    );
                }

                const diffDays = Math.round(
                    (nextAnniversary - todayMidnight) / (1000 * 60 * 60 * 24)
                );

                const anniversaryYear = nextAnniversary.getFullYear() - joining.getFullYear();

                if (diffDays >= 0 && diffDays <= 30) {
                    events.push({
                        employeeId: user._id,
                        employeeName: user.name,
                        avatar: user.avatar || "",
                        eventType: "anniversary",
                        eventDate: nextAnniversary,
                        daysLeft: diffDays,
                        anniversaryYear,
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