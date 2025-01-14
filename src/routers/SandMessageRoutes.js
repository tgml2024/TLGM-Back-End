const router = express.Router();
const ProfileController = require('../controller/ProfileController');
const express = require("express");
const isUser = require('../middleware/userMiddleware');

// Route for sending message
router.post("/send-message", isUser, ProfileController.sendMessage);

module.exports = router;
