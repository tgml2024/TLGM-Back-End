const db = require('../../db');


class ManageUserController {
    async getAdminUsers(req, res) {
        try {
            const [users] = await db.execute(
                'SELECT userid, username, name FROM users WHERE role = ?',
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
}

module.exports = ManageUserController;
