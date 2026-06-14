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

    hotbarSlot: 0,       
    menuTargetSlot: 12   
};
// =======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let activeBots = {};
// Track reconnect retry counts per bot to calculate smart waiting times
let reconnectAttempts = {}; 

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
        auth: 'offline',
        // Added standard timeout settings to prevent sockets from hanging indefinitely
        connectTimeout: 15000 
    };

    const bot = mineflayer.createBot(botOptions);
    bot.isReadyToChat = false; 
    activeBots[username] = bot;

    bot.once('connect', () => {
        try {
            const socket = bot._client.socket;
            if (socket) {
                logCombined(username, `📡 [Network] Connected successfully to ${socket.remoteAddress}:${socket.remotePort}`);
                // Reset connection attempt counters upon a successful connection handshake
                reconnectAttempts[username] = 0;
            }
        } catch (err) {
            logCombined(username, `⚠️ [Network Log Failed]: ${err.message}`);
        }
    });

    bot.on('spawn', () => {
        io.emit('bot-status', { username, status: 'Online' });
        bot.isReadyToChat = true; 
        
        logCombined(username, '🟢 Spawned! Running /register fallback...');
        setTimeout(() => {
            // Only chat if the bot socket is still open and connected
            if (bot._client && bot._client.socket) {
                bot.chat(`/register ${botPassword}`);
            }
        }, 1000);

        runAggressiveInventoryScanner(bot, username);
    });

    bot.on('message', (jsonMsg, position) => {
        if (position === 'chat') return; 

        const message = jsonMsg.toString();
        if (message.includes('❤') || message.includes('★') || message.includes('⛨')) return;
        if (message.trim() === '') return;

        logCombined(username, `[Server System] ${message}`);

        const msgLower = message.toLowerCase();

        if (msgLower.includes('already registered') && !msgLower.includes('already logged')) {
            logCombined(username, '🔑 [Auth System] Account pre-registered. Overriding with clean /login command...');
            bot.chat(`/${msgLower.includes('/') ? '' : 'login '}${botPassword}`);
        }

        if (
            msgLower.includes('too many accounts') || 
            msgLower.includes('limit reached') || 
            msgLower.includes('too many players logged in with your ip address')
        ) {
            logCombined(username, `🚨 [IP Limit] Host IP address has hit the maximum allowance limit! Stopping reconnect routine.`);
            if (navigationInterval) clearInterval(navigationInterval);
            reconnectAttempts[username] = 99; // Artificially max out attempts to prevent aggressive reconnect loop
            bot.quit('IP Limit Hit');
        }
    });

    function runAggressiveInventoryScanner(bot, username) {
        if (navigationInterval) clearInterval(navigationInterval);

        let scannerAttempts = 0;

        navigationInterval = setInterval(() => {
            // Safety Check: Break loop if bot is dead, disconnected, or logging out
            if (!bot || !bot.inventory || !bot.isReadyToChat) {
                if (navigationInterval) clearInterval(navigationInterval);
                return;
            }

            if (bot.currentWindow) return;

            const hotbarItems = bot.inventory.items();
            const lobbyItemFound = hotbarItems.some(item => 
                item.name.includes('compass') || 
                item.name.includes('clock') || 
                item.name.includes('nether_star') ||
                item.name.includes('book')
            );

            const heldItem = bot.heldItem;
            const holdingLobbyItem = heldItem && (
                heldItem.name.includes('compass') || 
                heldItem.name.includes('clock') ||
                heldItem.name.includes('nether_star') ||
                heldItem.name.includes('book')
            );

            if (lobbyItemFound || holdingLobbyItem) {
                scannerAttempts++;
                isInSurvivalWorld = false;

                logCombined(username, `📥 [Inventory Guard] Lobby item detected! Still in a hub. (Scan #${scannerAttempts})`);

                bot.setQuickBarSlot(CONFIG.hotbarSlot);

                setTimeout(() => {
                    if (bot.isReadyToChat) {
                        bot.activateItem(false); 
                        
                        if (scannerAttempts % 2 === 0) {
                            logCombined(username, `⚡ [Aggressive Route] Spamming fallback server commands...`);
                            bot.chat('/menu');
                            bot.chat('/selector');
                            bot.chat('/server survival');
                        }
                    }
                }, 200);

            } else {
                if (!isInSurvivalWorld && scannerAttempts > 0) {
                    isInSurvivalWorld = true;
                    logCombined(username, '⚔️ [Inventory Guard Success] Lobby items cleared from inventory. Survival world verified!');
                    scannerAttempts = 0;
                }
            }
        }, 4000); 
    }

    bot.on('windowOpen', async (window) => {
        logCombined(username, `📦 [WINDOW OPENED] "${window.title}" - Attempting automatic selector click...`);
        
        setTimeout(async () => {
            try {
                if (bot && bot.isReadyToChat) {
                    await bot.clickWindow(CONFIG.menuTargetSlot, 0, 0);
                    logCombined(username, '✅ [UI Success] Target slot clicked successfully inside open menu.');
                }
            } catch (err) {
                logCombined(username, `❌ [UI Exception] Click failed or window shut down: ${err.message}`);
            }
        }, 1200); 
    });

    bot.on('end', (reason) => {
        if (navigationInterval) clearInterval(navigationInterval);
        isInSurvivalWorld = false; 
        
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        io.emit('bot-status', { username, status: 'Disconnected' });
        
        // Initialize retry tracking index if empty
        if (reconnectAttempts[username] === undefined) reconnectAttempts[username] = 0;
        
        // Stop retrying if an IP limit banner was hit
        if (reconnectAttempts[username] >= 99) {
            logCombined(username, `🛑 [Connection Terminated] Reconnect disabled due to an IP restriction or ban flag.`);
            return;
        }

        reconnectAttempts[username]++;
        
        // Smart Reconnect Delay Calculation (Base 15s + 10s extra per consecutive failure)
        // This stops the server from viewing your bots as a DDOS flood attack.
        const currentDelay = 15000 + (reconnectAttempts[username] * 10000);
        const nextDelaySeconds = Math.round(currentDelay / 1000);

        logCombined(username, `🔴 Bot disconnected: [${reason}]. Retrying (Attempt #${reconnectAttempts[username]}) in ${nextDelaySeconds}s...`);
        activeBots[username] = null;

        setTimeout(() => {
            createBot(username);
        }, currentDelay); 
    });

    bot.on('error', (err) => {
        logCombined(username, `⚠️ Network Engine Error: ${err.message}`);
        if (activeBots[username]) activeBots[username].isReadyToChat = false;
        bot.quit('Network Error');
    });
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
            Object.keys(activeBots).forEach(username => {
                executeChat(username);
            });
        } else {
            executeChat(target);
        }
    });
});

function startApp() {
    console.log('[System] Initializing application with firewall safety configurations...');
    
    CONFIG.botNames.forEach((name, i) => {
        // Increased login gap to a healthy 12 seconds between each bot's connection request
        setTimeout(() => {
            reconnectAttempts[name] = 0;
            createBot(name);
        }, i * 12000); 
    });

    server.listen(3000, () => {
        console.log('\n======================================================');
        console.log(`🖥️ Modern Control Dashboard Active at: http://localhost:3000`);
        console.log('======================================================\n');
    });
}

startApp();

