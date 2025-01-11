const db = require('../../db');
const bcrypt = require('bcrypt');

class ChangePasswordController {
    async changePassword(req, res) {
        try {
            const { userId, currentPassword, newPassword } = req.body;

            if (!userId || !currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'กรุณาระบุ userId, รหัสผ่านปัจจุบัน และรหัสผ่านใหม่'
                });
            }

            const [users] = await db.execute(
                'SELECT password FROM users WHERE userid = ?',
                [userId]
            );

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบผู้ใช้งานในระบบ'
                });
            }

            const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
                });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            const [result] = await db.execute(
                'UPDATE users SET password = ? WHERE userid = ?',
                [hashedPassword, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'ไม่พบผู้ใช้งานในระบบ'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'เปลี่ยนรหัสผ่านสำเร็จ'
            });

        } catch (error) {
            console.error('Error changing password:', error);
            return res.status(500).json({
                success: false,
                error: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน'
            });
        }
    }
}

module.exports = new ChangePasswordController();