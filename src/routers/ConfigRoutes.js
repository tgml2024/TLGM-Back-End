const express = require("express");
const {
    startClient,
    sendPhoneNumber,
    verifyCode,
    getChannels,
    stopClient,
    // getChannels,
} = require("../controller/ConfigController"); // ตรวจสอบ path ของไฟล์ controller
const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);

// กำหนด Routes
router.post("/start", isUser, startClient); // เริ่ม Client
router.put("/stop/:apiId", isUser, stopClient); // หยุด Client
router.post("/send-phone", isUser, sendPhoneNumber); // ส่งเบอร์โทรศัพท์
router.post("/verify-code", isUser, verifyCode); // ยืนยัน OTP
    
module.exports = router;
