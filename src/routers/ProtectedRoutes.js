const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');

// Protected admin routes - ต้องผ่านทั้ง authentication และเป็น admin
router.get('/admin', authenticateToken, isAdmin, (req, res) => {
    try {
        res.json({ 
            message: 'ยินดีต้อนรับสู่หน้าผู้ดูแลระบบ', 
            user: {
                id: req.user.userId,
                username: req.user.username,
                role: req.user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});


router.get('/user', authenticateToken, (req, res) => {
    try {
        res.json({
            message: 'ข้อมูลผู้ใช้',
            user: {
                id: req.user.userId,
                username: req.user.username,
                role: req.user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});


module.exports = router;
