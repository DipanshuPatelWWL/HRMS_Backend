const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const { validateBankDetails } = require("../utils/validators/bankDetails.validator");
const { notifyWelcome } = require("../services/emailNotify");


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
        const {
            name, email, password, role,
            monthlySalary, department, designation,
            phone,
            reportingTo,   // ← NEW: TL's _id to assign this employee to a team
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "name, email and password are required",
            });
        }

        if (phone) {
            const cleanPhone = phone.toString().replace(/\D/g, "");
            if (cleanPhone.length !== 12 || !cleanPhone.startsWith("91")) {
                return res.status(400).json({
                    success: false,
                    message: "Please add a valid mobile number with country code (e.g. 919876543210)",
                });
            }
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
            phone: phone || "",
            password: hashedPassword,
            employeeId,
            role: role || "employee",
            department: department || null,
            designation: designation || "",
            salary: {
                monthly: monthlySalary || 0,
                perDay: 0,
            },
            // ── Save reportingTo only if provided and valid ──
            ...(reportingTo ? { reportingTo } : {}),
        });

        await notifyWelcome(email, {
            employeeName: name,
            employeeId: user.employeeId,
            designation: designation || "",
            department: department || "",
            password: password,
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
            filter.role = { $in: ["employee", "tl", "hr"] };
        } else if (req.user.role === "tl") {
            filter.reportingTo = req.user._id;
        }

        const users = await User.find(filter).select("-password");

        const safeUsers = users.map(user => {
            const u = user.toObject();
            if (req.user.role !== "hr" && req.user.role !== "manager") {
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
//  GET ALL TLs  (HR uses this to populate dropdown)
// ─────────────────────────────────────────────
const getAllTLs = async (req, res) => {
    try {
        const tls = await User.find({ role: "tl", status: "active" }).select("_id name employeeId department");
        res.status(200).json({ success: true, tls });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  ASSIGN TEAM MEMBERS TO TL  (HR bulk-assign)
//  PATCH /users/assign-team
//  body: { tlId: "...", employeeIds: ["...", "..."] }
// ─────────────────────────────────────────────
const assignTeamToTL = async (req, res) => {
    try {
        const { tlId, employeeIds } = req.body;

        if (!tlId || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "tlId and a non-empty employeeIds array are required",
            });
        }

        const tl = await User.findById(tlId);
        if (!tl || tl.role !== "tl") {
            return res.status(400).json({ success: false, message: "Invalid TL id" });
        }

        await User.updateMany(
            { _id: { $in: employeeIds } },
            { $set: { reportingTo: tlId } }
        );

        res.status(200).json({
            success: true,
            message: `${employeeIds.length} employee(s) assigned to ${tl.name}`,
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

        if (req.user.role !== "hr" && req.user.role !== "manager") {
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

        if (status === "terminated" && req.user.role !== "hr" && req.user.role !== "manager") {
            return res.status(403).json({ success: false, message: "Only HR & Manager can terminate users" });
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
        const ALLOWED_FIELDS = ["phone", "dob", "avatar", "maritalStatus", "nationality", "guardianName"];
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

        const user = await User.findById(targetId).select("+governmentIds");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            governmentIds: user.governmentIds
        });

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
        const { governmentIds } = req.body;

        if (!governmentIds) {
            return res.status(400).json({ success: false, message: "governmentIds is required" });
        }

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        if (
            governmentIds.pan &&
            !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(governmentIds.pan)
        ) {
            return res.status(400).json({ success: false, message: "Invalid PAN format" });
        }

        if (
            governmentIds.aadhaar &&
            !/^\d{12}$/.test(governmentIds.aadhaar)
        ) {
            return res.status(400).json({ success: false, message: "Invalid Aadhaar format" });
        }

        const normalizedPan = governmentIds.pan ? governmentIds.pan.trim().toUpperCase() : "";
        const normalizedAadhaar = governmentIds.aadhaar ? governmentIds.aadhaar.trim() : "";

        const user = await User.findByIdAndUpdate(
            targetId,
            { governmentIds: { pan: normalizedPan, aadhaar: normalizedAadhaar } },
            { new: true, runValidators: true }
        ).select("+governmentIds");

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            message: "Government IDs saved successfully",
            governmentIds: user.governmentIds,
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
        const user2 = await User.findById(targetId);

        const normalize = (str) =>
            str.toLowerCase().replace(/\s+/g, " ").trim();

        if (normalize(user2.name) !== normalize(accountHolderName)) {
            return res.status(400).json({
                success: false,
                message: "Account holder name must match your profile name",
            });
        }

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
    getAllTLs,
    assignTeamToTL,
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