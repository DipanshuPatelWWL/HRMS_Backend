// ================= hr.ai.routes.js =================

const express = require("express");
const router = express.Router();

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

const {
    getUnansweredQuestions,
    answerQuestion,
    deleteUnansweredQuestion,   // ✅ import
} = require("../controllers/hr.ai.controller");

// GET all pending questions
router.get(
    "/unanswered",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getUnansweredQuestions
);

// POST answer a question
router.post(
    "/answer/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    answerQuestion
);

// ✅ DELETE a question permanently
router.delete(
    "/unanswered/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteUnansweredQuestion
);

module.exports = router;