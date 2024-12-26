const express = require('express');
const router = express.Router();
const registerController = require('../controller/RegisterController');

// เส้นทางสำหรับการ register
router.post('/register', registerController.register);

module.exports = router;
