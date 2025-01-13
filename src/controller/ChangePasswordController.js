const db = require('../../db');
const bcrypt = require('bcrypt');

class ChangePasswordController {
    async changePassword(req, res) {
        try {
            const { userId, currentPassword, newPassword } = req.body;

            if (!userId || !currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide userId, current password, and new password',
                    message: 'Missing required fields'
                });
            }

            const [users] = await db.execute(
                'SELECT password FROM users WHERE userid = ?',
                [userId]
            );

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'The specified user does not exist'
                });
            }

            const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'Current password is incorrect',
                    message: 'Please check your current password and try again'
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
                    error: 'User not found',
                    message: 'Failed to update password. User not found'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Password has been successfully updated'
            });

        } catch (error) {
            console.error('Error changing password:', error);
            return res.status(500).json({
                success: false,
                error: 'An error occurred while changing password',
                message: 'Server error occurred. Please try again later'
            });
        }
    }
}

module.exports = new ChangePasswordController();