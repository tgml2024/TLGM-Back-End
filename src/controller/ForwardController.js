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

// เพิ่มตัวแปรใหม่สำหรับเก็บจำนวนครั้งที่ error และเวลาส่งของแต่ละกลุ่ม
const groupErrorCounts = new Map(); // Map<groupId, errorCount>
const groupNextSendTimes = new Map(); // Map<groupId, nextSendTime>

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

const forwardMessage = async (client, msg, sourceChatId, destChatId) => {
  try {
    // สุ่มเวลารอระหว่าง 1-10 วินาที
    const randomDelay = Math.floor(Math.random() * 10000) + 1000; // 1000-10000 ms
    console.log(`\n⏳ รอ ${randomDelay/1000} วินาที ก่อนส่งไปยังกลุ่ม ${destChatId}`);
    await new Promise(resolve => setTimeout(resolve, randomDelay));

    console.log(`\n📤 กำลังส่งข้อความไปยังกลุ่ม ${destChatId}`);
    await client.forwardMessages(destChatId, {
      messages: [msg.id],
      fromPeer: sourceChatId,
    });

    console.log(`✅ ส่งสำเร็จไปยังกลุ่ม ${destChatId}\n`);
    return true;

  } catch (error) {
    console.error(`\n❌ Error ในกลุ่ม ${destChatId}: ${error.message}\n`);
    return false;
  }
};

const autoForwardMessages = async (userId, sourceChatId, destinationChatIds) => {
  const clientData = clientsMap.get(userId);
  if (!clientData) throw new Error('Client not found');

  let totalSuccess = 0;
  let totalFailed = 0;
  const now = Date.now();

  try {
    const messages = messagesMap.get(userId);
    if (!messages || messages.length === 0) {
      throw new Error('No message found to forward');
    }
    const messageToForward = messages[0];

    // กรองเฉพาะกลุ่มที่ถึงเวลาส่ง
    const readyGroups = destinationChatIds.filter(destChatId => {
      const nextSendTime = groupNextSendTimes.get(destChatId) || 0;
      return now >= nextSendTime;
    });

    console.log(`\n📊 สถานะการ Forward:`);
    console.log(`📍 จำนวนกลุ่มทั้งหมด: ${destinationChatIds.length}`);
    console.log(`✅ กลุ่มที่พร้อมส่ง: ${readyGroups.length}`);

    // แบ่ง chunks เพื่อจัดการ rate limit
    const chunks = [];
    for (let i = 0; i < readyGroups.length; i += RATE_LIMIT.CHUNK_SIZE) {
      chunks.push(readyGroups.slice(i, i + RATE_LIMIT.CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async destChatId => {
          try {
            const result = await forwardMessage(clientData.client, messageToForward, sourceChatId, destChatId);
            
            if (result) {
              // ส่งสำเร็จ
              totalSuccess++;
              groupErrorCounts.delete(destChatId); // รีเซ็ตจำนวน error
              return { destChatId, success: true };
            } else {
              // ส่งไม่สำเร็จ
              totalFailed++;
              const errorCount = (groupErrorCounts.get(destChatId) || 0) + 1;
              groupErrorCounts.set(destChatId, errorCount);

              // ถ้า error เกิน 3 ครั้ง ให้เพิ่มเวลารอเป็น 2 เท่า
              if (errorCount >= 3) {
                const currentInterval = userForwardIntervals.get(userId) || 60;
                const nextSendTime = now + (currentInterval * 60 * 1000 * 2); // เพิ่มเวลาเป็น 2 เท่า
                groupNextSendTimes.set(destChatId, nextSendTime);
                console.log(`⚠️ กลุ่ม ${destChatId} error ครั้งที่ ${errorCount} - เพิ่มเวลารอเป็น 2 เท่า`);
              }
              return { destChatId, success: false };
            }
          } catch (error) {
            console.error(`Error forwarding to group ${destChatId}:`, error);
            return { destChatId, success: false };
          }
        })
      );

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

      // พักระหว่าง chunks เพื่อป้องกัน rate limit
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.BATCH_DELAY));
      }
    }

    console.log(`\n📊 สรุปผลการส่ง:`);
    console.log(`✅ สำเร็จ: ${totalSuccess} กลุ่ม`);
    console.log(`❌ ไม่สำเร็จ: ${totalFailed} กลุ่ม`);

  } catch (error) {
    console.error('❌ Error in auto forwarding:', error);
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
        // Suppress update loop errors
        if (client._updateLoop) {
          client._updateLoopRunning = false;
          try {
            await client._updateLoop.catch(() => { }); // Ignore update loop errors
          } catch { }
        }

        // Force close connection
        if (client._sender?.connection) {
          client._sender.connection.closed = true;
        }

        // Attempt normal disconnect
        await client.disconnect().catch(() => { });
      } catch { } finally {
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