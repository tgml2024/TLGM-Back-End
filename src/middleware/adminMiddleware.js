const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 1) {
        return res.status(403).json({ 
            message: 'ไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ' 
        });
    }
    next();
};

module.exports = isAdmin; 