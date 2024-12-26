const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    if (!accessToken && !refreshToken) {
        console.log('Both access and refresh tokens are missing:', req.cookies);
        return res.status(401).json({ message: 'No tokens provided' });
    }

    if (accessToken) {
        try {
            const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (err) {
            console.error('Access token verification failed:', err);
            res.clearCookie('accessToken', { path: '/' });
            res.clearCookie('refreshToken', { path: '/' });
        }
    }

    if (refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
            req.user = decoded;
            
            const newAccessToken = jwt.sign(
                { 
                    userId: decoded.userId,
                    role: decoded.role
                },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.cookie('accessToken', newAccessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 3600000
            });

            return next();
        } catch (err) {
            console.error('Refresh token verification failed:', err);
            res.clearCookie('accessToken', { path: '/' });
            res.clearCookie('refreshToken', { path: '/' });
            return res.status(403).json({ message: 'Invalid refresh token' });
        }
    }

    return res.status(401).json({ message: 'Access token missing, refresh required' });
};

module.exports = authenticateToken; 