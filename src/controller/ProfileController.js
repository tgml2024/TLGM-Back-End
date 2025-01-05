const db = require('../../db');

class ProfileController {
    // Get profile for logged-in user
    async getUserProfile(req, res) {
        let connection;
        try {
            connection = await db.getConnection();
            const [rows] = await connection.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [req.user.userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            const userProfile = {
                ...rows[0],
                password: undefined
            };

            res.status(200).json({
                user: userProfile
            });

        } catch (error) {
            console.error('Get user profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }

    async getAdminProfile(req, res) {
        let connection;
        try {
            connection = await db.getConnection();
            const [rows] = await connection.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [req.user.userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            const userProfile = {
                ...rows[0],
                password: undefined
            };

            res.status(200).json({
                user: userProfile
            });

        } catch (error) {
            console.error('Get user profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }

    async getProfileById(req, res) {
        let connection;
        try {
            connection = await db.getConnection();
            const [rows] = await connection.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [req.params.userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            const userProfile = {
                ...rows[0],
                password: undefined
            };

            res.status(200).json({
                user: userProfile
            });

        } catch (error) {
            console.error('Get profile by ID error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }

    async getAllProfiles(req, res) {
        let connection;
        try {
            connection = await db.getConnection();
            const [rows] = await connection.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users ORDER BY userid'
            );

            const users = rows.map(user => ({
                ...user,
                password: undefined
            }));

            res.status(200).json({
                users: users
            });

        } catch (error) {
            console.error('Get all profiles error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }

    async updateProfile(req, res) {
        let connection;
        try {
            const { name, phone, api_id, api_hash } = req.body;
            
            connection = await db.getConnection();
            const [result] = await connection.execute(
                'UPDATE users SET name = ?, phone = ?, api_id = ?, api_hash = ? WHERE userid = ?',
                [name, phone, api_id, api_hash, req.user.userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้หรือไม่สามารถอัพเดทข้อมูลได้'
                });
            }

            res.status(200).json({
                message: 'อัพเดทข้อมูลสำเร็จ'
            });

        } catch (error) {
            console.error('Update profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการอัพเดทข้อมูล'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
}

module.exports = new ProfileController(); 