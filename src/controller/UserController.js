const db = require('../../db');

// แปลงเบอร์ 0 เป็น +66
const convertToE164 = (phone) => {
    if (!phone) return null;
    return '+66' + phone.substring(1);
};

// แปลงเบอร์ +66 กลับเป็น 0
const convertToLocalFormat = (phone) => {
    if (!phone) return null;
    return '0' + phone.substring(3); // ตัด +66 ออกและเติม 0
};

class UserController {
    async updateProfile(req, res) {
        try {
            const userId = req.user.userId; // ได้จาก middleware authentication
            const { name, phone, api_id, api_hash } = req.body;

            // ตรวจสอบข้อมูลที่ส่งมา
            if (!name || !phone || !api_id || !api_hash) {
                return res.status(400).json({
                    message: 'กรุณากรอกข้อมูลให้ครบถ้วน',
                    errors: {
                        name: !name ? 'กรุณากรอกชื่อ' : null,
                        phone: !phone ? 'กรุณากรอกเบอร์โทรศัพท์' : null,
                        api_id: !api_id ? 'กรุณากรอก API ID' : null,
                        api_hash: !api_hash ? 'กรุณากรอก API Hash' : null
                    }
                });
            }

            // ตรวจสอบรูปแบบเบอร์โทรศัพท์
            const phoneRegex = /^[0-9]{10}$/;
            if (!phoneRegex.test(phone)) {
                return res.status(400).json({
                    message: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง'
                });
            }

            // ตรวจสอบรูปแบบ API Hash
            const apiHashRegex = /^[a-f0-9]{32}$/i;
            if (!apiHashRegex.test(api_hash)) {
                return res.status(400).json({
                    message: 'รูปแบบ API Hash ไม่ถูกต้อง'
                });
            }

            // แปลงเบอร์โทรเป็นรูปแบบ +66 ก่อนเก็บในฐานข้อมูล
            const e164Phone = convertToE164(phone);

            // อัพเดทข้อมูลในฐานข้อมูล
            const [result] = await db.execute(
                'UPDATE users SET name = ?, phone = ?, api_id = ?, api_hash = ? WHERE userid = ?',
                [name, e164Phone, api_id, api_hash, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            // ดึงข้อมูลที่อัพเดทแล้ว
            const [updatedUser] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role FROM users WHERE userid = ?',
                [userId]
            );

            res.status(200).json({
                message: 'อัพเดทข้อมูลสำเร็จ',
                user: updatedUser[0]
            });

        } catch (error) {
            console.error('Update profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการอัพเดทข้อมูล'
            });
        }
    }

    async getProfile(req, res) {
        try {
            const userId = req.user.userId;
            console.log('Fetching profile for userId:', userId);

            const [rows] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role ,telegram_auth FROM users WHERE userid = ?',
                [userId]
            );
            console.log('Query result:', rows);

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            // แปลงเบอร์กลับเป็นรูปแบบ 0 ก่อนส่งให้ frontend
            if (rows[0]) {
                rows[0].phone = convertToLocalFormat(rows[0].phone);
            }

            res.status(200).json({
                user: rows[0]
            });

        } catch (error) {
            console.error('Get profile error details:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
                error: error.message
            });
        }
    }
}

module.exports = new UserController(); 