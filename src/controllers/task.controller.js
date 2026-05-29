const Task = require("../models/task.model");
const User = require("../models/user.model");

// ─── CREATE TASK (HR / Manager / TL) ───────────────────────────────────────
const createTask = async (req, res) => {
    try {
        const { title, description, assignedTo, priority, dueDate, tags } = req.body;

        if (!title || !assignedTo) {
            return res.status(400).json({
                success: false,
                message: "title and assignedTo are required",
            });
        }

        const assignee = await User.findById(assignedTo);
        if (!assignee) {
            return res.status(404).json({ success: false, message: "Assigned user not found" });
        }

        // TL can only assign tasks to members of their own department
        if (req.user.role === "tl") {
            if (!req.user.department) {
                return res.status(403).json({
                    success: false,
                    message: "Your account has no department set. Contact HR.",
                });
            }
            if (assignee.department?.toString() !== req.user.department?.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You can only assign tasks to members of your own department.",
                });
            }
        }

        const task = await Task.create({
            title,
            description,
            assignedTo,
            assignedBy: req.user._id,
            priority,
            dueDate: dueDate || null,
            tags: tags || [],
        });

        const populated = await task.populate([
            { path: "assignedTo", select: "name email employeeId department" },
            { path: "assignedBy", select: "name email department" },
        ]);

        res.status(201).json({
            success: true,
            message: "Task created successfully",
            task: populated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET MY TASKS (Employee / TL — tasks assigned to me) ─────────────────────────
const getMyTasks = async (req, res) => {
    try {
        const { status, priority } = req.query;

        const filter = { assignedTo: req.user._id };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const tasks = await Task.find(filter)
            .populate("assignedBy", "name email department")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tasks.length,
            tasks,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET DEPARTMENT TASKS (TL — tasks they assigned within their dept) ───────
const getDepartmentTasks = async (req, res) => {
    try {
        const { status, priority, assignedTo } = req.query;

        if (!req.user.department) {
            return res.status(403).json({
                success: false,
                message: "Your account has no department assigned.",
            });
        }

        // Only users directly reporting to this TL
        const deptUsers = await User.find({ reportingTo: req.user._id }).select("_id");
        const deptUserIds = deptUsers.map((u) => u._id);

        const filter = { assignedTo: { $in: deptUserIds } };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (assignedTo) filter.assignedTo = assignedTo;

        const tasks = await Task.find(filter)
            .populate("assignedTo", "name email employeeId department")
            .populate("assignedBy", "name email department")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tasks.length,
            tasks,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET MEMBERS OF TL's DEPARTMENT ─────────────────────────────────────────
const getDepartmentMembers = async (req, res) => {
    try {
        if (!req.user.department) {
            return res.status(403).json({
                success: false,
                message: "Your account has no department assigned.",
            });
        }

        const members = await User.find({
            reportingTo: req.user._id,
            role: { $in: ["employee", "tl"] },
        }).select("name email employeeId department role");

        res.status(200).json({ success: true, members });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL TASKS (HR / Manager — with optional department filter) ──────────
const getAllTasks = async (req, res) => {
    try {
        const { status, priority, assignedTo, department } = req.query;

        let filter = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (assignedTo) filter.assignedTo = assignedTo;

        // If department filter is provided, find users in that dept first
        if (department) {
            const deptUsers = await User.find({ department }).select("_id");
            const deptUserIds = deptUsers.map((u) => u._id);
            filter.assignedTo = { $in: deptUserIds };
        }

        const tasks = await Task.find(filter)
            .populate("assignedTo", "name email employeeId department")
            .populate("assignedBy", "name email department")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tasks.length,
            tasks,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL DEPARTMENTS LIST (HR) ──────────────────────────────────────────
const getAllDepartments = async (req, res) => {
    try {
        const departments = await User.distinct("department");
        res.status(200).json({ success: true, departments: departments.filter(Boolean) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET SINGLE TASK ────────────────────────────────────────────────────────
const getSingleTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate("assignedTo", "name email employeeId department")
            .populate("assignedBy", "name email department");

        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // Employee can only view their own task
        if (
            req.user.role === "employee" &&
            task.assignedTo._id.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        // TL can only view tasks in their department
        if (req.user.role === "tl") {
            const assigneeDept = task.assignedTo.department?.toString();
            const tlDept = req.user.department?.toString();
            if (assigneeDept !== tlDept) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }
        }

        res.status(200).json({ success: true, task });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE TASK STATUS + WORK REPORT (Employee / TL for own tasks) ─────────
const updateTaskStatus = async (req, res) => {
    try {
        const { status, workReport } = req.body;
        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // Only the assigned employee can update status
        if (task.assignedTo.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not your task" });
        }

        if (status) task.status = status;
        if (workReport !== undefined) task.workReport = workReport;

        if (status === "done" && !task.completedAt) {
            task.completedAt = new Date();
        }
        if (status !== "done") {
            task.completedAt = null;
        }

        await task.save();

        const populated = await task.populate([
            { path: "assignedTo", select: "name email employeeId department" },
            { path: "assignedBy", select: "name email department" },
        ]);

        res.status(200).json({ success: true, message: "Task updated", task: populated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE FULL TASK (HR / Manager / TL) ───────────────────────────────────
const updateTask = async (req, res) => {
    try {
        const { title, description, assignedTo, priority, dueDate, tags, status } = req.body;

        const task = await Task.findById(req.params.id)
            .populate("assignedTo", "name email department");

        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // TL can only update tasks in their own department
        if (req.user.role === "tl") {
            const assigneeDept = task.assignedTo.department?.toString();
            const tlDept = req.user.department?.toString();
            if (assigneeDept !== tlDept) {
                return res.status(403).json({
                    success: false,
                    message: "You can only update tasks within your department.",
                });
            }

            // If reassigning, validate new assignee is also in TL's dept
            if (assignedTo) {
                const newAssignee = await User.findById(assignedTo);
                if (!newAssignee || newAssignee.department?.toString() !== tlDept) {
                    return res.status(403).json({
                        success: false,
                        message: "You can only reassign tasks to members of your own department.",
                    });
                }
            }
        }

        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (assignedTo !== undefined) task.assignedTo = assignedTo;
        if (priority !== undefined) task.priority = priority;
        if (dueDate !== undefined) task.dueDate = dueDate;
        if (tags !== undefined) task.tags = tags;
        if (status !== undefined) {
            task.status = status;
            task.completedAt = status === "done" ? new Date() : null;
        }

        await task.save();

        const populated = await task.populate([
            { path: "assignedTo", select: "name email employeeId department" },
            { path: "assignedBy", select: "name email department" },
        ]);

        res.status(200).json({ success: true, message: "Task updated", task: populated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE TASK (HR / Manager / TL — dept-restricted) ──────────────────────
const deleteTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate("assignedTo", "department");

        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // TL can only delete tasks in their own department
        if (req.user.role === "tl") {
            const assigneeDept = task.assignedTo.department?.toString();
            const tlDept = req.user.department?.toString();
            if (assigneeDept !== tlDept) {
                return res.status(403).json({
                    success: false,
                    message: "You can only delete tasks within your department.",
                });
            }
        }

        await Task.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: "Task deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET TASK STATS (HR Dashboard) ──────────────────────────────────────────
const getTaskStats = async (req, res) => {
    try {
        // If HR requests dept-wise breakdown
        const { department } = req.query;

        let matchFilter = {};
        if (department) {
            const deptUsers = await User.find({ department }).select("_id");
            const deptUserIds = deptUsers.map((u) => u._id);
            matchFilter.assignedTo = { $in: deptUserIds };
        }

        const total = await Task.countDocuments(matchFilter);
        const pending = await Task.countDocuments({ ...matchFilter, status: "pending" });
        const inProgress = await Task.countDocuments({ ...matchFilter, status: "in-progress" });
        const done = await Task.countDocuments({ ...matchFilter, status: "done" });
        const overdue = await Task.countDocuments({
            ...matchFilter,
            status: { $ne: "done" },
            dueDate: { $lt: new Date() },
        });

        // Department-wise breakdown (for HR overview)
        const deptBreakdown = await Task.aggregate([
            { $match: matchFilter },
            {
                $lookup: {
                    from: "users",
                    localField: "assignedTo",
                    foreignField: "_id",
                    as: "assignee",
                },
            },
            { $unwind: "$assignee" },
            {
                $group: {
                    _id: "$assignee.department",
                    total: { $sum: 1 },
                    done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                    inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
                },
            },
            { $sort: { total: -1 } },
        ]);

        res.status(200).json({
            success: true,
            stats: { total, pending, inProgress, done, overdue },
            deptBreakdown,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET TL DEPT STATS ───────────────────────────────────────────────────────
const getDeptStats = async (req, res) => {
    try {
        if (!req.user.department) {
            return res.status(403).json({ success: false, message: "No department assigned." });
        }

        const deptUsers = await User.find({ reportingTo: req.user._id }).select("_id");
        const deptUserIds = deptUsers.map((u) => u._id);

        const filter = { assignedTo: { $in: deptUserIds } };

        const total = await Task.countDocuments(filter);
        const pending = await Task.countDocuments({ ...filter, status: "pending" });
        const inProgress = await Task.countDocuments({ ...filter, status: "in-progress" });
        const done = await Task.countDocuments({ ...filter, status: "done" });
        const overdue = await Task.countDocuments({
            ...filter,
            status: { $ne: "done" },
            dueDate: { $lt: new Date() },
        });

        res.status(200).json({
            success: true,
            stats: { total, pending, inProgress, done, overdue },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTask,
    getMyTasks,
    getDepartmentTasks,
    getDepartmentMembers,
    getAllTasks,
    getAllDepartments,
    getSingleTask,
    updateTaskStatus,
    updateTask,
    deleteTask,
    getTaskStats,
    getDeptStats,
};