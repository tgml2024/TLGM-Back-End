const express = require('express');
const router = express.Router();
const userController = require('../controller/UserController');
const authenticateToken = require('../middleware/authMiddleware');

// ต้องผ่านการ authenticate ก่อนเข้าถึง routes เหล่านี้
router.use(authenticateToken);

// อัพเดทข้อมูลส่วนตัว
router.put('/profile', userController.updateProfile);

// ดึงข้อมูลส่วนตัว
router.get('/profile', userController.getProfile);


module.exports = router; 