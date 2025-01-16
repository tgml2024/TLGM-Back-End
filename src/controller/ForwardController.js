const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const db = require('../../db');

const CLIENT_TIMEOUT = 1000 * 60 * 60; // 1 hour in milliseconds
const CLEANUP_INTERVAL = 1000 * 60 * 15; // run cleanup every 15 minutes

const clientsMap = new Map(); // Map<userId, { client, createdAt, lastUsed }>
const intervalsMap = new Map();
const messagesMap = new Map();
const userBatchSizesMap = new Map(); // Map<userId, currentBatchSize>
const groupCooldowns = new Map();
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

const rateLimiter = new Map(); // Map<userId, { count, resetTime }>

const checkRateLimit = (userId) => {
  const now = Date.now();
  const userLimit = rateLimiter.get(userId);

  if (!userLimit || now >= userLimit.resetTime) {
    rateLimiter.set(userId, {
      count: 1,
      resetTime: now + 60000 // reset after 1 minute
    });
    return true;
  }

  if (userLimit.count >= RATE_LIMIT.MESSAGES_PER_MINUTE) {
    return false;
  }

  userLimit.count++;
  return true;
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

const checkNewMessages = async (client, sourceChatId) => {
  const messages = await client.getMessages(sourceChatId, { limit: 1 });
  return messages.filter(msg =>
    !msg.forwards && msg.date > (Date.now() / 1000 - 3600)
  );
};

const forwardMessage = async (client, msg, sourceChatId, destChatId) => {
  const currentTime = Date.now();
  const cooldownInfo = groupCooldowns.get(destChatId);

  // เพิ่มการเช็คว่ากำลังอยู่ใน cooldown หรือไม่
  if (cooldownInfo?.enabled && !cooldownInfo.canSendNext) {
    const waitTime = (cooldownInfo.lastMessageTime + (cooldownInfo.seconds * 1000)) - currentTime;
    if (waitTime > 0) {
      return {
        success: false,
        nextAttemptTime: cooldownInfo.lastMessageTime + (cooldownInfo.seconds * 1000),
        error: `Still in cooldown period (${Math.ceil(waitTime/1000)}s remaining)`
      };
    }
  }

  try {
    console.log(`\n📤 กำลังส่งข้อความไปยังกลุ่ม ${destChatId}`);
    await client.forwardMessages(destChatId, {
      messages: [msg.id],
      fromPeer: sourceChatId,
    });

    // อัพเดทสถานะหลังส่งสำเร็จ
    if (!cooldownInfo) {
      // กรณีส่งครั้งแรก
      groupCooldowns.set(destChatId, {
        seconds: 0,
        enabled: false,
        lastMessageTime: currentTime,
        messageCount: 1, // เริ่มนับจำนวนข้อความ
        canSendNext: false // ครั้งต่อไปจะติด cooldown
      });
    } else {
      // กรณีส่งสำเร็จหลังรอ cooldown
      cooldownInfo.lastMessageTime = currentTime;
      cooldownInfo.messageCount += 1;
      cooldownInfo.canSendNext = false; // ครั้งต่อไปจะติด cooldown
      groupCooldowns.set(destChatId, cooldownInfo);
    }

    console.log(`✅ ส่งสำเร็จไปยังกลุ่ม ${destChatId} (ครั้งที่ ${cooldownInfo?.messageCount || 1})`);
    return { success: true };

  } catch (error) {
    if (error.message.includes('wait of')) {
      const waitSeconds = parseInt(error.message.match(/wait of (\d+) seconds/)[1]);
      console.log(`\n⚠️ พบ SLOWMODE_WAIT ในกลุ่ม ${destChatId}:`);
      console.log(`- ต้องรอ ${waitSeconds} วินาที`);
      
      // อัพเดทข้อมูล cooldown และป้องกันการ retry ทันที
      const updatedInfo = {
        seconds: waitSeconds,
        enabled: true,
        lastMessageTime: currentTime,
        messageCount: (cooldownInfo?.messageCount || 1),
        canSendNext: false // ป้องกันการ retry จนกว่าจะครบ cooldown
      };
      groupCooldowns.set(destChatId, updatedInfo);

      return {
        success: false,
        nextAttemptTime: currentTime + (waitSeconds * 1000)
      };
    }
    
    console.error(`\n❌ Error ในกลุ่ม ${destChatId}: ${error.message}`);
    return { success: false, error: error.message };
  }
};

const getGroupCooldowns = async (client, chatIds) => {
  const cooldowns = {};
  for (const chatId of chatIds) {
    try {
      const chat = await client.getEntity(chatId);
      if (chat.slowmode_seconds) {
        cooldowns[chatId] = {
          seconds: chat.slowmode_seconds,
          enabled: true,
          lastMessageTime: null,
          messageCount: 0,
          canSendNext: true,
          slowModeType: getSlowModeType(chat.slowmode_seconds)
        };
      } else {
        cooldowns[chatId] = {
          seconds: 0,
          enabled: false,
          lastMessageTime: null,
          messageCount: 0,
          canSendNext: true,
          slowModeType: 'NONE'
        };
      }
    } catch (error) {
      console.error(`❌ ไม่สามารถดึงข้อมูล cooldown ของกลุ่ม ${chatId}:`, error.message);
      cooldowns[chatId] = {
        seconds: 0,
        enabled: false,
        error: error.message,
        slowModeType: 'UNKNOWN'
      };
    }
  }
  return cooldowns;
};

// เพิ่มฟังก์ชันสำหรับระบุประเภท Slow Mode
const getSlowModeType = (seconds) => {
  switch (seconds) {
    case 0: return 'NONE';
    case 10: return '10 วินาที';
    case 30: return '30 วินาที';
    case 60: return '1 นาที';
    case 300: return '5 นาที';
    case 900: return '15 นาที';
    case 1800: return '30 นาที';
    case 3600: return '1 ชั่วโมง';
    default: return `${seconds} วินาที (Custom)`;
  }
};

const processCooldownGroups = async (client, msg, sourceChatId, cooldownGroups) => {
  try {
    console.log('\n=== เริ่มตรวจสอบกลุ่มที่ติด Cooldown ===');

    // สร้างฟังก์ชันสำหรับตรวจสอบและส่งข้อความทันทีเมื่อครบ cooldown
    const checkAndSendMessage = async (destChatId) => {
      while (cooldownGroups.has(destChatId)) {
        const now = Date.now();
        const cooldownUntil = groupCooldowns.get(destChatId);
        const timeLeft = cooldownUntil ? Math.ceil((cooldownUntil - now) / 1000) : 0;

        // ถ้าครบ cooldown + 2 วินาที
        if (!cooldownUntil || now >= cooldownUntil + 2000) {
          console.log(`\n🕒 กลุ่ม ${destChatId} ครบเวลา cooldown แล้ว`);
          console.log(`📤 กำลังส่งข้อความไปยังกลุ่ม ${destChatId}...`);

          const result = await forwardMessage(client, msg, sourceChatId, destChatId);

          if (result) {
            console.log(`✅ ส่งสำเร็จไปยังกลุ่ม ${destChatId}`);
            cooldownGroups.delete(destChatId);
            return;
          } else {
            console.log(`❌ ส่งไม่สำเร็จไปยังกลุ่ม ${destChatId}`);
            const newCooldown = groupCooldowns.get(destChatId);
            if (newCooldown) {
              console.log(`⏳ กลุ่ม ${destChatId} ได้รับ cooldown ใหม่: ${Math.ceil((newCooldown - now) / 1000)} วินาที`);
              // รอจนครบ cooldown ใหม่แล้วลองอีกครั้ง
              await new Promise(resolve => setTimeout(resolve, newCooldown - now + 2000));
            }
          }
        } else {
          // ถ้ายังไม่ครบ cooldown ให้รอจนครบแล้วลองใหม่
          console.log(`⏳ กลุ่ม ${destChatId} เหลือเวลา cooldown: ${timeLeft} วินาที`);
          await new Promise(resolve => setTimeout(resolve, cooldownUntil - now + 2000));
        }
      }
    };

    // เริ่มการตรวจสอบและส่งข้อความสำหรับทุกกลุ่มพร้อมกัน
    console.log(`\n🔄 เริ่มตรวจสอบ ${cooldownGroups.size} กลุ่มที่ติด cooldown`);
    const checkPromises = Array.from(cooldownGroups).map(destChatId =>
      checkAndSendMessage(destChatId)
    );

    // รอให้ทุกกลุ่มทำงานเสร็จ
    await Promise.all(checkPromises);

    console.log('\n✨ จบการตรวจสอบกลุ่มที่ติด Cooldown');

    // ถ้ายังมีกลุ่มที่ไม่สำเร็จ แสดงสถานะ
    if (cooldownGroups.size > 0) {
      console.log('\n📊 สรุปกลุ่มที่ยังติด cooldown:');
      for (const destChatId of cooldownGroups) {
        const cooldownUntil = groupCooldowns.get(destChatId);
        const timeLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
        console.log(`- กลุ่ม ${destChatId}: เหลือเวลา ${timeLeft} วินาที`);
      }
    }

  } catch (error) {
    console.error('❌ Error processing cooldown groups:', error);
    console.error('Error details:', error.message);
  }
};

const autoForwardMessages = async (userId, sourceChatId, destinationChatIds) => {
  const clientData = clientsMap.get(userId);
  if (!clientData) throw new Error('Client not found');

  try {
    const messages = messagesMap.get(userId);
    if (!messages || messages.length === 0) {
      throw new Error('No message found to forward');
    }
    const messageToForward = messages[0];

    // จัดกลุ่มตามสถานะ
    const now = Date.now();
    const groupsByStatus = {
      ready: [], // กลุ่มที่พร้อมส่ง (ครั้งแรกหรือครบ cooldown)
      waiting: [] // กลุ่มที่ต้องรอ cooldown
    };

    // แยกกลุ่มตามสถานะ
    for (const destChatId of destinationChatIds) {
      const cooldownInfo = groupCooldowns.get(destChatId);
      
      if (!cooldownInfo || cooldownInfo.canSendNext) {
        // กรณีที่ยังไม่เคยส่ง หรือ รอ cooldown ครบแล้ว
        groupsByStatus.ready.push(destChatId);
      } else if (cooldownInfo.seconds > 0) {
        // กรณีที่ต้องรอ cooldown
        const nextAttemptTime = cooldownInfo.lastMessageTime + (cooldownInfo.seconds * 1000);
        if (now >= nextAttemptTime) {
          groupsByStatus.ready.push(destChatId);
        } else {
          groupsByStatus.waiting.push({
            chatId: destChatId,
            readyAt: nextAttemptTime,
            cooldownSeconds: cooldownInfo.seconds,
            messageCount: cooldownInfo.messageCount
          });
        }
      }
    }

    // เรียงลำดับกลุ่มที่รอตามเวลา
    groupsByStatus.waiting.sort((a, b) => a.readyAt - b.readyAt);

    console.log('\n📊 สถานะการ Forward:');
    console.log(`✅ กลุ่มที่พร้อมส่ง: ${groupsByStatus.ready.length}`);
    console.log(`⏳ กลุ่มที่รอ cooldown: ${groupsByStatus.waiting.length}`);

    // แสดงรายละเอียดกลุ่มที่รอ
    if (groupsByStatus.waiting.length > 0) {
      console.log('\n⏳ รายการกลุ่มที่รอ cooldown:');
      groupsByStatus.waiting.forEach(({ chatId, readyAt, cooldownSeconds, messageCount }) => {
        const timeLeft = Math.ceil((readyAt - now) / 1000);
        console.log(`- กลุ่ม ${chatId}: รออีก ${timeLeft} วินาที (ส่งไปแล้ว ${messageCount} ครั้ง)`);
      });
    }

    // ส่งข้อความไปยังกลุ่มที่พร้อม
    for (const destChatId of groupsByStatus.ready) {
      const result = await forwardMessage(clientData.client, messageToForward, sourceChatId, destChatId);
      
      if (!result.success && result.nextAttemptTime) {
        groupsByStatus.waiting.push({
          chatId: destChatId,
          readyAt: result.nextAttemptTime,
          cooldownSeconds: groupCooldowns.get(destChatId)?.seconds || 0,
          messageCount: groupCooldowns.get(destChatId)?.messageCount || 1
        });
        groupsByStatus.waiting.sort((a, b) => a.readyAt - b.readyAt);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // จัดการกลุ่มที่รอ cooldown
    for (const { chatId, readyAt } of groupsByStatus.waiting) {
      const waitTime = readyAt - Date.now();
      if (waitTime > 0) {
        console.log(`\n⏳ รอ ${Math.ceil(waitTime/1000)} วินาทีก่อนส่งไปยังกลุ่ม ${chatId}`);
        await new Promise(resolve => setTimeout(resolve, waitTime + 2000));
      }
      
      const result = await forwardMessage(clientData.client, messageToForward, sourceChatId, chatId);
      if (!result.success) {
        console.log(`❌ ไม่สามารถส่งข้อความไปยังกลุ่ม ${chatId}: ${result.error || 'Unknown error'}`);
      }
    }

  } catch (error) {
    console.error('❌ Error in auto forwarding:', error);
    throw error;
  }
};

const resetUserBatchSize = (userId) => {
  userBatchSizesMap.set(userId, 4);
};

const beginForwarding = async (req, res) => {
  try {
    const { userId, sourceChatId, destinationChatIds, forward_interval = 5 } = req.body;

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

    // Clear existing intervals
    if (intervalsMap.has(userId)) {
      clearInterval(intervalsMap.get(userId));
      intervalsMap.delete(userId);
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

    // เก็บ้อความเริ่มต้น
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

    // ตรวจสอบ cooldown ของแต่ละกลุ่มก่อนเริ่ม
    const groupCooldownTimes = await getGroupCooldowns(clientData.client, destinationChatIds);

    // ถั้ง interval ใหม่สำหรับ forward ซ้ำๆ
    const intervalMs = forward_interval * 60 * 1000;
    const newInterval = setInterval(
      () => autoForwardMessages(userId, sourceChatId, destinationChatIds),
      intervalMs
    );

    intervalsMap.set(userId, newInterval);
    console.log(`Set new interval to forward every ${forward_interval} minutes`);

    // เร็บค่า interval
    userForwardIntervals.set(userId, forward_interval);

    // เริ่มส่งข้อความครั้งแรกทันที
    autoForwardMessages(userId, sourceChatId, destinationChatIds);

    res.json({
      success: true,
      message: 'Forwarding started - will repeatedly forward initial messages',
      settings: {
        forward_id: currentForwardId,
        forward_interval: forward_interval,
        initialMessageCount: initialMessages.length,
        groupCooldowns: groupCooldownTimes
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
    const currentInterval = userForwardIntervals.get(userId) || 5; // ใช้ค่าที่เก็บไว้หรือค่า default

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

const handleForwardError = async (error, userId, forwardId) => {
  console.error(`❌ Forward error for user ${userId}:`, error);

  try {
    // บันทึก error ลงฐานข้อมูล
    await db.execute(
      'INSERT INTO forward_errors (forward_id, error_message, created_at) VALUES (?, ?, NOW())',
      [forwardId, error.message]
    );

    // อัพเดทสถานะ forward เป็น error ถ้าจำเป็น
    if (error.critical) {
      await db.execute(
        'UPDATE forward SET status = 2 WHERE forward_id = ?', // 2 = error status
        [forwardId]
      );
    }

    // รีเซ็ต batch size
    resetUserBatchSize(userId);

  } catch (dbError) {
    console.error('Failed to record error:', dbError);
  }
};

const checkClientHealth = async (userId) => {
  const clientData = clientsMap.get(userId);
  if (!clientData) return false;

  try {
    // ทดสอบการเชื่อมต่อ
    const isConnected = await clientData.client.isConnected();
    if (!isConnected) {
      console.log(`🔄 Reconnecting client for user ${userId}...`);
      await clientData.client.connect();
    }
    return true;
  } catch (error) {
    console.error(`❌ Client health check failed for user ${userId}:`, error);
    return false;
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

// เพิ่มฟังก์ชันสำหรับจัดการกลุ่มตาม Slow Mode
const optimizeGroupOrder = (groups) => {
  return groups.sort((a, b) => {
    // จัดเรียงตาม priority:
    // 1. กลุ่มที่ไม่มี slow mode
    // 2. กลุ่มที่มี slow mode น้อย
    // 3. กลุ่มที่มี slow mode มาก
    const aSeconds = groupCooldowns.get(a)?.seconds || 0;
    const bSeconds = groupCooldowns.get(b)?.seconds || 0;
    return aSeconds - bSeconds;
  });
};

module.exports = {
  handleInitialize,
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus,
  getActiveForwarders,
};