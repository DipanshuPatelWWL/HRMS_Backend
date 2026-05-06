const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const allowDepartment = require("../middleware/department.middleware");

const {
    createLead,
    sendToManager,
    getManagerLeads,
    updateLeadStatus,
    getMyLeads,
    updateLead,
} = require("../controllers/sales.report.controller");

// Sales
router.post("/createLead", protect,
    allowRoles("employee"),
    allowDepartment("Sales"),
    createLead);
router.post("/sendToManager/:id", protect,
    allowRoles("employee"),
    allowDepartment("Sales"),
    sendToManager);
router.get("/getMyLeads", protect,
    allowRoles("employee"),
    allowDepartment("Sales"),
    getMyLeads);
router.put("/updateLead/:id", protect,
    allowRoles("employee"),
    allowDepartment("Sales"),
    updateLead);

// Manager
router.get("/getManagerLeads", protect, allowRoles("manager"), getManagerLeads);
router.put("/updateLeadStatus/:id", protect, allowRoles("manager"), updateLeadStatus);

module.exports = router;