const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");


const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};


const signup = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            employeeId,
            department,
        } = req.body;

        const existingUser = await User.findOne({
            $or: [{ email }, { employeeId }],
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists with email or employeeId",
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            employeeId,
            department: department,
            role: "employee"
        });

        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            token,
            user,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email }).select("+password");

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Your account is inactive. Contact HR.",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user);

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

const getMe = async (req, res) => {
    try {
        // req.user is set by the authenticateToken middleware
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    signup,
    login,
    getMe
};