const routes = {
  message: "TLGM API Gateway!",
  note: "โปรดดูเอกสารประกอบเกี่ยวกับวิธีการใช้ API เหล่านี้.",
  auth_endpoints: {
    "POST : /api/v1/register": "ลงทะเบียนผู้ดูแลระบบใหม่",
    "POST : /api/v1/login": "เข้าสู่ระบบสำหรับผู้ดูแลระบบที่มีอยู่แล้ว",
    "POST : /api/v1/logout": "ออกจากระบบและลบ cookie",
    "POST : /api/v1/refresh-token": "ขอ access token ใหม่โดยใช้ refresh token"
  },
  profile_endpoints: {
    "GET : /api/v1/userProfile": "ดึงข้อมูลโปรไฟล์ผู้ใช้ทั่วไป",
    "GET : /api/v1/adminProfile": "ดึงข้อมูลโปรไฟล์ผู้ดูแลระบบ"
  },
  telegram_config_endpoints: {
    "POST : /api/v1/config/start": "เริ่มต้น Telegram Client",
    "POST : /api/v1/config/stop/:apiId": "หยุด Telegram Client",
    "POST : /api/v1/config/send-phone": "ส่งเบอร์โทรศัพท์สำหรับยืนยัน Telegram",
    "POST : /api/v1/config/verify-code": "ยืนยันรหัส OTP Telegram"
  },
  telegram_group_endpoints: {
    "GET : /api/v1/receive-group": "ดึงข้อมูลกลุ่มรับข้อความ",
    "POST : /api/v1/receive-group/:rg_id": "เพิ่มกลุ่มรับข้อความ",
    "DELETE : /api/v1/receive-group/:rg_id": "ลบกลุ่มรับข้อความ",
    "POST : /api/v1/receive-group/send-message/:rg_id": "ส่งข้อความไปยังกลุ่มรับข้อความ"
  }
};

module.exports = routes;
