const express = require("express");
const {
    dashboardUserDay,
    dashboardUserMonth,
    dashboardUserYear,
    dashboardUserTotal
} = require("../controller/DashboardUserController");

const router = express.Router();

router.get("/dashboard-user/day", dashboardUserDay);
router.get("/dashboard-user/month", dashboardUserMonth);
router.get("/dashboard-user/year", dashboardUserYear);
router.get("/dashboard-user/total", dashboardUserTotal);

module.exports = router;
