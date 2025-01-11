const express = require('express');
const router = express.Router();
const userController = require('../controller/UserController');
const authenticateToken = require('../middleware/authMiddleware');
const changePasswordController = require('../controller/ChangePasswordController');

// ต้องผ่านการ authenticate ก่อนเข้าถึง routes เหล่านี้
router.use(authenticateToken);

// อัพเดทข้อมูลส่วนตัว
router.put('/profile', userController.updateProfile);

// ดึงข้อมูลส่วนตัว
router.get('/profile', userController.getProfile);

// เปลี่ยนรหัสผ่าน
router.put('/change-password', changePasswordController.changePassword);

module.exports = router; 