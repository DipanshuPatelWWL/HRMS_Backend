const PayrollSettings = require("../models/payrollSettings.model");

// GET /api/settings/payroll
const getPayrollSettings = async (req, res) => {
    try {
        let settings = await PayrollSettings.findOne({ singletonKey: "singleton" });
        if (!settings) {
            try {
                settings = await PayrollSettings.create({ singletonKey: "singleton" });
            } catch (err) {
                // If it was created in the meantime by another request
                if (err.code === 11000) {
                    settings = await PayrollSettings.findOne({ singletonKey: "singleton" });
                } else {
                    throw err;
                }
            }
        }
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /api/settings/payroll
const updatePayrollSettings = async (req, res) => {
    try {
        const { financialYear, taxRegime, pfMode, defaultHraType, professionalTaxState } = req.body;
        
        // Basic validation
        if (taxRegime && !["old", "new"].includes(taxRegime)) {
            return res.status(400).json({ success: false, message: "Invalid taxRegime" });
        }
        if (pfMode && !["actual", "capped"].includes(pfMode)) {
            return res.status(400).json({ success: false, message: "Invalid pfMode" });
        }
        if (defaultHraType && !["metro", "non-metro", "custom"].includes(defaultHraType)) {
            return res.status(400).json({ success: false, message: "Invalid defaultHraType" });
        }

        let settings = await PayrollSettings.findOne({ singletonKey: "singleton" });
        if (!settings) {
            try {
                settings = await PayrollSettings.create({ singletonKey: "singleton" });
            } catch (err) {
                if (err.code === 11000) {
                    settings = await PayrollSettings.findOne({ singletonKey: "singleton" });
                } else {
                    throw err;
                }
            }
        }

        if (financialYear !== undefined) settings.financialYear = financialYear;
        if (taxRegime !== undefined) settings.taxRegime = taxRegime;
        if (pfMode !== undefined) settings.pfMode = pfMode;
        if (defaultHraType !== undefined) settings.defaultHraType = defaultHraType;
        if (professionalTaxState !== undefined) settings.professionalTaxState = professionalTaxState;

        await settings.save();
        res.json({ success: true, message: "Payroll settings updated", settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getPayrollSettings, updatePayrollSettings };
