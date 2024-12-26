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
  try {
    if (!checkRateLimit(sourceChatId)) {
      console.log(`Rate limit exceeded for source chat ${sourceChatId}`);
      return false;
    }

    const chat = await client.getEntity(destChatId).catch(e => null);
    if (!chat) {
      console.log(`ไม่สามารถเข้าถึงกลุ่ม ${destChatId}: กลุ่มอาจไม่มีอยู่หรือไม่ได้เป็นสมาชิก`);
      return false;
    }

    const cooldownUntil = groupCooldowns.get(destChatId);
    const now = Date.now();
    if (cooldownUntil && now < cooldownUntil) {
      console.log(`กลุ่ม ${destChatId} ยังอยู่ในช่วง cooldown อีก ${Math.ceil((cooldownUntil - now)/1000)} วินาที`);
      return false;
    }

    await client.forwardMessages(destChatId, {
      messages: [msg.id],
      fromPeer: sourceChatId,
    });
    
    if (chat.slowmode_enabled) {
      groupCooldowns.set(destChatId, now + (chat.slowmode_seconds * 1000));
      console.log(`ตั้ง cooldown ${chat.slowmode_seconds} วินาที สำหรับกลุ่ม ${destChatId}`);
    }

    console.log(`Successfully forwarded message ID: ${msg.id} to ${destChatId}`);
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.COOLDOWN_BUFFER));
    return true;
  } catch (error) {
    if (error.message.includes('PEER_ID_INVALID')) {
      console.log(`ไม่สามารถส่งข้อความไปยังกลุ่ม ${destChatId}: กลุ่มไม่ถูกต้องหรือไม่มีสิทธิ์`);
    } else {
      console.error(`Failed to forward message ${msg.id} to ${destChatId}:`, error.message);
    }
    return false;
  }
};

const getGroupCooldowns = async (client, chatIds) => {
  const cooldowns = {};
  for (const chatId of chatIds) {
    try {
      const chat = await client.getEntity(chatId);
      if (chat.slowmode_enabled) {
        cooldowns[chatId] = chat.slowmode_seconds;
      }
    } catch (error) {
      console.error(`ไม่สามารถดึงข้อมูล cooldown ของกลุ่ม ${chatId}:`, error.message);
    }
  }
  return cooldowns;
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
    // อัพเดท lastUsed timestamp
    clientData.lastUsed = Date.now();
    
    console.log('\n=== เริ่มกระบวนการ Forward ===');
    console.log(`จำนวนกลุ่มทั้งหมด: ${destinationChatIds.length} กลุ่ม`);

    const chunkSize = 20;
    const chunks = [];
    const cooldownGroups = new Set();
    
    // ดึงข้อความที่เก็บไว้จาก messagesMap
    const storedMessages = messagesMap.get(userId);
    if (!storedMessages || storedMessages.length === 0) {
      console.log('❌ ไม่พบข้อความที่เก็บไว้ใน messagesMap');
      return false;
    }
    let lastMessage = storedMessages[0];
    console.log(`📝 ข้อความที่เก็บไว้: ID ${lastMessage.id}`);
    console.log(`📄 เนื้อหา: ${lastMessage.message?.substring(0, 50)}...`);

    // แบ่งกลุ่มเป้าหมายเป็น chunks
    for (let i = 0; i < destinationChatIds.length; i += chunkSize) {
      chunks.push(destinationChatIds.slice(i, i + chunkSize));
    }

    // ใช้ batch size แบบไดนามิก
    let currentBatchSize = Math.min(userBatchSizesMap.get(userId) || 3, 3);
    console.log(`\n🔄 แบ่งการส่งเป็น ${chunks.length} chunks (${chunkSize} กลุ่ม/chunk)`);
    console.log(`📦 Batch size: ${currentBatchSize} chunks/รอบ`);

    // ส่งข้อความไปยังกลุ่มที่ไม่ติด cooldown
    for (let i = 0; i < chunks.length; i += currentBatchSize) {
      console.log(`\n=== รอบที่ ${Math.floor(i/currentBatchSize) + 1} ===`);
      
      // ดึงข้อความล่าสุดก่อนส่งในแต่ละรอบ
      console.log('🔍 ตรวจสอบข้อความใหม่...');
      const latestMessages = await checkNewMessages(clientData.client, sourceChatId);
      
      // อัพเดท lastMessage ถ้าพบข้อความใหม่
      if (latestMessages?.length > 0) {
        lastMessage = latestMessages[0];
        messagesMap.set(userId, [lastMessage]);
        console.log(`✨ พบข้อความใหม่ ID: ${lastMessage.id}`);
        console.log(`📄 เนื้อหา: ${lastMessage.message?.substring(0, 50)}...`);
      } else {
        console.log(`♻️ ใช้ข้อความเดิม ID: ${lastMessage.id}`);
      }

      const currentBatch = chunks.slice(i, i + currentBatchSize);
      const totalGroupsInBatch = currentBatch.reduce((sum, chunk) => sum + chunk.length, 0);
      
      console.log(`\n📤 กำลังส่งไปยัง ${totalGroupsInBatch} กลุ่ม...`);
      
      const results = await Promise.all(
        currentBatch.flatMap(chunk =>
          chunk.map(async destChatId => {
            const result = await forwardMessage(clientData.client, lastMessage, sourceChatId, destChatId);
            if (!result) {
              const cooldownUntil = groupCooldowns.get(destChatId);
              if (cooldownUntil) {
                cooldownGroups.add(destChatId);
                const timeLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
                console.log(`⏳ กลุ่ม ${destChatId} ติด cooldown อีก ${timeLeft} วินาที`);
              }
            } else {
              console.log(`✅ ส่งสำเร็จไปยังกลุ่ม ${destChatId}`);
            }
            return result;
          })
        )
      );

      const successCount = results.filter(r => r).length;
      const failedCount = results.filter(r => !r).length;
      
      // บันทึกผลลัพธ์ลงฐานข้อมูล
      try {
        if (currentForwardId) {
          await db.execute(
            'INSERT INTO forward_detail (forward_id, success_count, fail_count) VALUES (?, ?, ?)',
            [currentForwardId, successCount, failedCount]
          );
        }
      } catch (dbError) {
        console.error('Error recording batch results:', dbError);
      }

      console.log(`\n📊 สรุปผลการส่งรอบนี้:`);
      console.log(`✅ สำเร็จ: ${successCount} กลุ่ม`);
      console.log(`❌ ไม่สำเร็จ: ${failedCount} กลุ่ม`);

      // ปรับ batch size ตามผลลัพธ์
      if (successCount > failedCount * 2) {
        // ถ้าส่งสำเร็จมากกว่าล้มเหลว 2 เท่า เพิ่ม batch size
        currentBatchSize = Math.min(currentBatchSize + 1, 5);
        userBatchSizesMap.set(userId, currentBatchSize);
      } else if (failedCount > successCount) {
        // ถ้าล้มเหลวมากกว่าสำเร็จ ลด batch size
        currentBatchSize = Math.max(currentBatchSize - 1, 1);
        userBatchSizesMap.set(userId, currentBatchSize);
      }

      if (i + currentBatchSize < chunks.length) {
        const delayTime = 5000;
        console.log(`\n⏱️ รอ ${delayTime/1000} วินาที ก่อนส่งรอบถัดไป...`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }

    // จัดการกลุ่มที่ติด cooldown
    if (cooldownGroups.size > 0) {
      console.log(`\n⏳ มี ${cooldownGroups.size} กลุ่มที่ติด cooldown, เริ่มการส่งแยก`);
      await processCooldownGroups(clientData.client, lastMessage, sourceChatId, cooldownGroups);
    }

    console.log('\n=== จบกระบวนการ Forward ===\n');
    return true;
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
    
    // 1. เช็ค client ถ้าไม่มีให้ initialize ใหม่
    let clientData = clientsMap.get(userId);
    if (!clientData) {
      try {
        await initializeClient(userId);
        clientData = clientsMap.get(userId);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Failed to initialize client' 
        });
      }
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
    clientData.lastUsed = Date.now();

    if (forward_interval < 1 || forward_interval > 60) {
      return res.status(400).json({
        error: 'Invalid forward_interval (1-60 minutes)'
      });
    }

    // เก็บ��้อความเริ่มต้น
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

    // ถ้ามี interval เดิมอยู่ให้ยกเลิกก่อน
    if (intervalsMap.has(userId)) {
      clearInterval(intervalsMap.get(userId));
      console.log('Cleared existing interval');
    }

    // ตั้ง interval ใหม่สำหรับ forward ซ้ำๆ
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
        groupCooldowns
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const stopContinuousAutoForward = async (req, res) => {
  try {
    const { userId } = req.body;

    // Update forward record status to inactive
    if (currentForwardId) {
      try {
        await db.execute(
          'UPDATE forward SET status = 0 WHERE forward_id = ?',
          [currentForwardId]
        );
        console.log(`Updated forwarding status for ID ${currentForwardId}`);
        currentForwardId = null;
      } catch (dbError) {
        console.error('Database error:', dbError);
      }
    }

    // เรียกใช้ cleanupResources แทนการลบทีละ Map
    await cleanupResources(userId);

    // ลบค่า interval
    userForwardIntervals.delete(userId);

    res.json({ 
      success: true, 
      message: 'Auto-forward stopped successfully' 
    });
  } catch (error) {
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

module.exports = {
  handleInitialize,
  beginForwarding,
  stopContinuousAutoForward,
  checkForwardingStatus
};
