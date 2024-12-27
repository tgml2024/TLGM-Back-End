const { 
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus,
  handleInitialize,
  getActiveForwarders,
  dashboardAdmin
} = require("../controller/ForwardController");
const express = require('express');
const router = express.Router();

// Remove unused routes and add new beginForwarding route
router.post("/begin-forwarding", beginForwarding);
router.post("/stop-continuous-forward", stopContinuousAutoForward);
router.post("/initialize", handleInitialize);
router.post("/check-forwarding-status", checkForwardingStatus);

router.get("/get-active-forwarders", getActiveForwarders);
router.get("/dashboard-admin", dashboardAdmin);

module.exports = router;
