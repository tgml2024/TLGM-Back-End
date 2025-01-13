const express = require("express");
const {
    dashboardAdminDay,
    dashboardAdminMonth,
    dashboardAdminYear,
    dashboardAdminTotal
} = require("../controller/DashboardAdminController");
const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);

router.get("/dashboard-admin/day", isUser, dashboardAdminDay);
router.get("/dashboard-admin/month", isUser, dashboardAdminMonth);
router.get("/dashboard-admin/year", isUser, dashboardAdminYear);
router.get("/dashboard-admin/total", isUser, dashboardAdminTotal);

module.exports = router;
