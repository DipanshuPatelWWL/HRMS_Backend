const express = require("express");

const router = express.Router();

const protect = require("../middleware/auth.middleware");

const allowRoles = require("../middleware/role.middleware");

const {
    createCelebration,
    getUpcomingCelebrations,
    updateCelebration,
    deleteCelebration,
    getAllCelebrations,
} = require("../controllers/celebration.controller");

router.post(
    "/create",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    createCelebration
);

router.get(
    "/upcoming",
    protect,
    getUpcomingCelebrations
);

router.get(
    "/",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    getAllCelebrations
);

router.put(
    "/update/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    updateCelebration
);

router.delete(
    "/delete/:id",
    protect,
    allowRoles("hr", "manager", "superadmin"),
    deleteCelebration
);

module.exports = router;