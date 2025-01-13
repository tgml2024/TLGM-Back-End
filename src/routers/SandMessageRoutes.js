const ProfileController = require('../controller/ProfileController');
const express = require("express");

const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

// Route for sending message
router.post("/send-message", isUser, ProfileController.sendMessage);

module.exports = router;
