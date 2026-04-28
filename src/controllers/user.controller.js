const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const { validateGovernmentId } = require("../utils/validators/governmentId.validator");
const { validateBankDetails } = require("../utils/validators/bankDetails.validator");


// ─────────────────────────────────────────────
//  GENERATE EMPLOYEE ID
// ─────────────────────────────────────────────
const generateEmployeeId = async (name) => {
    const COMPANY_PREFIX = "WWL";

    const parts = name.trim().split(" ");
    let initials = "";

    if (parts.length > 1) {
        initials =
            parts[0][0].toUpperCase() +
            parts[parts.length - 1][0].toUpperCase();
    } else {
        initials = parts[0].substring(0, 2).toUpperCase();
    }

    const lastUser = await User.findOne({
        employeeId: new RegExp(`^${COMPANY_PREFIX}-`),
    }).sort({ createdAt: -1 });

    let number = 1;
    if (lastUser) {
        const lastId = lastUser.employeeId;
        const lastNumber = parseInt(lastId.slice(-3));
        if (!isNaN(lastNumber)) number = lastNumber + 1;
    }

    const paddedNumber = String(number).padStart(3, "0");
    return `${COMPANY_PREFIX}-${initials}${paddedNumber}`;
};


// ─────────────────────────────────────────────
//  CREATE USER (HR)
// ─────────────────────────────────────────────
const createUserByHR = async (req, res) => {
    try {
        const { name, email, password, role, monthlySalary, department, designation } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "name, email and password are required",
            });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists" });
        }

        const employeeId = await generateEmployeeId(name);

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            employeeId,
            role: role || "employee",
            department: department || null,
            designation: designation || "",
            salary: {
                monthly: monthlySalary || 0,
                perDay: 0,
            },
        });

        res.status(201).json({
            success: true,
            message: "User created successfully",
            user,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET ALL USERS
// ─────────────────────────────────────────────
const getAllUsers = async (req, res) => {
    try {
        let filter = {};

        if (req.user.role === "hr") {
            filter.role = { $in: ["employee", "tl"] };
        } else if (req.user.role === "manager") {
            filter.role = { $in: ["employee", "tl"] };
        } else if (req.user.role === "tl") {
            filter.reportingTo = req.user._id;
        }

        const users = await User.find(filter).select("-password");

        const safeUsers = users.map(user => {
            const u = user.toObject();
            if (req.user.role !== "hr" && req.user.role !== "superadmin") {
                delete u.salary;
            }
            return u;
        });

        res.status(200).json({
            success: true,
            count: safeUsers.length,
            users: safeUsers,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET SINGLE USER
// ─────────────────────────────────────────────
const getSingleUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        let userData = user.toObject();

        if (req.user.role !== "hr" && req.user.role !== "superadmin") {
            delete userData.salary;
        }

        res.status(200).json({ success: true, user: userData });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE USER (HR)
// ─────────────────────────────────────────────
const updateUser = async (req, res) => {
    try {
        const updates = req.body;

        const user = await User.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        ).select("-password");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ success: true, message: "User updated", user });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  DELETE USER (HR)
// ─────────────────────────────────────────────
const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ success: true, message: "User deleted" });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE USER STATUS (HR)
// ─────────────────────────────────────────────
const updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;

        const allowed = ["active", "inactive", "terminated"];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value" });
        }

        const target = await User.findById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (target._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ success: false, message: "You cannot change your own status" });
        }

        if (status === "terminated" && req.user.role !== "hr" && req.user.role !== "superadmin") {
            return res.status(403).json({ success: false, message: "Only HR can terminate users" });
        }

        if (target.role === "superadmin" && req.user.role !== "superadmin") {
            return res.status(403).json({ success: false, message: "Not allowed to modify superadmin" });
        }

        target.status = status;
        await target.save();

        res.status(200).json({
            success: true,
            message: `User status updated to ${status}`,
            user: target,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE MY PROFILE (Employee self-service)
// ─────────────────────────────────────────────
const updateMyProfile = async (req, res) => {
    try {
        const ALLOWED_FIELDS = ["phone", "dob", "avatar", "maritalStatus", "nationality"];
        const updates = {};

        ALLOWED_FIELDS.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        ).select("-password");

        res.status(200).json({ success: true, message: "Profile updated", user });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  CHANGE MY PASSWORD
// ─────────────────────────────────────────────
const changeMyPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "currentPassword and newPassword are required",
            });
        }

        const user = await User.findById(req.user._id).select("+password");

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Current password is incorrect" });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.status(200).json({ success: true, message: "Password changed successfully" });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPLOAD AVATAR
// ─────────────────────────────────────────────
const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { avatar: avatarUrl },
            { new: true }
        ).select("-password");

        res.status(200).json({ success: true, avatarUrl, user });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET GOVERNMENT ID
// ─────────────────────────────────────────────
const getGovernmentId = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const user = await User.findById(targetId).select("+governmentId");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({ success: true, governmentId: user.governmentId });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE GOVERNMENT ID
// ─────────────────────────────────────────────
const updateGovernmentId = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;
        const { idType, idNumber } = req.body;

        if (!idType || !idNumber) {
            return res.status(400).json({ success: false, message: "idType and idNumber are required" });
        }

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        // ── Format + checksum validation ────────────────────────────
        const validation = validateGovernmentId(idType, idNumber);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message,
            });
        }

        const normalised = idNumber.trim().toUpperCase().replace(/\s/g, "");

        const user = await User.findByIdAndUpdate(
            targetId,
            { governmentId: { idType, idNumber: normalised } },
            { new: true, runValidators: true }
        ).select("+governmentId");

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            message: "Government ID validated and saved",
            governmentId: user.governmentId,
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET BANK DETAILS
// ─────────────────────────────────────────────
const getBankDetails = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const user = await User.findById(targetId).select("+bankDetails");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({ success: true, bankDetails: user.bankDetails });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  UPDATE BANK DETAILS
// ─────────────────────────────────────────────
const updateBankDetails = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;
        const { accountHolderName, accountNumber, bankName, ifscCode, branchName, accountType } = req.body;

        if (!accountHolderName || !accountNumber || !ifscCode) {
            return res.status(400).json({
                success: false,
                message: "accountHolderName, accountNumber and ifscCode are required",
            });
        }

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        // ── Format + IFSC live lookup ───────────────────────────────
        const validation = await validateBankDetails({
            accountNumber,
            ifsc: ifscCode,
            accountHolderName,
        });

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: "Bank details validation failed",
                errors: validation.errors,
            });
        }

        // Auto-fill bank + branch from IFSC lookup if not provided
        const resolvedBankName = bankName || validation.bankInfo?.bank || "";
        const resolvedBranchName = branchName || validation.bankInfo?.branch || "";

        const user = await User.findByIdAndUpdate(
            targetId,
            {
                bankDetails: {
                    accountHolderName: accountHolderName.trim(),
                    accountNumber: accountNumber.trim(),
                    bankName: resolvedBankName,
                    ifscCode: ifscCode.toUpperCase(),
                    branchName: resolvedBranchName,
                    accountType: accountType || "savings",
                },
            },
            { new: true, runValidators: true }
        ).select("+bankDetails");

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            message: "Bank details validated and saved",
            bankDetails: user.bankDetails,
            verification: {
                ifscValid: true,
                bank: validation.bankInfo?.bank,
                branch: validation.bankInfo?.branch,
                city: validation.bankInfo?.city,
                state: validation.bankInfo?.state,
                warning: validation.warning || null,
            },
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  DEBUG (Dev only)
// ─────────────────────────────────────────────
const debugUsers = async (req, res) => {
    try {
        const allUsers = await User.find();
        const employees = await User.find({ role: "employee" });
        const byRole = await User.aggregate([
            { $group: { _id: "$role", count: { $sum: 1 } } },
        ]);

        res.json({
            totalUsers: allUsers.length,
            employeeCount: employees.length,
            roleBreakdown: byRole,
            sampleUsers: allUsers.slice(0, 5).map(u => ({
                name: u.name,
                role: u.role,
                email: u.email,
            })),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    createUserByHR,
    getAllUsers,
    getSingleUser,
    updateUser,
    deleteUser,
    debugUsers,
    updateMyProfile,
    changeMyPassword,
    uploadAvatar,
    updateUserStatus,
    getGovernmentId,
    updateGovernmentId,
    getBankDetails,
    updateBankDetails,
};