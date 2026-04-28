const Payroll = require("../models/payroll.model");
const User = require("../models/user.model");

const processPayroll = async (req, res) => {
    try {
        const { userId, month, year, baseSalary, bonus = 0, deductions = 0 } = req.body;

        // check user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // prevent duplicate payroll
        const existing = await Payroll.findOne({ user: userId, month, year });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Payroll already processed for this month",
            });
        }

        // calculate net salary
        const netSalary = baseSalary + bonus - deductions;

        const payroll = await Payroll.create({
            user: userId,
            month,
            year,
            baseSalary,
            bonus,
            deductions,
            netSalary,
            status: "processed",
        });

        res.status(201).json({
            success: true,
            message: "Payroll processed successfully",
            payroll,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


//  GET MY PAYSLIPS (Employee)
const getMyPayrolls = async (req, res) => {
    try {
        const payrolls = await Payroll.find({ user: req.user._id })
            .sort({ year: -1, month: -1 });

        res.status(200).json({
            success: true,
            count: payrolls.length,
            payrolls,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


//  GET ALL PAYROLLS (HR)
const getAllPayrolls = async (req, res) => {
    try {
        const payrolls = await Payroll.find()
            .populate("user", "name email employeeId")
            .sort({ year: -1, month: -1 });

        res.status(200).json({
            success: true,
            count: payrolls.length,
            payrolls,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


//  UPDATE PAYROLL (HR)
const updatePayroll = async (req, res) => {
    try {
        const { id } = req.params;
        const { baseSalary, bonus, deductions } = req.body;

        const payroll = await Payroll.findById(id);
        if (!payroll) {
            return res.status(404).json({
                success: false,
                message: "Payroll not found",
            });
        }

        // update values
        if (baseSalary !== undefined) payroll.baseSalary = baseSalary;
        if (bonus !== undefined) payroll.bonus = bonus;
        if (deductions !== undefined) payroll.deductions = deductions;

        // recalculate
        payroll.netSalary = payroll.baseSalary + payroll.bonus - payroll.deductions;

        await payroll.save();

        res.status(200).json({
            success: true,
            message: "Payroll updated",
            payroll,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};



//  MARK AS PAID (HR)
const markAsPaid = async (req, res) => {
    try {
        const { id } = req.params;

        const payroll = await Payroll.findById(id);
        if (!payroll) {
            return res.status(404).json({
                success: false,
                message: "Payroll not found",
            });
        }

        payroll.status = "paid";
        await payroll.save();

        res.status(200).json({
            success: true,
            message: "Payroll marked as paid",
            payroll,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

module.exports = {
    processPayroll,
    getMyPayrolls,
    getAllPayrolls,
    updatePayroll,
    markAsPaid,
};