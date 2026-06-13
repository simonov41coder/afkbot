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
    
    botNames: ['SuperSusu', 'Gerald_', 'Yatta_'],

    hotbarSlot: 0,      // First slot on the hotbar (Clock location)
    menuTargetSlot: 12  // Slot 12 inside the open chest menu (Grass Block)
};
// =======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let activeBots = {};

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

function createBot(username) {
    const botPassword = generatePasswordFromUsername(username);
    let navigationInterval = null; 
    let isInSurvivalWorld = false; 

    logCombined(username, `[System] Spawning bot via native server network interface...`);

    const botOptions = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: username,
        version: CONFIG.version,
        auth: 'offline'
    };

    const bot = mineflayer.createBot(botOptions);
    // Attach custom state flag to verify connection readiness for tracking commands
    bot.isReadyToChat = false; 
    activeBots[username] = bot;

    bot.once('connect', () => {
        try {
            const socket = bot._client.socket;
            if (socket) {
                logCombined(username, `📡 [Network] Connected successfully to ${socket.remoteAddress}:${socket.remotePort}`);
            }
        } catch (err) {
            logCombined(username, `⚠️ [Network Log Failed]: ${err.message}`);
        }
    });

    bot.on('spawn', () => {
        io.emit('bot-status', { username, status: 'Online' });
        bot.isReadyToChat = true; // Turn on ready state flag
        
        if (isInSurvivalWorld) {
            logCombined(username, '🟢 Respawn state verified. Standing by inside the sandbox environment safely.');
            return;
        }

        logCombined(username, '🟢 Spawned in lobby! Testing registration pipeline...');
        
        setTimeout(() => {
            if (!isInSurvivalWorld) bot.chat(`/register ${botPassword}`);
        }, 500);

        runNavigationScheduler(bot, username);
    });

    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString();

        if (message.includes('❤') || message.includes('★') || message.includes('⛨')) return;
        if (message.trim() === '') return;

        logCombined(username, `[Incoming Chat] ${message}`);

        const msgLower = message.toLowerCase();

        if (msgLower.includes('already registered') && !msgLower.includes('already logged')) {
            logCombined(username, '🔑 [Auth System] Account pre-registered. Overriding with clean /login command...');
            bot.chat(`/${msgLower.includes('/') ? '' : 'login '}${botPassword}`);
        }

        if (msgLower.includes('sending you to survival') || msgLower.includes('joined to survival')) {
            isInSurvivalWorld = true;
            if (navigationInterval) clearInterval(navigationInterval);
            logCombined(username, '⚔️ [System State] Survival RPG location confirmed. Lobby automation disabled.');
        }

        if (
            msgLower.includes('too many accounts') || 
            msgLower.includes('limit reached') || 
            msgLower.includes('too many players logged in with your ip address')
        ) {
            logCombined(username, `🚨 [IP Limit] The host server's IP address has hit the maximum allowance limit!`);
            if (navigationInterval) clearInterval(navigationInterval);
            isInSurvivalWorld = false;
            bot.quit('IP Limit Hit');
        }
    });

    function runNavigationScheduler(bot, username) {
        logCombined(username, `[Nav Scheduler] Actions executed. Buffering 6 seconds for server transitions...`);
        
        setTimeout(() => {
            if (!bot.currentWindow && !isInSurvivalWorld) {
                logCombined(username, `[Nav Scheduler] Executing item right-click...`);
                triggerLobbyNavigation(bot, username);
                
                let attempts = 0;
                if (navigationInterval) clearInterval(navigationInterval);
                
                navigationInterval = setInterval(() => {
                    if (bot.currentWindow || isInSurvivalWorld) {
                        clearInterval(navigationInterval);
                    } else {
                        attempts++;
                        logCombined(username, `⚠️ [Failsafe System] Menu missing (Attempt #${attempts}). Resending right-click...`);
                        triggerLobbyNavigation(bot, username);
                        
                        if (attempts === 2) bot.chat('/menu');
                        if (attempts === 3) bot.chat('/selector');
                        if (attempts >= 5) {
                            if (navigationInterval) clearInterval(navigationInterval);
                            bot.quit('Lobby Navigation Hangup');
                        }
                    }
                }, 5000);
            }
        }, 6000);
    }

    bot.on('windowOpen', async (window) => {
        if (navigationInterval) clearInterval(navigationInterval);
        logCombined(username, `📦 [WINDOW OPENED] "${window.title}"`);
        
        setTimeout(async () => {
            try {
                if (!isInSurvivalWorld) {
                    await bot.clickWindow(CONFIG.menuTargetSlot, 0, 0);
                    logCombined(username, '✅ [UI Success] Target slot clicked successfully.');
                }
            } catch (err) {
                logCombined(username, `❌ [UI Exception] Click failed: ${err.message}`);
            }
        }, 1500); 
    });

    bot.on('end', (reason) => {
        if (navigationInterval) clearInterval(navigationInterval);
        isInSurvivalWorld = false; 
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        io.emit('bot-status', { username, status: 'Disconnected' });
        
        logCombined(username, `🔴 Bot disconnected: [${reason}]. Reconnecting in 10s...`);
        activeBots[username] = null;

        setTimeout(() => {
            createBot(username);
        }, 10000); 
    });

    bot.on('error', (err) => {
        logCombined(username, `⚠️ Network Engine Error: ${err.message}`);
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        bot.quit('Network Error');
    });
}

async function triggerLobbyNavigation(bot, username) {
    try {
        bot.setQuickBarSlot(CONFIG.hotbarSlot);
        setTimeout(() => {
            const currentItem = bot.heldItem;
            if (!currentItem || currentItem.name === 'clock' || currentItem.name === 'compass') {
                logCombined(username, '[Lobby Action] Sending right-click packet...');
                bot.activateItem(false); 
            } else {
                bot.activateItem(false);
            }
        }, 500);
    } catch (err) {
        logCombined(username, `❌ Exception: ${err.message}`);
    }
}

function logCombined(username, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${username}] ${message}`);
    io.emit('chat-message', { time: timestamp, username, message });
}

io.on('connection', (socket) => {
    socket.emit('sync-bot-list', Object.keys(activeBots));
    
    Object.keys(activeBots).forEach(username => {
        const status = activeBots[username]?.spawned ? 'Online' : 'Connecting';
        socket.emit('bot-status', { username, status });
    });

    // 📤 DYNAMIC COMMAND ROUTING AND PIPELINE DELIVERY LOGGING
    socket.on('send-command', (data) => {
        const { target, command } = data;
        
        const executeChat = (username) => {
            const currentBot = activeBots[username];
            
            // Validate if instance exists and socket interface is active
            if (currentBot && currentBot.isReadyToChat && currentBot._client && currentBot._client.socket) {
                currentBot.chat(command);
                logCombined(username, `📤 [OUTGOING] Sent command successfully: "${command}"`);
            } else {
                logCombined(username, `❌ [STUCK / FAILED] Command dropped: "${command}" (Reason: Bot offline or loading)`);
            }
        };

        if (target === 'all') {
            Object.keys(activeBots).forEach(username => {
                executeChat(username);
            });
        } else {
            executeChat(target);
        }
    });
});

function startApp() {
    console.log('[System] Initializing application in native server mode...');
    
    CONFIG.botNames.forEach((name, i) => {
        setTimeout(() => {
            createBot(name);
        }, i * 5000); 
    });

    server.listen(3000, () => {
        console.log('\n======================================================');
        console.log(`🖥️ Modern Control Dashboard Active at: http://localhost:3000`);
        console.log('======================================================\n');
    });
}

startApp();

