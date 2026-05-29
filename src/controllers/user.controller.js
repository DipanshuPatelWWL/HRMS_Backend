const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const { validateBankDetails } = require("../utils/validators/bankDetails.validator");
const { notifyWelcome, notifyShiftChanged } = require("../services/emailNotify");


// ─────────────────────────────────────────────
//  GENERATE EMPLOYEE ID
// ─────────────────────────────────────────────
const generateEmployeeId = async () => {
    const COMPANY_PREFIX = "WWL";

    const lastUser = await User.findOne({
        employeeId: new RegExp(`^${COMPANY_PREFIX}\\d+$`),
    }).sort({ employeeId: -1 });

    let number = 119;
    if (lastUser) {
        const lastNumber = parseInt(lastUser.employeeId.replace(COMPANY_PREFIX, ""));
        if (!isNaN(lastNumber)) number = lastNumber + 1;
    }

    return `${COMPANY_PREFIX}${number}`;
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
            const isValid =
                /^[0-9]{10}$/.test(cleanPhone) ||
                (/^91[0-9]{10}$/.test(cleanPhone));
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    message: "Enter a valid 10-digit mobile number",
                });
            }
        }

        const allowedRolesByCreator = {
            hr: ["employee", "tl"],
            manager: ["employee", "tl", "hr", "manager"],
            superadmin: ["employee", "tl", "hr", "manager", "superadmin"],
        };
        const creatorRole = req.user.role;
        const targetRole = role || "employee";
        const permitted = allowedRolesByCreator[creatorRole] || [];
        if (!permitted.includes(targetRole)) {
            return res.status(403).json({
                success: false,
                message: `${creatorRole.toUpperCase()} cannot create a user with role "${targetRole}"`,
            });
        }
        // ─────────────────────────────────────────────────────

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists" });
        }

        const employeeId = await generateEmployeeId(name);

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Parse joining date at noon IST to avoid UTC day-shift
        const parsedJoiningDate = req.body.joiningDate
            ? new Date(new Date(req.body.joiningDate + "T12:00:00+05:30").toLocaleString("en-US", { timeZone: "Asia/Kolkata" }))
            : new Date();

        const user = await User.create({
            name,
            email,
            phone: phone || "",
            password: hashedPassword,
            employeeId,
            role: role || "employee",
            department: department || null,
            designation: designation || "",
            joiningDate: parsedJoiningDate,
            salary: {
                monthly: monthlySalary || 0,
                perDay: 0,
            },
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
            filter.role = { $in: ["employee", "tl", "hr"] };
        } else if (req.user.role === "manager") {
            filter.role = { $in: ["employee", "tl", "hr", "manager"] };
            filter.status = { $ne: "terminated" };
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


const getUserList = async (req, res) => {
    try {
        const roleMap = {
            manager: ["employee", "tl", "hr"],
            hr: ["employee", "tl"],
        };

        const allowedRoles = roleMap[req.user.role];
        if (!allowedRoles) {
            return res.status(403).json({
                success: false,
                message: "Access denied — only manager and HR can view employee list",
            });
        }

        const users = await User.find({
            role: { $in: allowedRoles },
            status: { $ne: "terminated" },
            _id: { $ne: req.user._id }, // exclude self
        }).select("_id name employeeId role department").lean();

        res.status(200).json({ success: true, users });
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
//  GET EMPLOYEES BY TL
//  GET /users/tl/:tlId/employees
// ─────────────────────────────────────────────
const getEmployeesByTL = async (req, res) => {
    try {
        const { tlId } = req.params;

        const tl = await User.findById(tlId);
        if (!tl || tl.role !== "tl") {
            return res.status(400).json({ success: false, message: "Invalid TL id" });
        }

        const employees = await User.find({ reportingTo: tlId })
            .select("_id name employeeId department designation reportingTo");

        res.status(200).json({ success: true, employees });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  UNASSIGN EMPLOYEE FROM TL
//  PATCH /users/unassign-employee
//  body: { employeeId: "..." }
// ─────────────────────────────────────────────
const unassignEmployeeFromTL = async (req, res) => {
    try {
        const { employeeId } = req.body;

        if (!employeeId) {
            return res.status(400).json({ success: false, message: "employeeId is required" });
        }

        const employee = await User.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        await User.findByIdAndUpdate(employeeId, { $unset: { reportingTo: "" } });

        res.status(200).json({ success: true, message: `${employee.name} unassigned successfully` });
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

        // Flatten salary into dot-notation so nested fields
        // don't overwrite unrelated salary sub-fields
        const flatUpdates = { ...updates };
        if (updates.salary && typeof updates.salary === "object") {
            delete flatUpdates.salary;
            if (updates.salary.monthly !== undefined) {
                flatUpdates["salary.monthly"] = updates.salary.monthly;
            }
            if (updates.salary.perDay !== undefined) {
                flatUpdates["salary.perDay"] = updates.salary.perDay;
            }
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { $set: flatUpdates },
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
        const ALLOWED_FIELDS = [
            "phone", "dob", "avatar", "maritalStatus", "nationality",
            "guardianName", "bloodGroup", "emergencyContact",
        ];

        // HR and Manager can also update their own name, email, phone
        const PRIVILEGED_FIELDS = ["name", "email"];
        const isPrivileged = ["hr", "manager", "superadmin"].includes(req.user.role);

        const updates = {};

        ALLOWED_FIELDS.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        if (isPrivileged) {
            PRIVILEGED_FIELDS.forEach(field => {
                if (req.body[field] !== undefined) {
                    updates[field] = req.body[field];
                }
            });
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        // If email is being updated, check it's not taken
        if (updates.email) {
            const existing = await User.findOne({ email: updates.email.toLowerCase() });
            if (existing && existing._id.toString() !== req.user._id.toString()) {
                return res.status(400).json({ success: false, message: "Email already in use" });
            }
            updates.email = updates.email.toLowerCase().trim();
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
        if (!accountHolderName || !accountNumber || !ifscCode) {
            return res.status(400).json({
                success: false,
                message: "accountHolderName, accountNumber and ifscCode are required",
            });
        }

        const user2 = await User.findById(targetId);
        if (!user2) return res.status(404).json({ success: false, message: "User not found" });

        const normalize = (str) =>
            str.toLowerCase().replace(/\s+/g, " ").trim();

        if (normalize(user2.name) !== normalize(accountHolderName)) {
            return res.status(400).json({
                success: false,
                message: "Account holder name must match your profile name",
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


const getSalesUsers = async (req, res) => {
    try {

        const users = await User.find({
            department: "Sales",
            designation: {
                $in: ["Business Development Manager"]
            }
        }).select("name email designation role");

        res.status(200).json({
            success: true,
            users,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};



const uploadEmployeeDocument = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;
        const docType = req.params.type; // aadhaar | pan | passbook | other
        const validTypes = ["aadhaar", "pan", "passbook", "other"];

        if (!validTypes.includes(docType)) {
            return res.status(400).json({ success: false, message: "Invalid document type" });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const fileUrl = `/uploads/documents/${req.file.filename}`;
        const originalName = req.file.originalname;
        const label = req.body.label || "Other Document";

        let update;
        if (docType === "other") {
            // push a new entry into the others array
            update = {
                $push: {
                    "documents.others": {
                        url: fileUrl,
                        originalName,
                        label,
                        uploadedAt: new Date(),
                        verified: false,
                        verifiedAt: null,
                        verifiedBy: null,
                    },
                },
            };
        } else {
            update = {
                $set: {
                    [`documents.${docType}`]: {
                        url: fileUrl,
                        originalName,
                        uploadedAt: new Date(),
                        verified: false,
                        verifiedAt: null,
                        verifiedBy: null,
                    },
                },
            };
        }

        const user = await User.findByIdAndUpdate(targetId, update, { new: true }).select("+documents");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            message: "Document uploaded successfully",
            documents: user.documents,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  GET EMPLOYEE DOCUMENTS
//  GET /users/me/documents
//  GET /users/:id/documents  (HR/manager)
// ─────────────────────────────────────────────
const getEmployeeDocuments = async (req, res) => {
    try {
        const targetId = req.params.id || req.user._id;

        if (
            req.user.role === "employee" &&
            req.user._id.toString() !== targetId.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const user = await User.findById(targetId)
            .select("+documents")
            .populate("documents.aadhaar.verifiedBy", "name")
            .populate("documents.pan.verifiedBy", "name")
            .populate("documents.passbook.verifiedBy", "name")
            .populate("documents.others.verifiedBy", "name");

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({ success: true, documents: user.documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ─────────────────────────────────────────────
//  VERIFY DOCUMENT  (HR / manager only)
//  PUT /users/:id/documents/:type/verify
//  PUT /users/:id/documents/other/:otherId/verify
// ─────────────────────────────────────────────
const verifyEmployeeDocument = async (req, res) => {
    try {
        const { id: targetId, type, otherId } = req.params;

        // if otherId exists → this is OTHER document verification
        const docType = otherId ? "other" : type;

        const validTypes = ["aadhaar", "pan", "passbook", "other"];

        if (!validTypes.includes(docType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid document type",
            });
        }

        let update;
        if (docType === "other") {
            // verify a specific entry inside the others array
            update = {
                $set: {
                    "documents.others.$[elem].verified": true,
                    "documents.others.$[elem].verifiedAt": new Date(),
                    "documents.others.$[elem].verifiedBy": req.user._id,
                },
            };
        } else {
            update = {
                $set: {
                    [`documents.${docType}.verified`]: true,
                    [`documents.${docType}.verifiedAt`]: new Date(),
                    [`documents.${docType}.verifiedBy`]: req.user._id,
                },
            };
        }

        const options = docType === "other"
            ? { new: true, arrayFilters: [{ "elem._id": otherId }] }
            : { new: true };

        const user = await User.findByIdAndUpdate(targetId, update, options).select("+documents");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({
            success: true,
            message: "Document verified",
            documents: user.documents,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// ─────────────────────────────────────────────
//  UPDATE SHIFT — single employee
//  PUT /users/:id/shift
//  body: { shift: { type, startHour, startMinute, endHour, endMinute,
//                   graceMinutes, halfDayAfterMinutes, label } }
// ─────────────────────────────────────────────
const updateEmployeeShift = async (req, res) => {
    try {
        const { shift } = req.body;
        if (!shift) {
            return res.status(400).json({ success: false, message: "shift object is required" });
        }

        const ALLOWED = ["type", "startHour", "startMinute", "endHour", "endMinute",
            "graceMinutes", "halfDayAfterMinutes", "label"];

        // Build the full shift object with defaults so we always write
        // a complete sub-document — avoids "Cannot create field in null" error
        // on users whose shift field was never initialised.
        const shiftDefaults = {
            type: "default",
            startHour: 10, startMinute: 0,
            endHour: 19, endMinute: 0,
            graceMinutes: 15, halfDayAfterMinutes: 30,
            label: "",
        };

        const mergedShift = { ...shiftDefaults };
        ALLOWED.forEach(k => { if (shift[k] !== undefined) mergedShift[k] = shift[k]; });

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { $set: { shift: mergedShift } },   // write whole object, not dotted paths
            { new: true, runValidators: true }
        ).select("-password");

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // ── Helpers ──────────────────────────────────────────────────────────
        const pad2 = (n) => String(n).padStart(2, "0");
        const to12h = (h, m) => {
            const ampm = h >= 12 ? "PM" : "AM";
            return `${h % 12 || 12}:${pad2(m)} ${ampm}`;
        };

        const s = user.shift;
        const startTime = to12h(s.startHour, s.startMinute);
        const endTime = to12h(s.endHour, s.endMinute);
        const shiftLabel = s.label || `${startTime} – ${endTime}`;
        const changedBy = req.user?.name || "HR";

        // Always show times clearly — never append times to a label that
        // already contains them (preset labels include the time in brackets)
        const shiftDisplay = `${startTime} – ${endTime}${s.label ? ` (${s.label})` : ""}`;

        // ── Email (fire-and-forget) ──────────────────────────────────────────
        notifyShiftChanged(user.email, {
            employeeName: user.name,
            shiftLabel: shiftDisplay,
            startTime,
            endTime,
            graceMinutes: s.graceMinutes,
            halfDayAfterMinutes: s.halfDayAfterMinutes,
            changedBy,
        }).catch(err => console.error("Shift email error:", err));

        // ── In-app notification ──────────────────────────────────────────────
        const io = req.app.get("io");
        if (io) {
            const { createNotification } = require("./notification.controller");
            await createNotification(
                io,
                user._id,
                "🕐 Shift Timing Updated",
                `Your shift has been changed to ${shiftDisplay} by ${changedBy}.`,
                "system",
                {
                    shiftLabel, startTime, endTime,
                    graceMinutes: s.graceMinutes,
                    halfDayAfterMinutes: s.halfDayAfterMinutes
                }
            );
        }

        res.status(200).json({ success: true, message: "Shift updated", shift: user.shift, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
//  BULK UPDATE SHIFT — apply same shift to many / all employees
//  PUT /users/bulk-shift
//  body: { employeeIds: ["id1","id2",...] | "all", shift: {...} }
// ─────────────────────────────────────────────
const bulkUpdateShift = async (req, res) => {
    try {
        const { employeeIds, shift } = req.body;
        if (!shift) {
            return res.status(400).json({ success: false, message: "shift object is required" });
        }

        const ALLOWED = ["type", "startHour", "startMinute", "endHour", "endMinute",
            "graceMinutes", "halfDayAfterMinutes", "label"];

        const shiftDefaults = {
            type: "default",
            startHour: 10, startMinute: 0,
            endHour: 19, endMinute: 0,
            graceMinutes: 15, halfDayAfterMinutes: 30,
            label: "",
        };

        const mergedShift = { ...shiftDefaults };
        ALLOWED.forEach(k => { if (shift[k] !== undefined) mergedShift[k] = shift[k]; });

        // Fetch affected users BEFORE updating (need email + name)
        let filter = {};
        if (employeeIds === "all") {
            filter = { role: { $in: ["employee", "tl", "hr", "manager"] } };
        } else if (Array.isArray(employeeIds) && employeeIds.length > 0) {
            filter = { _id: { $in: employeeIds } };
        } else {
            return res.status(400).json({
                success: false,
                message: "employeeIds must be an array of IDs or \"all\"",
            });
        }

        // Fetch affected users BEFORE updating — exclude the HR making the change
        const affectedUsers = await User.find({
            ...filter,
            _id: { $ne: req.user._id },
        }).select("name email").lean();

        const result = await User.updateMany(filter, { $set: { shift: mergedShift } });

        // ── Helpers ──────────────────────────────────────────────────────────
        const pad2 = (n) => String(n).padStart(2, "0");
        const to12h = (h, m) => {
            const ampm = h >= 12 ? "PM" : "AM";
            return `${h % 12 || 12}:${pad2(m)} ${ampm}`;
        };

        const startTime = to12h(shift.startHour ?? 10, shift.startMinute ?? 0);
        const endTime = to12h(shift.endHour ?? 19, shift.endMinute ?? 0);
        const shiftLabel = shift.label || `${startTime} – ${endTime}`;
        const changedBy = req.user?.name || "HR";

        const shiftDisplay = `${startTime} – ${endTime}${shift.label ? ` (${shift.label})` : ""}`;

        // ── Notify only the affected employees (fire-and-forget) ─────────────
        const io = req.app.get("io");
        const { createNotification } = require("./notification.controller");

        await Promise.allSettled(
            affectedUsers.map(async (emp) => {
                // Email
                notifyShiftChanged(emp.email, {
                    employeeName: emp.name,
                    shiftLabel: shiftDisplay,
                    startTime,
                    endTime,
                    graceMinutes: shift.graceMinutes ?? 15,
                    halfDayAfterMinutes: shift.halfDayAfterMinutes ?? 30,
                    changedBy,
                }).catch(err => console.error(`Shift email error for ${emp.email}:`, err));

                // In-app notification
                if (io) {
                    await createNotification(
                        io,
                        emp._id,
                        "🕐 Shift Timing Updated",
                        `Your shift has been changed to ${shiftDisplay} by ${changedBy}.`,
                        "system",
                        {
                            shiftLabel, startTime, endTime,
                            graceMinutes: shift.graceMinutes ?? 15,
                            halfDayAfterMinutes: shift.halfDayAfterMinutes ?? 30
                        }
                    );
                }
            })
        );

        res.status(200).json({
            success: true,
            message: `Shift updated for ${result.modifiedCount} employee(s)`,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getLeaveBalance = async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select("name employeeId leaveBalance");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.json({
            success: true,
            leaveBalance: user.leaveBalance || {
                casual: { total: 12, used: 0 },
                sick: { total: 6, used: 0 },
                earned: { total: 0, used: 0 },
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}



module.exports = {
    createUserByHR,
    getUserList,
    getAllUsers,
    getAllTLs,
    assignTeamToTL,
    getEmployeesByTL,
    unassignEmployeeFromTL,
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
    getSalesUsers,
    uploadEmployeeDocument,
    getEmployeeDocuments,
    verifyEmployeeDocument,
    updateEmployeeShift,
    bulkUpdateShift,
    getLeaveBalance
};