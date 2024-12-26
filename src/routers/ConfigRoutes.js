const express = require("express");
const {
    startClient,
    sendPhoneNumber,
    verifyCode,
    getChannels,
    stopClient,
    // getChannels,
} = require("../controller/ConfigController"); // ตรวจสอบ path ของไฟล์ controller

const router = express.Router();

// กำหนด Routes
router.post("/start", startClient); // เริ่ม Client
router.put("/stop/:apiId", stopClient); // หยุด Client
router.post("/send-phone", sendPhoneNumber); // ส่งเบอร์โทรศัพท์
router.post("/verify-code", verifyCode); // ยืนยัน OTP
// router.get("/channels/:apiId", getChannels);

module.exports = router;
