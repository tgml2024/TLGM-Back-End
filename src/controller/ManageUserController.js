const db = require('../../db');


class ManageUserController {
    async getAdminUsers(req, res) {
        try {
            const [users] = await db.execute(
                'SELECT userid, username, name ,status FROM users WHERE role = ?',
                ['0']
            );
            
            res.status(200).json({
                users: users
            });
            
        } catch (error) {
            console.error('Get admin users error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
                error: error.message
            });
        }
    }

    async updateUserStatus(req, res) {
        try {
            const { userId, status } = req.body;

            if (![0, 1, 2].includes(Number(status))) {
                return res.status(400).json({
                    message: 'สถานะไม่ถูกต้อง (0=Active, 1=Delete, 2=Suspended)'
                });
            }

            const [result] = await db.execute(
                'UPDATE users SET status = ? WHERE userid = ?',
                [status, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'ไม่พบผู้ใช้งานที่ระบุ'
                });
            }

            res.status(200).json({
                message: 'อัพเดทสถานะเรียบร้อย'
            });

        } catch (error) {
            console.error('Update user status error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการอัพเดทสถานะ',
                error: error.message
            });
        }
    }
}

module.exports = ManageUserController;
