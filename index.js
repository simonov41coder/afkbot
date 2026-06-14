const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// ==================== CONFIGURATION ====================
const CONFIG = {
    host: 'play.minegens.id',                
    port: 25565,                     
    version: '1.20.1',               
    password: 'kuyashii123', // Static fallback fallback pass from old code
    botNames: ['SuperSusu', 'HiroHito', 'Yatta_'],
    hotbarSlot: 0,       
    menuTargetSlot: 12   
};
// =======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let activeBots = {}; // Holds instances of BotInstance class
const LOG_FILE = path.join(__dirname, 'bot_records.txt');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- HOISTED CENTRAL LOGGER ---
function logCombined(username, message) {
    const timestamp = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' });
    const formattedLog = `[${timestamp}] [${username}] ${message}`;
    
    console.log(formattedLog);
    io.emit('chat-message', { time: timestamp, username, message });
    
    fs.appendFile(LOG_FILE, formattedLog + '\n', (err) => {
        if (err) console.error('FS Write Error:', err);
    });
}

function generatePasswordFromUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const uniquePart = Math.abs(hash).toString(36);
    return `McAfk_${uniquePart}_Pass!`; 
}

// --- BOT INSTANCE OBJECT ARCHITECTURE ---
class BotInstance {
    constructor(username, index) {
        this.username = username;
        this.bot = null;
        this.navigationInterval = null;
        this.isInSurvivalWorld = false;
        this.isReadyToChat = false;
        this.status = 'Initializing';

        // 🟢 Stagger connections safely like your working script (5 seconds apart)
        setTimeout(() => this.connect(), index * 5000);
    }

    connect() {
        this.status = 'Connecting...';
        logCombined(this.username, `[System] Opening network socket channel...`);

        const botPassword = generatePasswordFromUsername(this.username);

        this.bot = mineflayer.createBot({
            host: CONFIG.host,
            port: CONFIG.port,
            username: this.username,
            version: CONFIG.version,
            auth: 'offline',
            connectTimeout: 20000 
        });

        this.bot.once('connect', () => {
            try {
                if (this.bot._client && this.bot._client.socket) {
                    logCombined(this.username, `📡 [Network] Handshake completed successfully.`);
                }
            } catch (err) {
                logCombined(this.username, `⚠️ [Network Log Failed]: ${err.message}`);
            }
        });

        this.bot.on('spawn', () => {
            this.status = 'Lobby (Auth)';
            io.emit('bot-status', { username: this.username, status: 'Online' });
            this.isReadyToChat = true; 
            
            logCombined(this.username, '🟢 Spawned in lobby! Sending authentication request...');
            
            setTimeout(() => {
                if (this.bot && this.bot._client && this.bot._client.socket) {
                    this.bot.chat(`/register ${botPassword}`);
                }
            }, 1500);

            this.runAggressiveInventoryScanner();
        });

        this.bot.on('message', (jsonMsg, position) => {
            if (position === 'chat') return; 

            const message = jsonMsg.toString();
            if (message.includes('❤') || message.includes('★') || message.includes('⛨')) return;
            if (message.trim() === '') return;

            logCombined(this.username, `[Server System] ${message}`);

            const msgLower = message.toLowerCase();

            if (msgLower.includes('already registered') && !msgLower.includes('already logged')) {
                logCombined(this.username, '🔑 [Auth System] Overriding with /login prompt...');
                this.bot.chat(`/login ${botPassword}`);
            }

            if (
                msgLower.includes('too many accounts') || 
                msgLower.includes('limit reached') || 
                msgLower.includes('ip address')
            ) {
                logCombined(this.username, `🚨 [IP Limit] Host firewall dropped connection permanently.`);
                this.disconnectCleanly();
            }
        });

        // 📦 CONTAINER MENU CLICKS
        this.bot.on('windowOpen', async (window) => {
            logCombined(this.username, `📦 [WINDOW OPENED] "${window.title}" - Clicking destination node...`);
            setTimeout(async () => {
                try {
                    if (this.bot && this.isReadyToChat) {
                        await this.bot.clickWindow(CONFIG.menuTargetSlot, 0, 0);
                        logCombined(this.username, '✅ [UI Success] Click registered.');
                    }
                } catch (err) {
                    logCombined(this.username, `❌ [UI Exception] Click dropped: ${err.message}`);
                }
            }, 1200); 
        });

        this.bot.on('end', (reason) => {
            this.status = 'Offline';
            this.isReadyToChat = false;
            this.isInSurvivalWorld = false;
            if (this.navigationInterval) clearInterval(this.navigationInterval);
            
            io.emit('bot-status', { username: this.username, status: 'Disconnected' });
            logCombined(this.username, `🔴 Socket Closed [${reason}]. Reconnecting in 25s...`);

            // Safe automatic loop reconnection schedule
            setTimeout(() => this.connect(), 25000);
        });

        this.bot.on('error', (err) => {
            logCombined(this.username, `⚠️ Network Engine Error: ${err.message}`);
            this.disconnectCleanly();
        });
    }

    runAggressiveInventoryScanner() {
        if (this.navigationInterval) clearInterval(this.navigationInterval);
        let scannerAttempts = 0;

        this.navigationInterval = setInterval(() => {
            if (!this.bot || !this.bot.inventory || !this.isReadyToChat) return;
            if (this.bot.currentWindow) return;

            const hotbarItems = this.bot.inventory.items();
            const lobbyItemFound = hotbarItems.some(item => 
                item.name.includes('compass') || 
                item.name.includes('clock') || 
                item.name.includes('nether_star') ||
                item.name.includes('book')
            );

            if (lobbyItemFound) {
                scannerAttempts++;
                this.isInSurvivalWorld = false;
                this.status = 'Lobby (Joining)';

                logCombined(this.username, `📥 [Inventory Guard] Lobby items visible. Opening navigation UI (Scan #${scannerAttempts})`);
                this.bot.setQuickBarSlot(CONFIG.hotbarSlot);

                setTimeout(() => {
                    if (this.bot && this.isReadyToChat && !this.isInSurvivalWorld) {
                        this.bot.activateItem(false); 
                        
                        if (scannerAttempts % 2 === 0) {
                            logCombined(this.username, `⚡ [Aggressive Route] Forcing fallback commands...`);
                            this.bot.chat('/menu');
                            this.bot.chat('/server survival');
                        }
                    }
                }, 250);

            } else {
                if (!this.isInSurvivalWorld) {
                    this.isInSurvivalWorld = true;
                    this.status = 'In-Game';
                    logCombined(this.username, '⚔️ [Inventory Guard Success] Inside Survival World!');
                    clearInterval(this.navigationInterval); 
                }
            }
        }, 5000); 
    }

    sendChat(command) {
        if (this.bot && this.isReadyToChat && this.bot._client?.socket) {
            this.bot.chat(command);
            logCombined(this.username, `📤 [OUTGOING] Sent command successfully: "${command}"`);
        } else {
            logCombined(this.username, `❌ [FAILED] Command dropped: "${command}" (Bot offline)`);
        }
    }

    disconnectCleanly() {
        if (this.navigationInterval) clearInterval(this.navigationInterval);
        try { this.bot.quit(); } catch(e){}
    }
}

// --- CONTROLLER SOCKET EVENTS ---
io.on('connection', (socket) => {
    socket.emit('sync-bot-list', Object.keys(activeBots));
    
    socket.on('send-command', (data) => {
        const { target, command } = data;
        if (target === 'all') {
            Object.values(activeBots).forEach(instance => instance.sendChat(command));
        } else {
            activeBots[target]?.sendChat(command);
        }
    });
});

// --- SERVER ACTIVATION ---
function startApp() {
    console.log('[System] Launching Staggered Object Matrix...');
    
    // 🟢 Instantiates accounts using the clean Class array logic
    CONFIG.botNames.forEach((name, i) => {
        activeBots[name] = new BotInstance(name, i);
    });

    server.listen(3000, () => {
        console.log('\n======================================================');
        console.log(`🖥️ Modern Dashboard Configured & Listening on: http://localhost:3000`);
        console.log('======================================================\n');
    });
}

startApp();

