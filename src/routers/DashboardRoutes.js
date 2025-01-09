const express = require("express");
const {
    dashboardAdminDay,
    dashboardAdminMonth,
    dashboardAdminYear,
    dashboardAdminTotal
} = require("../controller/DashboardController");

const router = express.Router();

router.get("/dashboard-admin/day", dashboardAdminDay);
router.get("/dashboard-admin/month", dashboardAdminMonth);
router.get("/dashboard-admin/year", dashboardAdminYear);
router.get("/dashboard-admin/total", dashboardAdminTotal);

module.exports = router;
