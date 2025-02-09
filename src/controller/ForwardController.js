const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const db = require('../../db');

const CLIENT_TIMEOUT = 1000 * 60 * 60; // 1 hour in milliseconds
const CLEANUP_INTERVAL = 1000 * 60 * 15; // run cleanup every 15 minutes

const clientsMap = new Map(); // Map<userId, { client, createdAt, lastUsed }>
const intervalsMap = new Map();
const messagesMap = new Map();
const userBatchSizesMap = new Map(); // Map<userId, currentBatchSize>
const userForwardIntervals = new Map(); // เพิ่มตัวแปรนี้
let currentForwardId = null;

const RATE_LIMIT = {
  MESSAGES_PER_MINUTE: 20,
  COOLDOWN_BUFFER: 2000, // 2 seconds extra wait time
  CHUNK_SIZE: 20, // จำนวนกลุ่มต่อ chunk
  BATCH_DELAY: 5000, // delay ระหว่าง batch (5 วินาที)
  MAX_DAILY_FORWARDS: 2000, // จำกัดจำนวนการ forward ต่อวัน
  LARGE_SCALE_THRESHOLD: 100 // จำนวนกลุ่มที่ถือว่าเป็น large scale
};

// ควรเพิ่มการนับจำนวนการส่งต่อวัน
const dailyForwardCounts = new Map(); // Map<userId, { count, date }>

// เพิ่มตัวแปรสำหรับ error tracking และ cooldown
const ERROR_THRESHOLD = 5;
const COOLDOWN_TIME = 30 * 60 * 1000; // 30 นาที
const accountCooldowns = new Map(); // Map<userId, cooldownUntil>
const accountErrorCounts = new Map(); // Map<userId, errorCount>

const checkDailyLimit = (userId) => {
  const today = new Date().toDateString();
  const userStats = dailyForwardCounts.get(userId) || { count: 0, date: today };
  
  if (userStats.date !== today) {
    // รีเซ็ตเมื่อขึ้นวันใหม่
    userStats.count = 0;
    userStats.date = today;
  }
  
  return userStats.count < RATE_LIMIT.MAX_DAILY_FORWARDS;
};

const initializeClient = async (userId) => {
  try {
    const userData = await getUserFromDatabase(userId);
    if (!userData) {
      throw new Error('User not found');
    }

    const client = new TelegramClient(
      new StringSession(userData.sessionString),
      userData.apiId,
      userData.apiHash,
      {
        connectionRetries: 5,
      }
    );

    await client.connect();

    // เก็บข้อมูล timestamp
    clientsMap.set(userId, {
      client,
      createdAt: Date.now(),
      lastUsed: Date.now()
    });

    return client;
  } catch (error) {
    console.error('Error initializing client:', error);
    throw error;
  }
};

const getUserFromDatabase = async (userId) => {
  try {
    const [rows] = await db.execute(
      'SELECT userid, api_id, api_hash, session_hash FROM users WHERE userid = ?',
      [userId]
    );

    if (rows.length === 0) {
      return null;
    }

    return {
      userId: rows[0].userid,
      apiId: rows[0].api_id,
      apiHash: rows[0].api_hash,
      sessionString: rows[0].session_hash
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// เพิ่มฟังก์ชันคำนวณ delay แบบ progressive
const getProgressiveDelay = (userId) => {
  const errorCount = accountErrorCounts.get(userId) || 0;
  const baseDelay = Math.floor(Math.random() * 10000) + 3000; // 3-13 วินาที
  const multiplier = Math.min(errorCount, 3); // เพิ่มเวลารอสูงสุด 3 เท่า
  return baseDelay * (multiplier || 1);
};

// เพิ่มฟังก์ชันตรวจสอบว่าควรพักการส่งหรือไม่
const shouldPauseSending = (userId) => {
  const errorCount = accountErrorCounts.get(userId) || 0;
  const cooldownUntil = accountCooldowns.get(userId) || 0;
  const now = Date.now();

  if (now < cooldownUntil) {
    return true; // ยังอยู่ในช่วงพัก
  }

  if (errorCount >= ERROR_THRESHOLD) {
    accountCooldowns.set(userId, now + COOLDOWN_TIME);
    console.log(`⚠️ User ${userId} ถูกพักการส่ง 30 นาทีเนื่องจาก error เกิน ${ERROR_THRESHOLD} ครั้ง`);
    return true;
  }

  return false;
};

// แก้ไขฟังก์ชัน forwardMessage เพื่อใช้งาน progressive delay
const forwardMessage = async (client, msg, sourceChatId, destChatId, userId) => {
  try {
    if (shouldPauseSending(userId)) {
      console.log(`⏸️ User ${userId} อยู่ในช่วงพักการส่ง`);
      return false;
    }

    const delay = getProgressiveDelay(userId);
    console.log(`\n⏳ รอ ${delay/1000} วินาที ก่อนส่งไปยังกลุ่ม ${destChatId}`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // ตรวจสอบสถานะกลุ่มก่อนส่ง
    try {
      await client.getEntity(destChatId);
    } catch (error) {
      console.error(`❌ ไม่สามารถเข้าถึงกลุ่ม ${destChatId}`);
      return false;
    }

    console.log(`\n📤 กำลังส่งข้อความไปยังกลุ่ม ${destChatId}`);
    await client.forwardMessages(destChatId, {
      messages: [msg.id],
      fromPeer: sourceChatId,
    });

    // รีเซ็ต error count เมื่อส่งสำเร็จ
    accountErrorCounts.set(userId, 0);
    console.log(`✅ ส่งสำเร็จไปยังกลุ่ม ${destChatId}\n`);
    return true;

  } catch (error) {
    // เพิ่ม error count
    const currentErrors = (accountErrorCounts.get(userId) || 0) + 1;
    accountErrorCounts.set(userId, currentErrors);
    
    console.error(`\n❌ Error ในกลุ่ม ${destChatId}: ${error.message}`);
    console.log(`⚠️ Error count สำหรับ user ${userId}: ${currentErrors}`);
    return false;
  }
};

const autoForwardMessages = async (userId, sourceChatId, destinationChatIds) => {
  try {
    const clientData = clientsMap.get(userId);
    if (!clientData || !clientData.client) {
      throw new Error('Client not found or not initialized');
    }

    // ตรวจสอบ daily limit
    if (!checkDailyLimit(userId)) {
      console.log(`⚠️ เกิน daily limit สำหรับ user ${userId}`);
      return;
    }

    // Get stored messages
    const storedMessages = messagesMap.get(userId);
    if (!storedMessages || storedMessages.length === 0) {
      throw new Error('No message found to forward');
    }
    const messageToForward = storedMessages[0];

    // แบ่งกลุ่มเป็น chunks เล็กลง
    const SMALLER_CHUNK_SIZE = 5; // ลดขนาด chunk
    const chunks = [];
    for (let i = 0; i < destinationChatIds.length; i += SMALLER_CHUNK_SIZE) {
      chunks.push(destinationChatIds.slice(i, i + SMALLER_CHUNK_SIZE));
    }

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const chunk of chunks) {
      // ส่งแบบ sequential แทน parallel
      for (const destChatId of chunk) {
        const result = await forwardMessage(clientData.client, messageToForward, sourceChatId, destChatId, userId);
        
        // Count successes and failures
        if (result) {
          totalSuccess++;
        } else {
          totalFailed++;
        }

        // อัพเดทจำนวนการส่งรายวัน
        const userStats = dailyForwardCounts.get(userId) || { count: 0, date: new Date().toDateString() };
        userStats.count++;
        dailyForwardCounts.set(userId, userStats);

        // เพิ่ม delay ระหว่างการส่งแต่ละกลุ่ม
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
      }
      
      // บันทึกผลลัพธ์ลงฐานข้อมูล
      try {
        if (currentForwardId) {
          await db.execute(
            'INSERT INTO forward_detail (forward_id, success_count, fail_count) VALUES (?, ?, ?)',
            [currentForwardId, totalSuccess, totalFailed]
          );
        }
      } catch (dbError) {
        console.error('Error recording batch results:', dbError);
      }

      // เพิ่ม delay ระหว่าง chunks
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  } catch (error) {
    console.error('Error in auto forwarding:', error);
    throw error;
  }
};

// แก้ไข beginForwarding เพื่อรองรับการส่งตามเวลาที่ frontend กำหนด
const beginForwarding = async (req, res) => {
  const { userId, sourceChatId, destinationChatIds, forward_interval = 60 } = req.body;
  
  try {
    // ถ้ามี client เดิมอยู่ ให้ disconnect ก่อน
    const existingClientData = clientsMap.get(userId);
    if (existingClientData?.client) {
      try {
        await safeDisconnectClient(existingClientData.client);
        clientsMap.delete(userId);
      } catch (error) {
        console.warn('Error disconnecting existing client:', error);
      }
    }

    // Initialize new client
    try {
      await initializeClient(userId);
    } catch (error) {
      return res.status(400).json({
        error: 'Failed to initialize client'
      });
    }

    // Create new forward record
    try {
      const [result] = await db.execute(
        'INSERT INTO forward (userid, status, forward_interval) VALUES (?, 1, ?)',
        [userId, forward_interval]
      );
      currentForwardId = result.insertId;
      console.log(`Created new forwarding record with ID: ${currentForwardId}`);
    } catch (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Failed to create forwarding record' });
    }

    // อัพเดท lastUsed timestamp
    const clientData = clientsMap.get(userId);
    clientData.lastUsed = Date.now();

    if (forward_interval < 1 || forward_interval > 60) {
      return res.status(400).json({
        error: 'Invalid forward_interval (1-60 minutes)'
      });
    }

    // เก็บข้อความเริ่มต้น
    const initialMessages = await clientData.client.getMessages(sourceChatId, { limit: 1 });
    console.log(`Found ${initialMessages.length} message to forward repeatedly`);

    if (initialMessages.length > 0) {
      messagesMap.set(userId, [initialMessages[0]]);
      console.log('Stored initial message for repeated forwarding:', initialMessages[0].id);
    } else {
      console.log('No message found to forward');
      return res.status(400).json({
        error: 'No message found to forward'
      });
    }

    // เก็บค่า interval ที่ frontend ส่งมา
    userForwardIntervals.set(userId, forward_interval);

    // เริ่มส่งข้อความครั้งแรกทันที
    await autoForwardMessages(userId, sourceChatId, destinationChatIds);

    // ตั้ง interval สำหรับการส่งต่อเนื่อง
    const intervalId = setInterval(async () => {
      try {
        await autoForwardMessages(userId, sourceChatId, destinationChatIds);
      } catch (error) {
        console.error('Error in interval forward:', error);
      }
    }, forward_interval * 60 * 1000); // แปลงนาทีเป็นมิลลิวินาที

    // เก็บ intervalId ไว้สำหรับการหยุดในภายหลัง
    intervalsMap.set(userId, intervalId);

    res.json({
      success: true,
      message: 'Forwarding started successfully',
      settings: {
        forward_id: currentForwardId,
        forward_interval: forward_interval
      }
    });
  } catch (error) {
    console.error('Error in beginForwarding:', error);
    // Cleanup on error
    try {
      const clientData = clientsMap.get(userId);
      if (clientData?.client) {
        await safeDisconnectClient(clientData.client);
      }
      clientsMap.delete(userId);
      intervalsMap.delete(userId);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }

    res.status(500).json({ error: error.message });
  }
};

const safeDisconnectClient = async (client) => {
  return new Promise((resolve) => {
    const cleanup = async () => {
      try {
        if (client._updateLoop) {
          client._updateLoopRunning = false;
          try {
            // Silently catch update loop errors including TIMEOUT
            await client._updateLoop.catch(() => {});
          } catch {}
        }

        if (client._sender?.connection) {
          client._sender.connection.closed = true;
        }

        // Silently catch disconnect errors
        await client.disconnect().catch(() => {});
      } catch {} finally {
        resolve();
      }
    };

    cleanup();
  });
};

const stopContinuousAutoForward = async (req, res) => {
  try {
    const { userId } = req.body;

    // 1. Clear interval first to stop new operations
    if (intervalsMap.has(userId)) {
      clearInterval(intervalsMap.get(userId));
      intervalsMap.delete(userId);
    }

    // 2. Update database status
    if (currentForwardId) {
      try {
        await db.execute(
          'UPDATE forward SET status = 0 WHERE forward_id = ?',
          [currentForwardId]
        );
        currentForwardId = null;
      } catch (dbError) {
        console.error('Database error:', dbError);
      }
    }

    // 3. Safe disconnect client
    const clientData = clientsMap.get(userId);
    if (clientData?.client) {
      await safeDisconnectClient(clientData.client);
    }

    // 4. Clean up all resources
    clientsMap.delete(userId);
    messagesMap.delete(userId);
    userBatchSizesMap.delete(userId);
    userForwardIntervals.delete(userId);

    // 5. Force garbage collection
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.warn('Failed to force garbage collection');
      }
    }

    res.json({
      success: true,
      message: 'Auto-forward stopped successfully'
    });
  } catch (error) {
    console.error('Error in stopContinuousAutoForward:', error);
    res.status(500).json({
      error: 'Failed to stop auto-forward',
      details: error.message
    });
  }
};

const handleInitialize = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const client = await initializeClient(userId);

    res.json({
      success: true,
      message: 'Client initialized successfully'
    });
  } catch (error) {
    console.error('Error in initialization:', error);
    res.status(500).json({
      error: error.message
    });
  }
};

const checkForwardingStatus = async (req, res) => {
  try {
    const { userId } = req.body;

    const clientData = clientsMap.get(userId);
    if (clientData) {
      clientData.lastUsed = Date.now();
    }

    const isForwarding = intervalsMap.has(userId);
    const storedMessages = messagesMap.get(userId) || [];
    const currentInterval = userForwardIntervals.get(userId) || 60; // ใช้ค่าที่เก็บไว้หรือค่า default

    res.json({
      success: true,
      status: isForwarding ? 1 : 0,
      currentForward: {
        status: isForwarding ? 1 : 0,
        forward_interval: currentInterval, // ใช้ค่าที่เก็บไว้
        created_at: clientData?.createdAt,
        last_updated: clientData?.lastUsed
      },
      messageInfo: storedMessages[0] ? {
        messageId: storedMessages[0].id,
        text: storedMessages[0].message?.substring(0, 50) + '...',
        date: new Date(storedMessages[0].date * 1000)
      } : null,
      clientInfo: clientData ? {
        createdAt: new Date(clientData.createdAt).toISOString(),
        lastUsed: new Date(clientData.lastUsed).toISOString(),
        uptime: Date.now() - clientData.createdAt,
        isConnected: !!clientData.client
      } : null
    });

  } catch (error) {
    console.error('Error checking forwarding status:', error);
    res.status(500).json({
      error: 'Failed to check status',
      details: error.message
    });
  }
};


// เพิ่ม cleanup routine
const cleanupInactiveClients = async () => {
  const now = Date.now();
  for (const [userId, clientData] of clientsMap.entries()) {
    if (now - clientData.lastUsed > CLIENT_TIMEOUT) {
      console.log(`Cleaning up inactive client for user: ${userId}`);
      try {
        await cleanupResources(userId);
      } catch (error) {
        console.error(`Error cleaning up client for user ${userId}:`, error);
      }
    }
  }
};

// เริ่ม cleanup routine
setInterval(cleanupInactiveClients, CLEANUP_INTERVAL);

// เพิ่มฟังก์ชันสำหรับทำความสะอาด resources
const cleanupResources = async (userId) => {
  try {
    const clientData = clientsMap.get(userId);
    if (clientData?.client) {
      await clientData.client.disconnect();
    }

    // ล้าง Maps ทั้งหมดที่เกี่ยวข้องกับ user
    clientsMap.delete(userId);
    intervalsMap.delete(userId);
    messagesMap.delete(userId);
    userBatchSizesMap.delete(userId);

    console.log(`🧹 Cleaned up resources for user ${userId}`);
  } catch (error) {
    console.error(`❌ Error cleaning up resources for user ${userId}:`, error);
  }
};

const getActiveForwarders = async (req, res) => {
  try {
    // นับจำนวนนผู้ใช้ที่กำลัง forward อยู่จาก intervalsMap
    const activeForwarders = intervalsMap.size;

    res.json({
      success: true,
      activeForwarders,
    });
  } catch (error) {
    console.error('Error getting active forwarders:', error);
    res.status(500).json({
      error: 'Failed to get active forwarders count',
      details: error.message
    });
  }
};

module.exports = {
  handleInitialize,
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus,
  getActiveForwarders,
};