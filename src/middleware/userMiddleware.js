const isUser = (req, res, next) => {
    if (!req.user || req.user.role !== 0) {
        return res.status(123).json({ 
            message: 'ไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้งานทั่วไป' 
        });
    }
    next();
};

module.exports = isUser; 