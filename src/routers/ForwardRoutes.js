const { 
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus,
  handleInitialize,
  getActiveForwarders,
  // dashboardAdmin
} = require("../controller/ForwardController");
const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

router.post("/begin-forwarding", isUser, beginForwarding);
router.post("/stop-continuous-forward", isUser, stopContinuousAutoForward);
router.post("/initialize", isUser, handleInitialize);
router.post("/check-forwarding-status", isUser, checkForwardingStatus);

router.get("/get-active-forwarders", isUser, getActiveForwarders);

module.exports = router;
  