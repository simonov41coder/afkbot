const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Configuration
const SERVER_HOST = 'play.minegens.id';
const PASSWORD = 'BraBra1998'; 
const TARGET_PLAYER = 'ditnshyky';
const WEB_PORT = 3000;

const accounts = ['Natan26', 'Chernobyl', 'ElReno13'];
const bots = {}; // Store bot instances here for global access

// ------------------------------------------------------------
// Web Dashboard Server Setup
// ------------------------------------------------------------

// Serve the dashboard HTML directly
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mineflayer Bot Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e1e24; color: #fff; margin: 20px; }
            h1 { color: #4caf50; }
            #console { background: #111; border: 1px solid #333; height: 400px; overflow-y: scroll; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 13px; margin-bottom: 15px; }
            .msg { margin-bottom: 5px; border-left: 3px solid #555; padding-left: 8px; }
            .system { color: #aaa; font-style: italic; }
            .chat { color: #00d2ff; }
            .controls { background: #2a2a35; padding: 15px; border-radius: 5px; display: flex; gap: 10px; align-items: center; }
            select, input, button { padding: 10px; border-radius: 3px; border: none; font-size: 14px; }
            select { background: #444; color: white; }
            input[type="text"] { flex-grow: 1; background: #fff; color: #000; }
            button { background: #4caf50; color: white; cursor: pointer; font-weight: bold; }
            button:hover { background: #45a049; }
        </style>
    </head>
    <body>
        <h1>Mineflayer Bot Network</h1>
        <div id="console"></div>
        
        <div class="controls">
            <select id="botSelector">
                <option value="all">All Bots</option>
                ${accounts.map(acc => `<option value="${acc}">${acc}</option>`).join('')}
            </select>
            <input type="text" id="chatInput" placeholder="Type raw chat message here..." autocomplete="off"/>
            <button onclick="sendRawChat()">Send Chat</button>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const consoleDiv = document.getElementById('console');

            socket.on('log', (data) => {
                const div = document.createElement('div');
                div.className = 'msg ' + data.type;
                div.innerText = \`[\${data.time}] [\${data.bot}] \${data.text}\`;
                consoleDiv.appendChild(div);
                consoleDiv.scrollTop = consoleDiv.scrollHeight;
            });

            function sendRawChat() {
                const botName = document.getElementById('botSelector').value;
                const message = document.getElementById('chatInput').value;
                if(!message.trim()) return;
                
                socket.emit('send-chat', { botName, message });
                document.getElementById('chatInput').value = '';
            }

            // Allow press enter to send
            document.getElementById('chatInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') sendRawChat();
            });
        </script>
    </body>
    </html>
    `);
});

// Handle real-time Web Dashboard communication
io.on('connection', (socket) => {
    socket.on('send-chat', ({ botName, message }) => {
        if (botName === 'all') {
            Object.values(bots).forEach(bot => {
                if(bot && bot.emit) bot.chat(message);
            });
            sendLog('GLOBAL', `Sent command to ALL bots: "${message}"`, 'system');
        } else if (bots[botName]) {
            bots[botName].chat(message);
            sendLog('GLOBAL', `Sent command to ${botName}: "${message}"`, 'system');
        }
    });
});

// Helper function to stream server console messages to the UI
function sendLog(botName, text, type = 'chat') {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${botName}] ${text}`);
    io.emit('log', { time, bot: botName, text, type });
}

http.listen(WEB_PORT, () => {
    console.log(`> Web Dashboard running at http://localhost:${WEB_PORT}`);
});


// ------------------------------------------------------------
// Mineflayer Bot Logic
// ------------------------------------------------------------

accounts.forEach((username) => {
    startBot(username);
});

function startBot(username) {
    sendLog(username, "Initializing bot instance...", 'system');

    const bot = mineflayer.createBot({
        host: SERVER_HOST,
        username: username,
        auth: 'offline'
    });

    bots[username] = bot; // Save reference for dashboard execution

    let hasLoggedIn = false;
    let hasNavigated = false;

    // Helper to check for unwanted action bar / spam symbols
    function containsIgnoredSymbols(text) {
        return text.includes('❤') || text.includes('★') || text.includes('⛨');
    }

    bot.on('spawn', () => {
        sendLog(username, "Spawned into the server.", 'system');
        
        setTimeout(() => {
            if (!hasNavigated) {
                navigateToSurvival(bot);
            }
        }, 3000);
    });

    // Handle standard chat messages
    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString().trim();
        
        // CRITICAL: Completely ignore messages containing action bar symbols
        if (containsIgnoredSymbols(message)) return;

        sendLog(username, message, 'chat');

        // 1. Authentication Logic
        if (!hasLoggedIn) {
            if (message.includes('/register')) {
                bot.chat(`/register ${PASSWORD}`);
                hasLoggedIn = true;
                sendLog(username, "Sent registration command.", 'system');
            } else if (message.includes('/login')) {
                bot.chat(`/login ${PASSWORD}`);
                hasLoggedIn = true;
                sendLog(username, "Sent login command.", 'system');
            }
        }

        // 2. TPA Request Handling
        if (message.includes(TARGET_PLAYER) && (message.toLowerCase().includes('tpahere') || message.toLowerCase().includes('teleport'))) {
            sendLog(username, `Detected TPA request from ${TARGET_PLAYER}. Accepting...`, 'system');
            bot.chat('/tpaccept');
        }

        // 3. Fallback Hub detection 
        if (message.toLowerCase().includes('welcome to the hub') || message.toLowerCase().includes('lobby')) {
            sendLog(username, "Hub environment detected. Resetting loop navigation...", 'system');
            hasNavigated = false;
            setTimeout(() => navigateToSurvival(bot), 3000);
        }
    });

    // Extra layer: Ignore action bar packets specifically if streamed separately by Mineflayer
    bot.on('actionBar', (jsonMsg) => {
        const message = jsonMsg.toString();
        if (containsIgnoredSymbols(message)) return; 
    });

    // 4. GUI Chest Inventory click handler
    bot.on('windowOpen', async (window) => {
        sendLog(username, "Server chest menu opened.", 'system');
        try {
            // Left click slot 12 (Survival RPG Item)
            await bot.clickWindow(12, 0, 0);
            sendLog(username, "Successfully selected slot 12 (Survival RPG).", 'system');
            hasNavigated = true;
        } catch (err) {
            sendLog(username, `Failed interacting with slot 12: ${err.message}`, 'system');
        }
    });

    // 5. Automatic Reconnection Handler
    bot.on('end', (reason) => {
        sendLog(username, `Disconnected! Reason: ${reason}`, 'system');
        hasLoggedIn = false;
        hasNavigated = false;
        delete bots[username];
        
        sendLog(username, "Scheduling automated reboot in 10 seconds...", 'system');
        setTimeout(() => {
            startBot(username);
        }, 10000);
    });

    bot.on('error', (err) => {
        sendLog(username, `Internal Error: ${err.message}`, 'system');
    });
}

async function navigateToSurvival(bot) {
    sendLog(bot.username, "Executing initial navigation hotbar interaction...", 'system');
    try {
        bot.setQuickBarSlot(0); // Highlight first hotbar slot
        bot.activateItem();    // Right click
    } catch (err) {
        sendLog(bot.username, `Hotbar switch failure: ${err.message}`, 'system');
    }
}

