const express = require("express");
const ChangePasswordController = require("../controller/ChangePasswordController");
const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

router.post("/change-password", isUser, ChangePasswordController.changePassword);

module.exports = router;