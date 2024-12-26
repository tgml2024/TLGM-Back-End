const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const accessToken = req.cookies.accessToken;
    
    if (!accessToken) {
        return next();
    }

    try {
        const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            // ลบ cookie เมื่อ token หมดอายุ
            res.clearCookie('accessToken', {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                path: '/'
            });
        }
        next();
    }
};

module.exports = verifyToken; 