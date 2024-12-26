class LogoutController {
    async logout(req, res) {
        try {
            res.cookie('accessToken', '', {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                expires: new Date(0)
            });

            res.cookie('refreshToken', '', {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                expires: new Date(0)
            });

            res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

module.exports = new LogoutController(); 