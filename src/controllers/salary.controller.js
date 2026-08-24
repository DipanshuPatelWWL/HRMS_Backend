const Attendance = require("../models/attendance.model");
const User = require("../models/user.model");
const Holiday = require("../models/holiday.model");
const Leave = require("../models/leave.model");
const { calculateSalary } = require("../utils/salary/salaryEngine");

// ─────────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────────
const isWeekend = (date) => {
    const day = new Date(date).getDay();
    return day === 0 || day === 6;
};


function round2(n) { return Math.round(n * 100) / 100; }

// ─────────────────────────────────────────────
//  GET MONTHLY SALARY
// ─────────────────────────────────────────────
const getMonthlySalary = async (req, res) => {
    try {
        const { userId } = req.params;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                message: "month and year are required",
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // ── Access control ────────────────────────────
        const isAdminViewer = ["hr", "manager", "superadmin"].includes(req.user.role);
        if (!isAdminViewer) {
            if (req.user._id.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You can only view your own salary",
                });
            }
        }

        // ── Calculate using shared engine ─────────────
        const isCurrentMonth = (parseInt(month) === new Date().getMonth() + 1 && parseInt(year) === new Date().getFullYear());
        const data = await calculateSalary(
            userId,
            parseInt(month),
            parseInt(year),
            isCurrentMonth ? "earned" : "final"
        );

        if (!data) {
            return res.status(400).json({
                success: false,
                message: "Salary not configured for this employee",
            });
        }

        res.json({ success: true, data });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// ─────────────────────────────────────────────
//  UPDATE SALARY ACCESS (HR releases salary visibility)
// ─────────────────────────────────────────────
const updateSalaryAccess = async (req, res) => {
    try {
        const { canViewSalary } = req.body;

        if (typeof canViewSalary !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "canViewSalary must be true or false",
            });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { canViewSalary },
            { new: true }
        ).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({
            success: true,
            message: `Salary access ${canViewSalary ? "granted" : "revoked"}`,
            user,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};



// ─────────────────────────────────────────────
//  UPDATE SALARY STRUCTURE (HR configures per employee)
//  PUT /salary/:userId/structure
// ─────────────────────────────────────────────
const updateSalaryStructure = async (req, res) => {
    try {
        const { userId } = req.params;
        const { structure, deductions } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // ── Validate structure ──
        if (structure) {
            const keys = ["basic", "hra", "specialAllowance", "conveyance", "otherAllowance"];
            for (const key of keys) {
                if (structure[key]) {
                    const pct = Number(structure[key].percent || 0);
                    if (pct < 0 || pct > 100) {
                        return res.status(400).json({ success: false, message: `Invalid percent for ${key}` });
                    }
                }
            }
            // Note: We've relaxed the 100% sum check here because the salary engine 
            // now handles auto-balancing via Special Allowance and pro-rated HRA.
            user.salary.structure = structure;
        }

        if (deductions) {
            // Validate PF
            if (deductions.pf?.enabled) {
                if (deductions.pf.percent < 0 || deductions.pf.percent > 100) {
                    return res.status(400).json({ success: false, message: "Invalid PF percent" });
                }
                if (deductions.pf.pfMode && !["actual", "capped"].includes(deductions.pf.pfMode)) {
                    return res.status(400).json({ success: false, message: "Invalid PF mode" });
                }
            }

            // Validate PF number
            if (deductions.pf?.enabled && deductions.pf.pfNumber) {
                const pfNum = deductions.pf.pfNumber.trim().toUpperCase();
                if (pfNum.length < 5) {
                    return res.status(400).json({ success: false, message: "Invalid PF / UAN number" });
                }
                deductions.pf.pfNumber = pfNum;
            }

            // Validate ESI
            if (deductions.esi?.enabled) {
                if (deductions.esi.percent < 0 || deductions.esi.percent > 100) {
                    return res.status(400).json({ success: false, message: "Invalid ESI percent" });
                }
                if (deductions.esi.esiNumber) {
                    const esiNum = deductions.esi.esiNumber.trim();
                    if (!/^\d{17}$/.test(esiNum)) {
                        return res.status(400).json({ success: false, message: "ESI number must be exactly 17 digits" });
                    }
                    deductions.esi.esiNumber = esiNum;
                }
            }

            // Professional Tax State Validation & Normalization
            if (deductions.professionalTax?.enabled && deductions.professionalTax.state) {
                const stateMap = {
                    "Uttar Pradesh": "UP", "Delhi": "DL", "Haryana": "HR",
                    "Maharashtra": "MH", "Karnataka": "KA", "Telangana": "TG",
                    "UP": "UP", "DL": "DL", "HR": "HR", "MH": "MH", "KA": "KA", "TG": "TG"
                };
                const normalized = stateMap[deductions.professionalTax.state];
                if (!normalized) {
                    return res.status(400).json({ success: false, message: "Invalid state for Professional Tax" });
                }
                deductions.professionalTax.state = normalized;
            }

            user.salary.deductions = deductions;
        }

        await user.save();

        res.json({
            success: true,
            message: "Salary structure updated successfully",
            salaryStructure: user.salary,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { getMonthlySalary, updateSalaryAccess, updateSalaryStructure };