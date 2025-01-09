const express = require("express");
const {
    dashboardAdminDay,
    dashboardAdminMonth,
    dashboardAdminYear
} = require("../controller/DashboardController");

const router = express.Router();

router.get("/dashboard-admin/day", dashboardAdminDay);
router.get("/dashboard-admin/month", dashboardAdminMonth);
router.get("/dashboard-admin/year", dashboardAdminYear);

module.exports = router;
