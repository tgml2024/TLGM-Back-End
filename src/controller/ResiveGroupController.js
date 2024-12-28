const db = require('../../db');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const clients = {}; // Store clients in memory


// ดึงข้อมูลจากตาราง resivegroup
const getResiveGroup = async (req, res) => {
    try {
        const userId = req.query.userId;

        if (!userId) {
            return res.status(400).json({ message: "User ID is required" });
        }

        const [rows] = await db.execute(
            'SELECT rg_id, userid, rg_name, rg_tid FROM resivegroup WHERE userid = ?',
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


const postResiveGroup = async (req, res) => {
    try {
        const userId = req.user?.userId || req.body.userId;
        const { rg_name, rg_tid } = req.body;

        if (!userId || !rg_name || !rg_tid) {
            return res.status(400).json({
                errorCode: 'MISSING_FIELDS',
                message: 'กรุณาระบุ userId, rg_name และ rg_tid ให้ครบถ้วน'
            });
        }

        const [existingGroup] = await db.execute(
            'SELECT * FROM resivegroup WHERE userid = ? AND rg_tid = ?',
            [userId, rg_tid]
        );

        if (existingGroup.length > 0) {
            return res.status(400).json({
                errorCode: 'DUPLICATE_RG_TID',
                message: 'rg_tid นี้มีอยู่ในระบบแล้วสำหรับผู้ใช้นี้'
            });
        }

        const [conflictWithSendingGroup] = await db.execute(
            'SELECT * FROM sendinggroup WHERE userid = ? AND sg_tid = ?',
            [userId, rg_tid]
        );

        if (conflictWithSendingGroup.length > 0) {
            return res.status(400).json({
                errorCode: 'CONFLICT_WITH_SENDINGGROUP',
                message: 'rg_tid นี้ซ้ำกับ sg_tid ในตาราง sendinggroup'
            });
        }

        const [result] = await db.execute(
            'INSERT INTO resivegroup (userid, rg_name, rg_tid) VALUES (?, ?, ?)',
            [userId, rg_name, rg_tid]
        );

        res.status(201).json({
            message: 'เพิ่ม Resive Group สำเร็จ',
            groupId: result.insertId
        });
    } catch (error) {
        res.status(500).json({
            errorCode: 'SERVER_ERROR',
            message: 'เกิดข้อผิดพลาดในระบบ',
            details: error.message
        });
    }
};



const deleteResiveGroup = async (req, res) => {
    try {
        // ดึง `rg_id` และ `userId` จาก request
        const { rg_id } = req.params; // รับ ID กลุ่มที่ต้องการลบ
        const userId = req.user?.userId || req.body.userId; // ใช้ JWT หรือดึงจาก body

        if (!rg_id || !userId) {
            return res.status(400).json({
                message: 'กรุณาระบุ rg_id และ userId ให้ครบถ้วน'
            });
        }

        // ตรวจสอบว่ากลุ่มที่ลบเป็นของผู้ใช้คนนี้หรือไม่
        const [checkGroup] = await db.execute(
            'SELECT * FROM resivegroup WHERE rg_id = ? AND userid = ?',
            [rg_id, userId]
        );

        if (!checkGroup || checkGroup.length === 0) {
            return res.status(404).json({
                message: 'ไม่พบกลุ่มที่ต้องการลบ หรือไม่มีสิทธิ์ลบกลุ่มนี้'
            });
        }

        // ลบกลุ่ม
        const [result] = await db.execute(
            'DELETE FROM resivegroup WHERE rg_id = ? AND userid = ?',
            [rg_id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({
                message: 'ไม่สามารถลบกลุ่มได้'
            });
        }

        res.status(200).json({
            message: 'ลบ Resive Group สำเร็จ',
            groupId: rg_id
        });
    } catch (error) {
        console.error('Error in deleteResiveGroup:', error);
        res.status(500).json({
            message: 'เกิดข้อผิดพลาดในการลบ Resive Group'
        });
    }
};

const getChannels = async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required.' });
    }

    try {
        // ดึงข้อมูล user จาก database
        const [rows] = await db.execute(
            'SELECT api_id, api_hash, session_hash FROM users WHERE userid = ?',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const { api_id, api_hash, session_hash } = rows[0];
        const clientKey = `${api_id}_${userId}`; // สร้าง clientKey

        if (!clients[clientKey]) {
            try {
                const session = new StringSession(session_hash || '');
                const client = new TelegramClient(session, parseInt(api_id), api_hash, {
                    connectionRetries: 5,
                });
                await client.start();
                clients[clientKey] = client;
            } catch (error) {
                return res.status(500).json({ error: 'Failed to initialize Telegram client.' });
            }
        }

        const dialogs = [];
        for await (const dialog of clients[clientKey].iterDialogs()) {
            if (dialog.isChannel || dialog.isGroup) {
                dialogs.push({
                    id: dialog.id,
                    title: dialog.title,
                    type: dialog.isChannel ? 'channel' : 'group',
                });
            }
        }

        res.json({ channels: dialogs });
    } catch (error) {
        console.error('Error in getChannels:', error);
        res.status(500).json({ error: 'Failed to fetch channels.', details: error.message });
    }
};


module.exports = {
    getResiveGroup,
    postResiveGroup,
    deleteResiveGroup,
    getChannels
};
