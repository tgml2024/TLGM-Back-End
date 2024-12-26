const bcrypt = require('bcrypt');
const db = require('../../db');

class RegisterController {
    async register(req, res) {
        try {
            const { username, password, name } = req.body;

            if (!username || !password || !name) {
                return res.status(400).json({ 
                    message: 'กรุณากรอกข้อมูลให้ครบถ้วน',
                    errors: {
                        username: !username ? 'กรุณากรอกชื่อผู้ใช้' : null,
                        password: !password ? 'กรุณากรอกรหัสผ่าน' : null,
                        name: !name ? 'กรุณากรอกชื่อ' : null
                    }
                });
            }

            if (username.length < 4 || username.length > 20) {
                return res.status(400).json({ 
                    message: 'ชื่อผู้ใช้ต้องมีความยาว 4-20 ตัวอักษร' 
                });
            }

            if (password.length < 6) {
                return res.status(400).json({ 
                    message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' 
                });
            }

            const [existingUsers] = await db.execute(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );

            if (existingUsers.length > 0) {
                return res.status(400).json({ message: 'มีชื่อผู้ใช้นี้ในระบบแล้ว' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            await db.execute(
                'INSERT INTO users (username, password, name) VALUES (?, ?, ?)',
                [username, hashedPassword, name]
            );

            res.status(201).json({ message: 'ลงทะเบียนสำเร็จ' });

        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง' });
        }
    }
}

module.exports = new RegisterController(); 