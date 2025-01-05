const db = require('../../db');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const CLIENT_TIMEOUT = 1000 * 60 * 60; // 1 hour in milliseconds
const CLEANUP_INTERVAL = 1000 * 60 * 15; // 15 minutes
const RATE_LIMIT = {
    MESSAGES_PER_MINUTE: 20,
    COOLDOWN_BUFFER: 2000, // 2 seconds
};

const clientsMap = new Map();
const intervalsMap = new Map();
const groupCooldowns = new Map();
const userBatchSizesMap = new Map();
const rateLimiter = new Map();

const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, clientData] of clientsMap.entries()) {
        if (now - clientData.lastUsed > CLIENT_TIMEOUT) {
            new SandMessageController().cleanupResources(userId);
        }
    }
}, CLEANUP_INTERVAL);

class SandMessageController {
    async sendMessage(req, res) {
        try {
            const { userId, message, destinationChatIds, send_interval = 5 } = req.body;

            // Validate required fields
            if (!userId || !message || !destinationChatIds) {
                return res.status(400).json({
                    error: 'Missing required fields'
                });
            }

            // Validate destinationChatIds is array and not empty
            if (!Array.isArray(destinationChatIds) || destinationChatIds.length === 0) {
                return res.status(400).json({
                    error: 'destinationChatIds must be a non-empty array'
                });
            }

            // Initialize client if not exists
            let clientData = clientsMap.get(userId);
            if (!clientData) {
                try {
                    await this.initializeClient(userId);
                    clientData = clientsMap.get(userId);
                } catch (error) {
                    return res.status(400).json({ 
                        error: 'Failed to initialize client' 
                    });
                }
            }

            // Validate interval
            if (send_interval < 1 || send_interval > 60) {
                return res.status(400).json({
                    error: 'Invalid send_interval (1-60 minutes)'
                });
            }

            // Create sending record in database (removed message field)
            const [result] = await db.execute(
                'INSERT INTO sandmessage (userid, status, send_interval) VALUES (?, 1, ?)',
                [userId, send_interval]
            );
            const sendId = result.insertId;

            // Clear existing interval if any
            if (intervalsMap.has(userId)) {
                clearInterval(intervalsMap.get(userId));
            }

            // Set new interval for repeated sending
            const intervalMs = send_interval * 60 * 1000;
            const newInterval = setInterval(
                () => this.autoSendMessages(userId, message, destinationChatIds, sendId),
                intervalMs
            );

            intervalsMap.set(userId, newInterval);

            // Start first send immediately
            this.autoSendMessages(userId, message, destinationChatIds, sendId);

            res.json({
                success: true,
                message: 'Message sending started',
                settings: {
                    send_id: sendId,
                    send_interval: send_interval
                }
            });

        } catch (error) {
            console.error('Error in sendMessage:', error);
            res.status(500).json({ 
                error: error.message,
                details: error.stack
            });
        }
    }

    // Helper methods similar to ForwardController
    async initializeClient(userId) {
        // Similar implementation as ForwardController's initializeClient
        const userData = await this.getUserFromDatabase(userId);
        if (!userData) {
            throw new Error('User not found');
        }

        const client = new TelegramClient(
            new StringSession(userData.sessionString),
            userData.apiId,
            userData.apiHash,
            { connectionRetries: 5 }
        );

        await client.connect();
        clientsMap.set(userId, {
            client,
            createdAt: Date.now(),
            lastUsed: Date.now()
        });

        return client;
    }

    async getUserFromDatabase(userId) {
        const [rows] = await db.execute(
            'SELECT userid, api_id, api_hash, session_hash FROM users WHERE userid = ?',
            [userId]
        );

        if (rows.length === 0) return null;

        return {
            userId: rows[0].userid,
            apiId: rows[0].api_id,
            apiHash: rows[0].api_hash,
            sessionString: rows[0].session_hash
        };
    }

    // Main message sending logic
    async autoSendMessages(userId, message, destinationChatIds, sendId) {
        if (!await this.checkClientConnection(userId)) {
            throw new Error('Client not connected');
        }
        
        const clientData = clientsMap.get(userId);
        if (!clientData) throw new Error('Client not found');

        try {
            clientData.lastUsed = Date.now();
            console.log('\n=== Starting Message Send Process ===');

            const chunkSize = 20;
            const chunks = [];
            const cooldownGroups = new Set();

            // Split destinations into chunks
            for (let i = 0; i < destinationChatIds.length; i += chunkSize) {
                chunks.push(destinationChatIds.slice(i, i + chunkSize));
            }

            let currentBatchSize = Math.min(userBatchSizesMap.get(userId) || 3, 3);
            console.log(`\n🔄 Split sending into ${chunks.length} chunks (${chunkSize} groups/chunk)`);
            console.log(`📦 Batch size: ${currentBatchSize} chunks/round`);

            // Process chunks in batches
            for (let i = 0; i < chunks.length; i += currentBatchSize) {
                console.log(`\n=== Round ${Math.floor(i/currentBatchSize) + 1} ===`);
                
                const currentBatch = chunks.slice(i, i + currentBatchSize);
                const totalGroupsInBatch = currentBatch.reduce((sum, chunk) => sum + chunk.length, 0);
                
                console.log(`\n📤 Sending to ${totalGroupsInBatch} groups...`);

                const results = await Promise.all(
                    currentBatch.flatMap(chunk =>
                        chunk.map(async destChatId => {
                            try {
                                await clientData.client.sendMessage(destChatId, { message });
                                console.log(`✅ Successfully sent to group ${destChatId}`);
                                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.COOLDOWN_BUFFER));
                                return true;
                            } catch (error) {
                                console.error(`❌ Failed to send to group ${destChatId}:`, error.message);
                                if (error.message.includes('SLOWMODE_WAIT')) {
                                    const cooldownTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                                    groupCooldowns.set(destChatId, Date.now() + cooldownTime);
                                    cooldownGroups.add(destChatId);
                                }
                                return false;
                            }
                        })
                    )
                );

                const successCount = results.filter(r => r).length;
                const failedCount = results.filter(r => !r).length;

                // Record batch results in database
                try {
                    await db.execute(
                        'INSERT INTO sendmessage_detail (send_id, success_count, fail_count) VALUES (?, ?, ?)',
                        [sendId, successCount, failedCount]
                    );
                } catch (dbError) {
                    console.error('Error recording batch results:', dbError);
                }

                console.log(`\n📊 Round summary:`);
                console.log(`✅ Success: ${successCount} groups`);
                console.log(`❌ Failed: ${failedCount} groups`);

                // Adjust batch size based on results
                if (successCount > failedCount * 2) {
                    currentBatchSize = Math.min(currentBatchSize + 1, 5);
                    userBatchSizesMap.set(userId, currentBatchSize);
                } else if (failedCount > successCount) {
                    currentBatchSize = Math.max(currentBatchSize - 1, 1);
                    userBatchSizesMap.set(userId, currentBatchSize);
                }

                // Add delay between batches
                if (i + currentBatchSize < chunks.length) {
                    const delayTime = 5000;
                    console.log(`\n⏱️ Waiting ${delayTime/1000} seconds before next round...`);
                    await new Promise(resolve => setTimeout(resolve, delayTime));
                }
            }

            // Handle cooldown groups if any
            if (cooldownGroups.size > 0) {
                console.log(`\n⏳ ${cooldownGroups.size} groups in cooldown, starting separate sending`);
                await this.processCooldownGroups(clientData.client, message, cooldownGroups, sendId);
            }

            console.log('\n=== Message Send Process Completed ===\n');
            return true;

        } catch (error) {
            console.error('❌ Error in auto sending:', error);
            throw error;
        }
    }

    async processCooldownGroups(client, message, cooldownGroups, sendId) {
        try {
            console.log('\n=== Processing Cooldown Groups ===');
            
            const checkAndSendMessage = async (destChatId) => {
                while (cooldownGroups.has(destChatId)) {
                    const now = Date.now();
                    const cooldownUntil = groupCooldowns.get(destChatId);
                    const timeLeft = cooldownUntil ? Math.ceil((cooldownUntil - now) / 1000) : 0;

                    if (!cooldownUntil || now >= cooldownUntil + 2000) {
                        console.log(`\n🕒 Group ${destChatId} cooldown completed`);
                        try {
                            await client.sendMessage(destChatId, { message });
                            console.log(`✅ Successfully sent to group ${destChatId}`);
                            cooldownGroups.delete(destChatId);
                            
                            // Record success in database
                            await db.execute(
                                'INSERT INTO sendmessage_detail (send_id, success_count, fail_count) VALUES (?, 1, 0)',
                                [sendId]
                            );
                            
                            return;
                        } catch (error) {
                            console.log(`❌ Failed to send to group ${destChatId}`);
                            if (error.message.includes('SLOWMODE_WAIT')) {
                                const newCooldown = parseInt(error.message.match(/\d+/)[0]) * 1000;
                                groupCooldowns.set(destChatId, Date.now() + newCooldown);
                                await new Promise(resolve => setTimeout(resolve, newCooldown + 2000));
                            }
                            
                            // Record failure in database
                            await db.execute(
                                'INSERT INTO sendmessage_detail (send_id, success_count, fail_count) VALUES (?, 0, 1)',
                                [sendId]
                            );
                        }
                    } else {
                        console.log(`⏳ Group ${destChatId} cooldown: ${timeLeft} seconds remaining`);
                        await new Promise(resolve => setTimeout(resolve, cooldownUntil - now + 2000));
                    }
                }
            };

            const checkPromises = Array.from(cooldownGroups).map(destChatId => 
                checkAndSendMessage(destChatId)
            );

            await Promise.all(checkPromises);
            
            console.log('\n✨ Cooldown Groups Processing Completed');
        } catch (error) {
            console.error('❌ Error processing cooldown groups:', error);
            console.error('Error details:', error.message);
        }
    }

    async stopSendMessage(req, res) {
        try {
            const { userId } = req.body;

            // Clear interval
            if (intervalsMap.has(userId)) {
                clearInterval(intervalsMap.get(userId));
                intervalsMap.delete(userId);
            }

            // Update status in database
            await db.execute(
                'UPDATE sandmessage SET status = 0, last_update = CURRENT_TIMESTAMP WHERE userid = ? AND status = 1',
                [userId]
            );

            res.json({
                success: true,
                message: 'Message sending stopped successfully'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async checkSendStatus(req, res) {
        try {
            const { userId } = req.body;

            const [rows] = await db.execute(
                'SELECT send_id, status, send_interval, created_at, last_update FROM sandmessage WHERE userid = ? AND status = 1',
                [userId]
            );

            const isSending = intervalsMap.has(userId);
            const clientData = clientsMap.get(userId);

            res.json({
                success: true,
                status: isSending ? 1 : 0,
                currentSend: rows[0] || null,
                clientInfo: clientData ? {
                    createdAt: new Date(clientData.createdAt).toISOString(),
                    lastUsed: new Date(clientData.lastUsed).toISOString(),
                    uptime: Date.now() - clientData.createdAt,
                    isConnected: !!clientData.client
                } : null
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async cleanupResources(userId) {
        try {
            const clientData = clientsMap.get(userId);
            if (clientData?.client) {
                await clientData.client.disconnect();
            }
            
            // Clear all maps
            clientsMap.delete(userId);
            intervalsMap.delete(userId);
            userBatchSizesMap.delete(userId);
            
            // Update database status
            await db.execute(
                'UPDATE sandmessage SET status = 0, last_update = CURRENT_TIMESTAMP WHERE userid = ? AND status = 1',
                [userId]
            );
            
            console.log(`🧹 Cleaned up resources for user ${userId}`);
        } catch (error) {
            console.error(`❌ Error cleaning up resources for user ${userId}:`, error);
        }
    }

    checkRateLimit(userId) {
        const now = Date.now();
        const userLimit = rateLimiter.get(userId);
        
        if (!userLimit || now >= userLimit.resetTime) {
            rateLimiter.set(userId, {
                count: 1,
                resetTime: now + 60000,
                lastRequest: now
            });
            return true;
        }
        
        // Add minimum delay between requests
        const timeSinceLastRequest = now - userLimit.lastRequest;
        if (timeSinceLastRequest < RATE_LIMIT.COOLDOWN_BUFFER) {
            return false;
        }
        
        if (userLimit.count >= RATE_LIMIT.MESSAGES_PER_MINUTE) {
            return false;
        }
        
        userLimit.count++;
        userLimit.lastRequest = now;
        return true;
    }

    async handleSendError(error, userId, sendId) {
        console.error(`❌ Send error for user ${userId}:`, error);
        
        try {
            // Update status if critical error
            if (error.critical) {
                await db.execute(
                    'UPDATE sandmessage SET status = 2, last_update = CURRENT_TIMESTAMP WHERE send_id = ?',
                    [sendId]
                );
                
                // Cleanup resources
                await this.cleanupResources(userId);
            }
            
            // Reset batch size
            userBatchSizesMap.set(userId, 3);
            
        } catch (dbError) {
            console.error('Failed to handle error:', dbError);
        }
    }

    async checkClientConnection(userId) {
        const clientData = clientsMap.get(userId);
        if (!clientData?.client) return false;
        
        try {
            const isConnected = await clientData.client.isConnected();
            if (!isConnected) {
                await clientData.client.connect();
            }
            return true;
        } catch (error) {
            console.error(`Client connection check failed for user ${userId}:`, error);
            return false;
        }
    }
}

module.exports = {
    sendMessage: new SandMessageController().sendMessage.bind(new SandMessageController()),
    stopSendMessage: new SandMessageController().stopSendMessage.bind(new SandMessageController()),
    checkSendStatus: new SandMessageController().checkSendStatus.bind(new SandMessageController()),
    cleanupResources: new SandMessageController().cleanupResources.bind(new SandMessageController())
};