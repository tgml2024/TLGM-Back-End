const db = require('../../db');

// Utility function to convert phone number format
const convertToLocalFormat = (phone) => {
    if (!phone) return null;
    return '0' + phone.substring(3);
};

class ProfileController {
    // Get profile for logged-in user
    async getUserProfile(req, res) {
        try {
            const userId = req.user.userId;

            const [rows] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            // Convert phone number format and clean sensitive data
            const userProfile = {
                ...rows[0],
                phone: convertToLocalFormat(rows[0].phone),
                password: undefined // Ensure password is never sent
            };

            res.status(200).json({
                user: userProfile
            });

        } catch (error) {
            console.error('Get user profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        }
    }

    async getAdminProfile(req, res) {
        try {
            const userId = req.user.userId;

            const [rows] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            // Convert phone number format and clean sensitive data
            const userProfile = {
                ...rows[0],
                phone: convertToLocalFormat(rows[0].phone),
                password: undefined // Ensure password is never sent
            };

            res.status(200).json({
                user: userProfile
            });

        } catch (error) {
            console.error('Get user profile error:', error);
            res.status(500).json({
                message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
            });
        }
    }

    // Admin can get any user's profile by userId
    async getProfileById(req, res) {
        try {
            const { userId } = req.params;

            const [rows] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users WHERE userid = ?',
                [userId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    message: 'ไม่พบข้อมูลผู้ใช้'
                });
            }

            const userProfile = {
                ...rows[0],
                phone: convertToLocalFormat(rows[0].phone),
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
        }
    }

    // Admin can get all users' profiles
    async getAllProfiles(req, res) {
        try {
            const [rows] = await db.execute(
                'SELECT userid, username, name, phone, api_id, api_hash, role, telegram_auth FROM users ORDER BY userid'
            );

            const users = rows.map(user => ({
                ...user,
                phone: convertToLocalFormat(user.phone),
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
        }
    }
}

module.exports = new ProfileController(); 