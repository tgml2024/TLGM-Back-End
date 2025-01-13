const express = require('express');
const registerController = require('../controller/RegisterController');

const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

// เส้นทางสำหรับการ register
router.post('/register', isUser, registerController.register);

module.exports = router;
