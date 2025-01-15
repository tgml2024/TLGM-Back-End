const express = require('express');
const router = express.Router();
const loginController = require('../controller/LoginController');

// เส้นทางสำหรับการ login
router.post('/login', loginController.login);


module.exports = router;
