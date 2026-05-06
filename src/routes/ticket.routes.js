const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    createTicket,
    getMyTickets,
    getAllTickets,
    getSingleTicket,
    addReply,
    updateTicketStatus,
    closeTicket,
    deleteTicket,
    getTicketStats,
} = require("../controllers/ticket.controller");

// Stats — HR / Admin
router.get(
    "/stats",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getTicketStats
);

// Create ticket — any logged in user
router.post(
    "/",
    protect,
    createTicket
);

// My tickets — Employee
router.get(
    "/my",
    protect,
    getMyTickets
);

// All tickets — HR / Manager
router.get(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllTickets
);

// Single ticket
router.get(
    "/:id",
    protect,
    getSingleTicket
);

// Add reply — any logged in user
router.post(
    "/:id/reply",
    protect,
    addReply
);

// Update status / assign — HR / Manager
router.put(
    "/:id/status",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateTicketStatus
);

// Employee closes their own resolved ticket
router.put(
    "/:id/close",
    protect,
    closeTicket
);

// Delete — HR / Admin
router.delete(
    "/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteTicket
);

module.exports = router;