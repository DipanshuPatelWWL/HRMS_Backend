// controllers/holiday.controller.js
const Holiday = require("../models/holiday.model");
const { notifyHoliday } = require("../services/emailNotify");
const User = require("../models/user.model")

// 📌 Utility: normalize date to start of day
const normalizeDate = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

// 📌 Utility: validate date
const isValidDate = (date) => {
    return date instanceof Date && !isNaN(date);
};

// =============================
// ➕ MARK HOLIDAY
// =============================
const markHoliday = async (req, res) => {
    try {
        let { date, name, type } = req.body;

        // ✅ validation
        if (!date || !name) {
            return res.status(400).json({
                success: false,
                message: "Date and name are required",
            });
        }

        name = name.trim();
        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Holiday name cannot be empty",
            });
        }

        const normalized = normalizeDate(date);

        if (!isValidDate(normalized)) {
            return res.status(400).json({
                success: false,
                message: "Invalid date",
            });
        }

        // ✅ prevent duplicate holiday (same day)
        const existing = await Holiday.findOne({
            date: {
                $gte: normalized,
                $lte: new Date(normalized.getTime() + 86400000 - 1),
            },
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Holiday already exists: ${existing.name}`,
            });
        }

        const holiday = await Holiday.create({
            date: normalized,
            name,
            type: type || "company",
            markedBy: req.user._id,
        });

        const allUsers = await User.find({ status: "active" }).select("email");
        await Promise.allSettled(
            allUsers.map(u =>
                notifyHoliday(u.email, {
                    name,
                    date: normalized,
                    markedBy: req.user.name
                })
            )
        );

        res.status(201).json({
            success: true,
            message: "Holiday marked successfully",
            holiday: {
                ...holiday.toObject(),
                date: new Date(holiday.date).toISOString(),
            },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// =============================
// ❌ DELETE HOLIDAY
// =============================
const deleteHoliday = async (req, res) => {
    try {
        const { id } = req.params;

        const holiday = await Holiday.findByIdAndDelete(id);

        if (!holiday) {
            return res.status(404).json({
                success: false,
                message: "Holiday not found",
            });
        }

        res.json({
            success: true,
            message: "Holiday deleted successfully",
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// =============================
// 📅 GET HOLIDAYS
// =============================
const getHolidays = async (req, res) => {
    try {
        const { month, year } = req.query;

        let filter = {};

        if (month && year) {
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0, 23, 59, 59);

            filter.date = { $gte: start, $lte: end };
        }

        const holidays = await Holiday.find(filter)
            .populate("markedBy", "name employeeId")
            .sort({ date: 1, createdAt: 1 });

        res.json({
            success: true,
            count: holidays.length,
            holidays,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// =============================
// ✏️ UPDATE HOLIDAY
// =============================
const updateHoliday = async (req, res) => {
    try {
        const { id } = req.params;
        let { date, name, type } = req.body;

        const holiday = await Holiday.findById(id);

        if (!holiday) {
            return res.status(404).json({
                success: false,
                message: "Holiday not found",
            });
        }

        // ✅ update date
        if (date) {
            const normalized = normalizeDate(date);

            if (!isValidDate(normalized)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date",
                });
            }

            const existing = await Holiday.findOne({
                _id: { $ne: id },
                date: {
                    $gte: normalized,
                    $lte: new Date(normalized.getTime() + 86400000 - 1),
                },
            });

            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: "Another holiday already exists on this date",
                });
            }

            holiday.date = normalized;
        }

        // ✅ update name
        if (name !== undefined) {
            name = name.trim();

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: "Holiday name cannot be empty",
                });
            }

            holiday.name = name;
        }

        // ✅ update type
        if (type) {
            holiday.type = type;
        }

        await holiday.save();

        res.json({
            success: true,
            message: "Holiday updated successfully",
            holiday,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

module.exports = {
    markHoliday,
    deleteHoliday,
    getHolidays,
    updateHoliday,
};