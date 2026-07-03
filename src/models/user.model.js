const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },

        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                "Please enter a valid email",
            ],
        },

        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: 6,
            select: false,
        },

        role: {
            type: String,
            enum: ["employee", "tl", "manager", "hr", "superadmin"],
            default: "employee",
        },

        employeeId: {
            type: String,
            required: [true, "Employee ID is required"],
            unique: true,
            index: true,
            uppercase: true,
            trim: true,
        },

        phone: {
            type: String,
            default: "",
            validate: {
                validator: function (v) {
                    if (!v || v === "") return true; // phone is optional
                    // accept 10-digit OR 12-digit with country code
                    return /^[0-9]{10}$/.test(v) || /^91[0-9]{10}$/.test(v);
                },
                message: "Enter valid phone number"
            }
        },

        designation: {
            type: String,
            default: "",
            trim: true,
        },

        department: {
            type: String,
            default: "",
            trim: true,
        },

        reportingTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            validate: {
                validator: function (value) {
                    return !value || value.toString() !== this._id.toString();
                },
                message: "User cannot report to themselves",
            },
        },

        avatar: {
            type: String,
            default: "",
        },

        dob: { type: Date, default: null },

        guardianName: {
            type: String,
            default: "",
            trim: true,
        },

        bloodGroup: {
            type: String,
            enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""],
            default: "",
        },

        emergencyContact: {
            name: { type: String, default: "", trim: true },
            phone: { type: String, default: "", trim: true },
            relation: { type: String, default: "", trim: true },
        },


        // ─── Personal Details ─────────────────────────────────────────
        maritalStatus: {
            type: String,
            enum: ["single", "married", "divorced", "widowed", "other"],
            default: null,
        },



        nationality: {
            type: String,
            default: "",
            trim: true,
        },

        governmentIds: {
            pan: {
                type: String,
                default: "",
                trim: true,
                uppercase: true,
            },
            aadhaar: {
                type: String,
                default: "",
                trim: true,
            },
            passport: {
                type: String,
                default: "",
                trim: true,
            },
            drivingLicense: {
                type: String,
                default: "",
                trim: true,
            }
        },

        documents: {
            aadhaar: {
                url: { type: String, default: "" },
                originalName: { type: String, default: "" },
                uploadedAt: { type: Date, default: null },
                verified: { type: Boolean, default: false },
                verifiedAt: { type: Date, default: null },
                verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            },
            pan: {
                url: { type: String, default: "" },
                originalName: { type: String, default: "" },
                uploadedAt: { type: Date, default: null },
                verified: { type: Boolean, default: false },
                verifiedAt: { type: Date, default: null },
                verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            },
            passbook: {
                url: { type: String, default: "" },
                originalName: { type: String, default: "" },
                uploadedAt: { type: Date, default: null },
                verified: { type: Boolean, default: false },
                verifiedAt: { type: Date, default: null },
                verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            },
            others: [
                {
                    url: { type: String, default: "" },
                    originalName: { type: String, default: "" },
                    label: { type: String, default: "Other Document" },
                    uploadedAt: { type: Date, default: null },
                    verified: { type: Boolean, default: false },
                    verifiedAt: { type: Date, default: null },
                    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
                },
            ],
        },

        bankDetails: {
            accountHolderName: { type: String, default: "", trim: true },
            accountNumber: { type: String, default: "", trim: true },
            bankName: { type: String, default: "", trim: true },
            ifscCode: { type: String, default: "", trim: true, uppercase: true },
            branchName: { type: String, default: "", trim: true },
            accountType: {
                type: String,
                enum: ["savings", "current", "salary", "other"],
                default: "savings",
            },
        },
        // ─────────────────────────────────────────────────────────────

        joiningDate: {
            type: Date,
            default: Date.now,
        },

        relievingDate: {
            type: Date,
            default: null,
        },

        employmentType: {
            type: String,
            enum: ["full-time", "part-time", "intern", "contract"],
            default: "full-time",
        },

        status: {
            type: String,
            enum: ["active", "inactive", "terminated"],
            default: "active",
        },

        lastLogin: {
            type: Date,
            default: null,
        },

        fcmToken: {
            type: String,
            default: null,
        },

        salary: {
            monthly: { type: Number, default: 0 },
            perDay: { type: Number, default: 0 },

            // ── Salary Structure (HR configures per employee) ──
            structure: {
                basic: {
                    enabled: { type: Boolean, default: true },
                    percent: { type: Number, default: 50 }
                },
                hra: {
                    enabled: { type: Boolean, default: true },
                    type: { type: String, enum: ["metro", "non-metro", "custom"], default: "non-metro" },
                    percent: { type: Number, default: 40 } // Used for 'custom', or as default
                },
                specialAllowance: {
                    enabled: { type: Boolean, default: true },
                    autoCalculated: { type: Boolean, default: true }
                },
                conveyance: {
                    enabled: { type: Boolean, default: true },
                    type: { type: String, enum: ["fixed", "percent"], default: "percent" },
                    value: { type: Number, default: 15 }
                },
                otherAllowance: {
                    enabled: { type: Boolean, default: true },
                    type: { type: String, enum: ["fixed", "percent"], default: "percent" },
                    value: { type: Number, default: 5 }
                },
            },

            // ── Deductions (HR enables/configures per employee) ──
            deductions: {
                pf: {
                    enabled: { type: Boolean, default: false },
                    percent: { type: Number, default: 12 },
                    pfNumber: { type: String, default: "", trim: true },
                    pfMode: { type: String, enum: ["actual", "capped"], default: "actual" } // "capped" means max 12% of 15000 = 1800
                },
                esi: {
                    enabled: { type: Boolean, default: false },
                    percent: { type: Number, default: 0.75 },
                    esiNumber: { type: String, default: "", trim: true },
                },
                professionalTax: {
                    enabled: { type: Boolean, default: false },
                    fixedAmount: { type: Number, default: 0 },
                    state: { type: String, default: "UP" }
                },
            },
        },

        canViewSalary: {
            type: Boolean,
            default: false,
        },

        // ─── Shift Configuration ───────────────────────────────────────────
        shift: {
            // "default" = 10:00–19:00 with quota rules
            // "custom"  = custom timing, no quota rules
            type: {
                type: String,
                enum: ["default", "custom"],
                default: "default",
            },
            startHour: { type: Number, default: 10 },
            startMinute: { type: Number, default: 0 },
            endHour: { type: Number, default: 19 },
            endMinute: { type: Number, default: 0 },
            // Grace window (minutes after start) before marking late
            graceMinutes: { type: Number, default: 15 },
            // After graceMinutes → half day threshold (minutes after start)
            halfDayAfterMinutes: { type: Number, default: 30 },
            label: { type: String, default: "", trim: true },
        },
        leaveBalance: {
            casual: {
                total: { type: Number, default: 0 },
                used: { type: Number, default: 0 },
                carryForward: { type: Number, default: 0 },
            },
            lastAccrualMonth: { type: Number, default: null },
            lastAccrualYear: { type: Number, default: null },
            sick: {
                total: { type: Number, default: 0 },
                used: { type: Number, default: 0 },
                carryForward: { type: Number, default: 0 },
            },
            earned: {
                total: { type: Number, default: 0 },
                used: { type: Number, default: 0 },
                carryForward: { type: Number, default: 0 },
            },
            // Short leave: 1 per month, expires unused, tracked separately
            shortLeave: {
                total: { type: Number, default: 1 },   // 1 per month
                used: { type: Number, default: 0 },    // used this month
                lastGrantedMonth: { type: Number, default: () => new Date().getMonth() + 1 },
                lastGrantedYear: { type: Number, default: () => new Date().getFullYear() },
            },
            lastResetYear: { type: Number, default: () => new Date().getFullYear() },
            lastResetMonth: { type: Number, default: () => new Date().getMonth() + 1 },
            lastAccrual: { type: Date, default: null },
        },

        isLegacyEmployee: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        deletedAt: {
            type: Date,
            default: null,
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        shiftReminderEmail: {
            type: Boolean,
            default: true,
        },

        // ─── Approved Devices ─────────────────────────────────────────────────
        approvedDevices: [
            {
                deviceToken: { type: String, required: true },
                deviceUUID: { type: String, default: "" },
                productId: { type: String, default: "" },
                hostname: { type: String, default: "" },
                os: { type: String, default: "" },
                label: { type: String, default: "" },
                approvedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                    default: null,
                },
                approvedAt: { type: Date, default: Date.now },
                lastUsedAt: { type: Date, default: null },
            }
        ],

        workLocation: {
            type: String,
            enum: ["office", "wfh"],
            default: "office",
        },
        workLocationUpdatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        workLocationUpdatedAt: {
            type: Date,
            default: null,
        },
        workLocationConfig: {
            startDate: { type: Date, default: null },
            endDate: { type: Date, default: null },
            reason: { type: String, default: "" },
        },

        sessions: [
            {
                sessionId: { type: String, required: true },
                deviceInfo: { type: String, default: "Unknown Device" },
                ipAddress: { type: String, default: "" },
                userAgent: { type: String, default: "" },
                browser: { type: String, default: "" },
                browserVersion: { type: String, default: "" },
                os: { type: String, default: "" },
                osVersion: { type: String, default: "" },
                deviceType: { type: String, default: "Desktop" },
                engine: { type: String, default: "" },
                platform: { type: String, default: "" },
                createdAt: { type: Date, default: Date.now },
                lastActive: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;

    if (!["hr", "manager"].includes(this.role)) {
        delete obj.governmentId;
        delete obj.bankDetails;
    }

    return obj;
};

userSchema.virtual("fullName").get(function () {
    return this.name;
});

module.exports = mongoose.model("User", userSchema);