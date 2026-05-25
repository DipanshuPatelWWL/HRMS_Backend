const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const allowDepartment = require("../middleware/department.middleware");

const {
    // EMPLOYEE
    createLead,
    updateLead,
    sendToManager,
    getMyLeads,

    // MANAGER
    getManagerLeads,
    updateLeadReviewStatus,
    assignLead,

    // SALES PIPELINE
    updateLeadStage,

    // REMARKS & FOLLOWUPS
    addRemark,
    addFollowUp,

    // TIMELINE
    getLeadTimeline,

    // DELETE
    deleteLead,
    getAssignedLeads,

} = require("../controllers/sales.report.controller");


// ─────────────────────────────────────────────
// EMPLOYEE ROUTES
// ─────────────────────────────────────────────

// CREATE LEAD
router.post(
    "/createLead",
    protect,
    allowRoles("employee", "tl"),
    allowDepartment("Sales"),
    createLead
);

// UPDATE LEAD
router.put(
    "/updateLead/:id",
    protect,
    allowRoles("employee", "tl"),
    allowDepartment("Sales"),
    updateLead
);

// SEND LEAD TO MANAGER
router.post(
    "/sendToManager/:id",
    protect,
    allowRoles("employee", "tl"),
    allowDepartment("Sales"),
    sendToManager
);

// GET MY LEADS
router.get(
    "/getMyLeads",
    protect,
    allowRoles("employee", "tl"),
    allowDepartment("Sales"),
    getMyLeads
);


// ─────────────────────────────────────────────
// MANAGER ROUTES
// ─────────────────────────────────────────────

// GET ALL LEADS
router.get(
    "/manager/leads",
    protect,
    allowRoles("manager"),
    getManagerLeads
);

// APPROVE / REJECT LEAD
router.put(
    "/manager/review/:id",
    protect,
    allowRoles("manager"),
    updateLeadReviewStatus
);

// ASSIGN LEAD
router.post(
    "/manager/assign/:id",
    protect,
    allowRoles("manager"),
    assignLead
);


router.get(
    "/assignedLeads",
    protect,
    allowRoles("employee", "tl"),
    getAssignedLeads
);

// ─────────────────────────────────────────────
// SALES PIPELINE ROUTES
// ─────────────────────────────────────────────

// UPDATE LEAD STAGE
router.put(
    "/updateLeadStage/:id",
    protect,
    updateLeadStage
);


// ─────────────────────────────────────────────
// REMARKS & FOLLOWUPS
// ─────────────────────────────────────────────

// ADD REMARK
router.post(
    "/addRemark/:id",
    protect,
    addRemark
);

// ADD FOLLOW-UP
router.post(
    "/addFollowUp/:id",
    protect,
    addFollowUp
);


// ─────────────────────────────────────────────
// TIMELINE
// ─────────────────────────────────────────────

// GET LEAD TIMELINE
router.get(
    "/leadTimeline/:id",
    protect,
    getLeadTimeline
);


// ─────────────────────────────────────────────
// DELETE LEAD
// ─────────────────────────────────────────────

// SOFT DELETE
router.delete(
    "/deleteLead/:id",
    protect,
    deleteLead
);


module.exports = router;