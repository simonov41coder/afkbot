const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ==================== CONFIGURATION ====================
const CONFIG = {
    host: 'play.minegens.id',                
    port: 25565,                     
    version: '1.20.1',               
    
    botNames: ['SuperSusu', 'HiroHito', 'Yatta_'],

    hotbarSlot: 0,       
    menuTargetSlot: 12   
};
// =======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let activeBots = {};
let spawnQueue = [];
let isProcessingQueue = false;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function generatePasswordFromUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const uniquePart = Math.abs(hash).toString(36);
    return `McAfk_${uniquePart}_Pass!`; 
}

function enqueueSpawn(username, delay = 0) {
    if (spawnQueue.includes(username)) return; 
    
    logCombined(username, `[Queue] Added to connection queue. Standing by...`);
    spawnQueue.push(username);
    
    setTimeout(() => {
        processSpawnQueue();
    }, delay);
}

function processSpawnQueue() {
    if (isProcessingQueue || spawnQueue.length === 0) return;
    
    isProcessingQueue = true;
    const nextBot = spawnQueue.shift();
    
    createBot(nextBot);
}

function createBot(username) {
    const botPassword = generatePasswordFromUsername(username);
    let navigationInterval = null; 
    let isInSurvivalWorld = false; 
    let lastBalResponseTime = 0;

    logCombined(username, `[System] Opening network socket channel...`);

    const botOptions = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: username,
        version: CONFIG.version,
        auth: 'offline',
        connectTimeout: 20000 
    };

    const bot = mineflayer.createBot(botOptions);
    bot.isReadyToChat = false; 
    activeBots[username] = bot;

    bot.once('connect', () => {
        try {
            const socket = bot._client.socket;
            if (socket) {
                logCombined(username, `📡 [Network] Handshake completed successfully.`);
            }
        } catch (err) {
            logCombined(username, `⚠️ [Network Log Failed]: ${err.message}`);
        }
    });

    bot.on('spawn', () => {
        io.emit('bot-status', { username, status: 'Online' });
        bot.isReadyToChat = true; 
        
        logCombined(username, '🟢 Spawned in lobby! Sending authentication request...');
        setTimeout(() => {
            if (bot._client && bot._client.socket) {
                bot.chat(`/register ${botPassword}`);
            }
        }, 1500);

        runAggressiveBalanceScanner(bot, username);
    });

    bot.on('message', (jsonMsg, position) => {
        if (position === 'chat') return; 

        const message = jsonMsg.toString();
        if (message.includes('❤') || message.includes('★') || message.includes('⛨')) return;
        if (message.trim() === '') return;

        // Watch for economy balance messages to verify survival state
        const msgLower = message.toLowerCase();
        
        // Match standard patterns like "Balance:", "Money:", "$", "Coins:"
        if (msgLower.includes('balance') || msgLower.includes('money') || msgLower.includes('$') || msgLower.includes('coins')) {
            lastBalResponseTime = Date.now();
            
            if (!isInSurvivalWorld) {
                isInSurvivalWorld = true;
                logCombined(username, `⚔️ [Economy Guard Success] Valid /bal returned! Inside Survival World. Stopping lobby checks.`);
                
                clearInterval(navigationInterval); 
                isProcessingQueue = false;
                setTimeout(() => { processSpawnQueue(); }, 20000);
            }
        }

        logCombined(username, `[Server System] ${message}`);

        if (msgLower.includes('already registered') && !msgLower.includes('already logged')) {
            logCombined(username, '🔑 [Auth System] Overriding with /login prompt configuration...');
            bot.chat(`/${msgLower.includes('/') ? '' : 'login '}${botPassword}`);
        }

        if (
            msgLower.includes('too many accounts') || 
            msgLower.includes('limit reached') || 
            msgLower.includes('too many players logged in with your ip address')
        ) {
            logCombined(username, `🚨 [IP Limit] Host firewall dropped connection permanently.`);
            if (navigationInterval) clearInterval(navigationInterval);
            bot.quit('IP Limit Hit');
        }
    });

    function runAggressiveBalanceScanner(bot, username) {
        if (navigationInterval) clearInterval(navigationInterval);

        let scannerAttempts = 0;

        navigationInterval = setInterval(() => {
            if (!bot || !bot.isReadyToChat) {
                if (navigationInterval) clearInterval(navigationInterval);
                return;
            }

            if (bot.currentWindow) return;

            // Probe the server environment using your /bal strategy
            scannerAttempts++;
            logCombined(username, `🔍 [Economy Probe] Sending /bal to verify server context... (Probe #${scannerAttempts})`);
            bot.chat('/bal');

            // Give the server 1.5 seconds to reply to the /bal command. 
            // If the flag hasn't been updated by the message event listener, execute lobby bypass sequences.
            setTimeout(() => {
                const timeSinceLastBal = Date.now() - lastBalResponseTime;
                
                // If it's been more than 3.5 seconds since a valid balance payload was seen, we are definitely stuck in a hub
                if (timeSinceLastBal > 3500 && !isInSurvivalWorld) {
                    logCombined(username, `📥 [Economy Guard Failed] No balance info returned. Executing lobby bypass routine...`);
                    
                    bot.setQuickBarSlot(CONFIG.hotbarSlot);
                    setTimeout(() => {
                        if (bot.isReadyToChat && !isInSurvivalWorld) {
                            bot.activateItem(false); // Send right-click navigation hotbar packet
                            
                            if (scannerAttempts % 2 === 0) {
                                logCombined(username, `⚡ [Aggressive Route] Spamming fallback transport routes...`);
                                bot.chat('/menu');
                                bot.chat('/selector');
                                bot.chat('/server survival');
                            }
                        }
                    }, 250);
                }
            }, 1500);

        }, 4500); // Probes every 4.5 seconds
    }

    bot.on('windowOpen', async (window) => {
        logCombined(username, `📦 [WINDOW OPENED] "${window.title}" - Clicking destination node...`);
        setTimeout(async () => {
            try {
                if (bot && bot.isReadyToChat) {
                    await bot.clickWindow(CONFIG.menuTargetSlot, 0, 0);
                    logCombined(username, '✅ [UI Success] Click registered.');
                }
            } catch (err) {
                logCombined(username, `❌ [UI Exception] Click dropped: ${err.message}`);
            }
        }, 1200); 
    });

    bot.on('end', (reason) => {
        if (navigationInterval) clearInterval(navigationInterval);
        isInSurvivalWorld = false; 
        
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        io.emit('bot-status', { username, status: 'Disconnected' });
        
        logCombined(username, `🔴 Socket Closed [${reason}]. Re-routing back to queue in 30s...`);
        activeBots[username] = null;

        isProcessingQueue = false;
        enqueueSpawn(username, 30000);
    });

    bot.on('error', (err) => {
        logCombined(username, `⚠️ Network Engine Error: ${err.message}`);
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        bot.quit('Network Error');
    });
}

io.on('connection', (socket) => {
    socket.emit('sync-bot-list', Object.keys(activeBots));
    socket.on('send-command', (data) => {
        const { target, command } = data;
        const executeChat = (username) => {
            const currentBot = activeBots[username];
            if (currentBot && currentBot.isReadyToChat && currentBot._client && currentBot._client.socket) {
                currentBot.chat(command);
                logCombined(username, `📤 [OUTGOING] Sent command successfully: "${command}"`);
            } else {
                logCombined(username, `❌ [STUCK / FAILED] Command dropped: "${command}" (Reason: Bot offline or loading)`);
            }
        };
        if (target === 'all') {
            Object.keys(activeBots).forEach(username => { executeChat(username); });
        } else {
            executeChat(target);
        }
    });
});

function startApp() {
    console.log('[System] Initializing Economy Probe Spawning Matrix...');
    
    CONFIG.botNames.forEach((name) => {
        enqueueSpawn(name);
    });

    server.listen(3000, () => {
        console.log('\n======================================================');
        console.log(`🖥️ Modern Control Dashboard Active at: http://localhost:3000`);
        console.log('======================================================\n');
    });
}

startApp();

