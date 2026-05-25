const express = require("express");
const router = express.Router();
const {
    createPolicy, publishPolicy, updatePolicy, getAllPolicies,
    getPolicyResponses, archivePolicy, restorePolicy, deletePolicy,
    getMyPolicies, getPolicyById, acknowledgePolicies,
} = require("../controllers/policy.controller");

const protect = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");

// ── Static routes FIRST (before any /:policyId) ───────────────
router.get("/my", protect, getMyPolicies);
router.post("/acknowledge", protect, acknowledgePolicies);

// ── HR / Manager routes ───────────────────────────────────────
router.post("/", protect, allowRoles("hr", "manager"), createPolicy);
router.get("/", protect, allowRoles("hr", "manager"), getAllPolicies);

// ── Dynamic /:policyId routes LAST ───────────────────────────
router.get("/:policyId/responses", protect, allowRoles("hr", "manager"), getPolicyResponses);
router.post("/:policyId/publish", protect, allowRoles("hr", "manager"), publishPolicy);
router.patch("/:policyId/archive", protect, allowRoles("hr", "manager"), archivePolicy);
router.patch("/:policyId/archive", protect, allowRoles("hr", "manager"), archivePolicy);
router.patch("/:policyId/restore", protect, allowRoles("hr", "manager"), restorePolicy);
router.delete("/:policyId", protect, allowRoles("hr", "manager"), deletePolicy);
router.put("/:policyId", protect, allowRoles("hr", "manager"), updatePolicy);
router.get("/:policyId", protect, getPolicyById);

module.exports = router;