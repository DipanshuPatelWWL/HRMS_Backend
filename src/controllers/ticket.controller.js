const Ticket = require("../models/ticket.model");

// ─── CREATE TICKET (Employee) ────────────────────────────────────────────────
// const createTicket = async (req, res) => {
//     try {
//         const { title, description, category, priority } = req.body;

//         if (!title || !description) {
//             return res.status(400).json({
//                 success: false,
//                 message: "title and description are required",
//             });
//         }

//         const ticket = await Ticket.create({
//             user: req.user._id,
//             title,
//             description,
//             category: category || "other",
//             priority: priority || "medium",
//         });

//         const populated = await Ticket.findById(ticket._id)
//             .populate("user", "name email employeeId");

//         res.status(201).json({
//             success: true,
//             message: "Ticket raised successfully",
//             ticket: populated,
//         });
//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// };


const createTicket = async (req, res) => {
    try {
        const { title, description, category, priority } = req.body;

        if (!title || !description) {
            return res.status(400).json({
                success: false,
                message: "title and description are required",
            });
        }
        const ticket = await Ticket.create({
            user: req.user._id,
            title,
            description,
            category: category || "other",
            priority: priority || "medium",
        });


        const populated = await Ticket.findById(ticket._id)
            .populate("user", "name email employeeId");

        res.status(201).json({
            success: true,
            message: "Ticket raised successfully",
            ticket: populated,
        });
    } catch (error) {
        console.error("═══ createTicket ERROR ═══", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET MY TICKETS (Employee) ───────────────────────────────────────────────
const getMyTickets = async (req, res) => {
    try {
        const { status, category } = req.query;

        const filter = { user: req.user._id };
        if (status) filter.status = status;
        if (category) filter.category = category;

        const tickets = await Ticket.find(filter)
            .populate("assignedTo", "name email")
            .populate("replies.sentBy", "name role")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tickets.length,
            tickets,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL TICKETS (HR / Admin) ────────────────────────────────────────────
const getAllTickets = async (req, res) => {
    try {
        const { status, category, priority } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (priority) filter.priority = priority;

        const tickets = await Ticket.find(filter)
            .populate("user", "name email employeeId")
            .populate("assignedTo", "name email")
            .populate("replies.sentBy", "name role")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tickets.length,
            tickets,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET SINGLE TICKET ───────────────────────────────────────────────────────
const getSingleTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
            .populate("user", "name email employeeId")
            .populate("assignedTo", "name email")
            .populate("replies.sentBy", "name role")
            .populate("resolvedBy", "name email");

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        // Employee can only view their own ticket
        if (
            req.user.role === "employee" &&
            ticket.user._id.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        res.status(200).json({ success: true, ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── ADD REPLY to ticket (Both employee & HR can reply) ──────────────────────
const addReply = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "Reply message is required",
            });
        }

        const ticket = await Ticket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        // Employee can only reply to their own ticket
        if (
            req.user.role === "employee" &&
            ticket.user.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        const isStaff = ["hr", "manager", "tl", "superadmin"].includes(req.user.role);

        ticket.replies.push({
            message: message.trim(),
            sentBy: req.user._id,
            isStaff,
        });

        // Auto move to in-progress when HR replies first time
        if (isStaff && ticket.status === "open") {
            ticket.status = "in-progress";
        }

        await ticket.save();

        const populated = await Ticket.findById(ticket._id)
            .populate("user", "name email employeeId")
            .populate("assignedTo", "name email")
            .populate("replies.sentBy", "name role");

        res.status(200).json({
            success: true,
            message: "Reply added",
            ticket: populated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE TICKET STATUS (HR / Admin) ───────────────────────────────────────
const updateTicketStatus = async (req, res) => {
    try {
        const { status, assignedTo } = req.body;

        const ticket = await Ticket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        if (status) {
            ticket.status = status;

            if (status === "resolved") {
                ticket.resolvedAt = new Date();
                ticket.resolvedBy = req.user._id;
            }

            if (status === "closed") {
                ticket.closedAt = new Date();
            }
        }

        if (assignedTo !== undefined) {
            ticket.assignedTo = assignedTo || null;
        }

        await ticket.save();

        const populated = await Ticket.findById(ticket._id)
            .populate("user", "name email employeeId")
            .populate("assignedTo", "name email")
            .populate("replies.sentBy", "name role")
            .populate("resolvedBy", "name email");

        res.status(200).json({
            success: true,
            message: "Ticket updated",
            ticket: populated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CLOSE TICKET (Employee — close their own resolved ticket) ───────────────
const closeTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        if (ticket.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Not your ticket",
            });
        }

        ticket.status = "closed";
        ticket.closedAt = new Date();
        await ticket.save();

        res.status(200).json({
            success: true,
            message: "Ticket closed",
            ticket,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE TICKET (HR / Admin only) ─────────────────────────────────────────
const deleteTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findByIdAndDelete(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Ticket deleted",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET TICKET STATS (HR Dashboard) ─────────────────────────────────────────
const getTicketStats = async (req, res) => {
    try {
        const total = await Ticket.countDocuments();
        const open = await Ticket.countDocuments({ status: "open" });
        const inProgress = await Ticket.countDocuments({ status: "in-progress" });
        const resolved = await Ticket.countDocuments({ status: "resolved" });
        const closed = await Ticket.countDocuments({ status: "closed" });
        const critical = await Ticket.countDocuments({ priority: "critical", status: { $nin: ["resolved", "closed"] } });

        res.status(200).json({
            success: true,
            stats: { total, open, inProgress, resolved, closed, critical },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTicket,
    getMyTickets,
    getAllTickets,
    getSingleTicket,
    addReply,
    updateTicketStatus,
    closeTicket,
    deleteTicket,
    getTicketStats,
};