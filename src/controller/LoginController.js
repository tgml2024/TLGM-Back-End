const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../db');

class LoginController {
    async login(req, res) {
        try {
            const { username, password } = req.body;
            
            const [users] = await db.execute(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            const user = users[0];
            
            if (!user) {
                return res.status(401).json({ message: 'Invalid username or password' });
            }

            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid username or password' });
            }

            const accessToken = jwt.sign(
                { userId: user.userid, username: user.username, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '15m' }
            );

            const refreshToken = jwt.sign(
                { userId: user.userid, role: user.role },
                process.env.REFRESH_TOKEN_SECRET,
                { expiresIn: '7d' }
            );

            res.cookie('accessToken', accessToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 15 * 60 * 1000,
                path: '/',
                expires: new Date(Date.now() + 15 * 60 * 1000)
            });

            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/',
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            });

            res.status(200).json({
                message: 'Login successful',
                user: {
                    id: user.userid,
                    username: user.username,
                    name: user.name,
                    role: user.role
                }
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

module.exports = new LoginController();
