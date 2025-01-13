const router = express.Router();
const ProfileController = require('../controller/ProfileController');
const express = require("express");

// Route for sending message
router.post("/send-message", ProfileController.sendMessage);

module.exports = router;
