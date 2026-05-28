const express = require("express");
const router = express.Router();

const { signup, login, getMe, getSessions, logoutSession, logoutAllSessions } = require("../controllers/auth.controller");
const protect = require("../middleware/auth.middleware");

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", protect, getMe);
router.get("/sessions", protect, getSessions);
router.delete("/sessions/:sessionId", protect, logoutSession);
router.post("/sessions/logout-all", protect, logoutAllSessions);

module.exports = router;