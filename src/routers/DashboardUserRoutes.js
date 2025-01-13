const express = require("express");
const {
    dashboardUserDay,
    dashboardUserMonth,
    dashboardUserYear,
    dashboardUserTotal
} = require("../controller/DashboardUserController");

const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);

router.get("/dashboard-user/day", isUser, dashboardUserDay);
router.get("/dashboard-user/month", isUser, dashboardUserMonth);
router.get("/dashboard-user/year", isUser, dashboardUserYear);
router.get("/dashboard-user/total", isUser, dashboardUserTotal);

module.exports = router;
