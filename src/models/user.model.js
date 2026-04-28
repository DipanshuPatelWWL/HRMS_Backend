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
            trim: true,
            match: [/^[0-9]{10}$/, "Enter valid phone number"],
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

        shift: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Shift",
            default: null,
        },

        avatar: {
            type: String,
            default: "",
        },

        dob: { type: Date, default: null },

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

        governmentId: {
            idType: {
                type: String,
                enum: ["aadhaar", "pan", "passport", "voter_id", "driving_license", "other"],
                default: null,
            },
            idNumber: {
                type: String,
                default: "",
                trim: true,
            },
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
        },

        canViewSalary: {
            type: Boolean,
            default: false,
        },

        leaveBalance: {
            total: { type: Number, default: 0 },
            used: { type: Number, default: 0 },
            lastAccrual: { type: Date, default: null },
        },
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

    if (this.role === "employee") {
        delete obj.salary;
    }

    if (!["hr", "superadmin"].includes(this.role)) {
        delete obj.governmentId;
        delete obj.bankDetails;
    }

    return obj;
};

userSchema.virtual("fullName").get(function () {
    return this.name;
});

module.exports = mongoose.model("User", userSchema);