const db = require('../../db');

const getSandingGroup = async (req, res) => {
    try {
        const userId = req.query.userId;

        if (!userId) {
            return res.status(400).json({ message: "User ID is required" });
        }

        const [rows] = await db.execute(
            'SELECT sg_id, userid, sg_name, message, sg_tid FROM sendinggroup WHERE userid = ?',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "No groups found." });
        }

        res.status(200).json({ groups: rows });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch groups." });
    }
};

const postSandingGroup = async (req, res) => {
    try {
        const { userId, sg_name, message, sg_tid } = req.body;

        if (!userId || !sg_name || !message) {
            return res.status(400).json({
                message: "กรุณาระบุ userId, sg_name และ message ให้ครบถ้วน"
            });
        }

        // ตรวจสอบว่าผู้ใช้งานมี Sending Group แล้วหรือไม่
        const [existingGroup] = await db.execute(
            'SELECT sg_id FROM sendinggroup WHERE userid = ?',
            [userId]
        );

        if (existingGroup.length > 0) {
            return res.status(400).json({
                message: "ไม่สามารถเพิ่มกลุ่มได้ เนื่องจากคุณมี Sending Group อยู่แล้ว"
            });
        }

        // ตรวจสอบว่า sg_tid ซ้ำกับ rg_tid หรือไม่
        const [duplicateTid] = await db.execute(
            'SELECT rg_id FROM resivegroup WHERE userid = ? AND rg_tid = ?',
            [userId, sg_tid]
        );

        if (duplicateTid.length > 0) {
            return res.status(400).json({
                message: "ไม่สามารถเพิ่ม Sending Group ได้ เนื่องจาก sg_tid ซ้ำกับ rg_tid"
            });
        }

        // เพิ่มข้อมูลใหม่
        const [result] = await db.execute(
            'INSERT INTO sendinggroup (userid, sg_name, message, sg_tid) VALUES (?, ?, ?, ?)',
            [userId, sg_name, message, sg_tid]
        );

        res.status(201).json({
            message: "เพิ่ม Sending Group สำเร็จ",
            groupId: result.insertId
        });
    } catch (error) {
        console.error('Error in postSandingGroup:', error);
        res.status(500).json({
            message: "เกิดข้อผิดพลาดในการเพิ่ม Sending Group"
        });
    }
};

const deleteSandingGroup = async (req, res) => {
    try {
        const { sg_id, userId } = req.body;

        if (!sg_id || !userId) {
            return res.status(400).json({
                message: "กรุณาระบุ sg_id และ userId ให้ครบถ้วน"
            });
        }

        const [result] = await db.execute(
            'DELETE FROM sendinggroup WHERE sg_id = ? AND userid = ?',
            [sg_id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "ไม่พบ Sending Group ที่ต้องการลบ"
            });
        }

        res.status(200).json({
            message: "ลบ Sending Group สำเร็จ"
        });
    } catch (error) {
        console.error('Error in deleteSandingGroup:', error);
        res.status(500).json({
            message: "เกิดข้อผิดพลาดในการลบ Sending Group"
        });
    }
};

module.exports = {
    getSandingGroup,
    postSandingGroup,
    deleteSandingGroup,
};
