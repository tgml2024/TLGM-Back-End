const { 
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus,
  handleInitialize,
} = require("../controller/ForwardController");
const express = require('express');
const router = express.Router();
const isAdmin = require('../middleware/adminMiddleware');
const isUser = require('../middleware/userMiddleware');

// Remove unused routes and add new beginForwarding route
router.post("/begin-forwarding", isUser,beginForwarding);
router.post("/stop-continuous-forward", isUser,stopContinuousAutoForward);
router.post("/initialize", isUser,handleInitialize);
router.post("/check-forwarding-status", isUser,checkForwardingStatus);



module.exports = router;
