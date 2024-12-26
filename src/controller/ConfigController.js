const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram");
const db = require('../../db');
const clients = {}; // { clientKey: { client, apiHash, createdAt, lastUsed } }
const sessions = {}; // เก็บ session string ตาม apiId

// เพิ่ม constants สำหรับการจัดการ lifetime
const CLIENT_TIMEOUT = 1000 * 60 * 60; // 1 hour in milliseconds
const CLEANUP_INTERVAL = 1000 * 60 * 15; // run cleanup every 15 minutes

// เพิ่ม cleanup routine
const cleanupInactiveClients = async () => {
    const now = Date.now();
    for (const [clientKey, clientData] of Object.entries(clients)) {
        // ถ้า client ไม่ได้ใช้งานเกิน CLIENT_TIMEOUT
        if (now - clientData.lastUsed > CLIENT_TIMEOUT) {
            console.log(`Cleaning up inactive client: ${clientKey}`);
            try {
                await clientData.client.disconnect();
                delete clients[clientKey];
                delete sessions[clientKey];
            } catch (error) {
                console.error(`Error cleaning up client ${clientKey}:`, error);
            }
        }
    }
};

// เริ่ม cleanup routine
setInterval(cleanupInactiveClients, CLEANUP_INTERVAL);

const getChannels = async (req, res) => {
    const { apiId } = req.params;
    const { userid } = req.body;
    const clientKey = `${apiId}_${userid}`;
    const clientData = clients[clientKey];

    if (!clientData) {
        return res.status(404).json({ error: "ไม่พบ Client สำหรับ API_ID และ USER_ID นี้" });
    }

    try {
        // อัพเดท lastUsed timestamp
        clientData.lastUsed = Date.now();
        
        const dialogs = [];
        for await (const dialog of clientData.client.iterDialogs()) {
            if (dialog.isChannel || dialog.isGroup) {
                dialogs.push({
                    id: dialog.id,
                    title: dialog.title,
                    type: dialog.isChannel ? 'channel' : 'group'
                });
            }
        }

        res.json({
            message: "ดึงข้อมูล Channels และ Groups สำเร็จ",
            channels: dialogs,
        });
    } catch (error) {
        console.error("Error in getChannels:", error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล Channels", details: error.message });
    }
};

const formatPhoneNumber = (phoneNumber) => {
    // ตรวจสอบว่าหมายเลขขึ้นต้นด้วย '0'
    if (phoneNumber.startsWith('0')) {
      return '+66' + phoneNumber.slice(1); // แปลง '0' เป็น '+66'
    }
    return phoneNumber; // หากไม่มี '0' คงหมายเลขเดิม
};

  
// สร้าง Telegram Client พร้อมรองรับ session string
const createClient = async (apiId, apiHash, sessionString = "", userid) => {
    // สร้าง session string ที่เป็นเอกลักษณ์สำหรับแต่ละ user
    const uniqueSession = new StringSession(sessionString);
    const client = new TelegramClient(uniqueSession, parseInt(apiId), apiHash, {
        connectionRetries: 5,
    });
    await client.connect();
    return { client, session: uniqueSession };
};

const startClient = async (req, res) => {
    const { apiId, apiHash, userid } = req.body;

    if (!apiId || !apiHash || !userid) {
        return res.status(400).json({ error: "API_ID, API_HASH และ USER_ID เป็นสิ่งจำเป็น" });
    }

    try {
        const clientKey = `${apiId}_${userid}`;
        const now = Date.now();
        
        // ตรวจสอบ client ที่มีอยู่
        if (clients[clientKey] && clients[clientKey].client.connected) {
            // อัพเดท lastUsed timestamp
            clients[clientKey].lastUsed = now;
            return res.json({ 
                message: "Client กำลังทำงานอยู่แล้ว",
                apiId,
                sessionHash: sessions[clientKey],
                isAuthorized: await clients[clientKey].client.isUserAuthorized(),
                needsVerification: false,
                createdAt: clients[clientKey].createdAt,
                lastUsed: clients[clientKey].lastUsed
            });
        }

        // ตรวจสอบ session ที่มีอยู่ในฐานข้อมูล
        const [rows] = await db.execute(
            'SELECT session_hash, telegram_auth FROM users WHERE userid = ?',
            [userid]
        );

        let sessionString = "";

        // ถ้ามี session และ verified แล้ว ให้ใช้ session เดิม
        if (rows.length > 0 && rows[0].session_hash && rows[0].telegram_auth === 1) {
            sessionString = rows[0].session_hash;
            console.log('Using existing session for user:', userid);
        }

        // สร้าง client ใหม่หรือใช้ session ที่มีอยู่
        const { client, session } = await createClient(apiId, apiHash, sessionString, userid);
        clients[clientKey] = { 
            client, 
            apiHash,
            createdAt: now,
            lastUsed: now
        };
        sessions[clientKey] = session.save();

        // ตรวจสอบว่า client authenticated หรือไม่
        const isAuthorized = await client.isUserAuthorized();

        res.json({ 
            message: "Client เริ่มทำงานแล้ว", 
            apiId,
            sessionHash: sessions[clientKey],
            isAuthorized,
            needsVerification: !isAuthorized,
            createdAt: now,
            lastUsed: now
        });
    } catch (error) {
        console.error("Error in startClient:", error);
        res.status(500).json({ 
            error: "เกิดข้อผิดพลาดในการเริ่มต้น Client", 
            details: error.message 
        });
    }
};


// หยุด Client และลบ session
const stopClient = async (req, res) => {
    const { apiId } = req.params;
    const { userid } = req.body;

    try {
        // อัพเดทฐานข้อมูลก่อน
        const [result] = await db.execute(
            'UPDATE users SET telegram_auth = 0, session_hash = NULL WHERE userid = ?',
            [userid]
        );

        if (result.affectedRows === 0) {
            console.error('Database Update Failed: No rows affected.');
            return res.status(404).json({ error: 'User not found or update failed.' });
        }

        // หลังจากอัพเดทฐานข้อมูลแล้ว ค่อยจัดการ client ถ้ามี
        const clientKey = `${apiId}_${userid}`;
        const clientData = clients[clientKey];

        if (clientData) {
            try {
                await clientData.client.disconnect();
            } catch (error) {
                console.warn(`Warning: Could not disconnect client ${clientKey}:`, error.message);
            }
            delete clients[clientKey];
            delete sessions[clientKey];
        }

        res.json({ message: "Client หยุดทำงานแล้ว", apiId });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการหยุด Client", details: error.message });
    }
};

const sendPhoneNumber = async (req, res) => {
    const { apiId, phoneNumber, userid } = req.body;
    const clientKey = `${apiId}_${userid}`;
    const clientData = clients[clientKey];
  
    if (!clientData) {
        return res.status(404).json({ error: "ไม่พบ Client สำหรับ API_ID และ USER_ID นี้" });
    }
  
    try {
        // อัพเดท lastUsed timestamp
        clientData.lastUsed = Date.now();

        const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
        const result = await clientData.client.invoke(new Api.auth.SendCode({
            phoneNumber: formattedPhoneNumber,
            apiId: parseInt(apiId),
            apiHash: clientData.apiHash,
            settings: new Api.CodeSettings({
                allowFlashcall: false,
                currentNumber: true,
                allowAppHash: false,
            }),
        }));
  
        res.json({ message: "ส่งรหัส OTP แล้ว", phoneCodeHash: result.phoneCodeHash });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการส่งรหัส OTP", details: error.message });
    }
};


// เพิ่มฟังก์ชันใหม่สำหรับยืนยัน OTP
const verifyCode = async (req, res) => {
    const { apiId, phoneNumber, code, phoneCodeHash, userid } = req.body;

    if (!apiId || !phoneNumber || !code || !phoneCodeHash || !userid) {
        return res.status(400).json({
            error: "ข้อมูลไม่ครบถ้วน",
            details: "กรุณาระบุ apiId, phoneNumber, code, phoneCodeHash และ userid",
        });
    }

    const clientKey = `${apiId}_${userid}`;
    const clientData = clients[clientKey];

    if (!clientData) {
        return res.status(404).json({ error: "ไม่พบ Client สำหรับ API_ID และ USER_ID นี้" });
    }

    try {
        // อัพเดท lastUsed timestamp
        clientData.lastUsed = Date.now();

        const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
        console.log('Sending to Telegram API:', {
            phoneNumber: formattedPhoneNumber,
            phoneCode: code,
            phoneCodeHash: phoneCodeHash,
        });

        const { client } = clientData;
        await client.invoke(new Api.auth.SignIn({
            phoneNumber: formattedPhoneNumber,
            phoneCode: code,
            phoneCodeHash: phoneCodeHash,
        }));

        sessions[clientKey] = client.session.save(); // ใช้ clientKey แทน apiId
        const sessionHash = sessions[clientKey];

        console.log('Updating Database...');
        const [result] = await db.execute(
            'UPDATE users SET session_hash = ?, telegram_auth = 1 WHERE userid = ?',
            [sessionHash, userid]
        );

        console.log('Database Update Result:', result);

        if (result.affectedRows === 0) {
            console.error('Database Update Failed: No rows affected.');
            return res.status(404).json({ error: 'User not found or update failed.' });
        }

        res.json({ message: "ยืนยันรหัส OTP สำเร็จ", apiId, sessionHash });
    } catch (error) {
        console.error("Error in verifyCode:", error);
        res.status(500).json({ error: "Telegram API failed", details: error.message });
    }
};


module.exports = {
    startClient,
    sendPhoneNumber, 
    verifyCode, 
    stopClient,
    getChannels
};