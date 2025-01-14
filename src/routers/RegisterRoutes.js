const express = require('express');
const router = express.Router();
const registerController = require('../controller/RegisterController');
const isAdmin = require('../middleware/adminMiddleware');

// เส้นทางสำหรับการ register
router.post('/register', isAdmin, registerController.register);

module.exports = router;
