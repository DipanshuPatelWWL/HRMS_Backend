const express = require("express");
const router = express.Router();
const {
    getAllTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
} = require("../controllers/celebrationTemplate.controller");

// Add your auth middleware here if needed, e.g.:
// const { protect } = require("../middleware/auth");

router.get("/", getAllTemplates);
router.get("/:id", getTemplate);
router.post("/create", createTemplate);
router.put("/update/:id", updateTemplate);
router.delete("/delete/:id", deleteTemplate);

module.exports = router;