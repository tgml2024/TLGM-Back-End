const express = require('express');
const router = express.Router();
const logoutController = require('../controller/LogoutController');

// เพิ่มเส้นทางสำหรับ logout
router.post('/logout', logoutController.logout);

module.exports = router;
