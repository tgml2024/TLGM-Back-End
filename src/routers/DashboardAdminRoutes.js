const express = require("express");
const {
    dashboardAdminDay,
    dashboardAdminMonth,
    dashboardAdminYear,
    dashboardAdminTotal
} = require("../controller/DashboardAdminController");
const {
    getActiveForwarders,
    // dashboardAdmin
} = require("../controller/ForwardController");

const router = express.Router();
const isAdmin = require('../middleware/adminMiddleware');
router.get("/dashboard-admin/day", isAdmin,dashboardAdminDay);
router.get("/dashboard-admin/month", isAdmin,dashboardAdminMonth);
router.get("/dashboard-admin/year", isAdmin,dashboardAdminYear);
router.get("/dashboard-admin/total", isAdmin, dashboardAdminTotal);
router.get("/get-active-forwarders", isAdmin, getActiveForwarders);

module.exports = router;
