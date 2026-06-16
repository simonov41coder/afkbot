const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Configuration
const SERVER_HOST = 'play.minegens.id';
const PASSWORD = 'Aww_Lucuk'; 
const TARGET_PLAYER = 'ditnshyky';
const WEB_PORT = 3000;

const accounts = [ 'Chernobyls', 'LitraaAcuu']; 
const bots = {}; 

// ------------------------------------------------------------
// Web Dashboard Server Setup
// ------------------------------------------------------------

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
            button.action-btn { background: #ff9800; }
            button:hover { opacity: 0.9; }
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
            <button class="action-btn" onclick="forceNavigate()">Force Hub Click</button>
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

            function forceNavigate() {
                const botName = document.getElementById('botSelector').value;
                socket.emit('force-navigate', { botName });
            }

            document.getElementById('chatInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') sendRawChat();
            });
        </script>
    </body>
    </html>
    `);
});

io.on('connection', (socket) => {
    socket.on('send-chat', ({ botName, message }) => {
        if (botName === 'all') {
            Object.values(bots).forEach(bot => bot?.chat(message));
        } else if (bots[botName]) {
            bots[botName].chat(message);
        }
    });

    socket.on('force-navigate', ({ botName }) => {
        if (botName === 'all') {
            Object.values(bots).forEach(bot => { if(bot) navigateToSurvival(bot); });
        } else if (bots[botName]) {
            navigateToSurvival(bots[botName]);
        }
    });
});

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

accounts.forEach((username, index) => {
    setTimeout(() => {
        startBot(username);
    }, index * 5000); 
});

function startBot(username) {
    sendLog(username, "Connecting to server...", 'system');

    const bot = mineflayer.createBot({
        host: SERVER_HOST,
        username: username,
        auth: 'offline'
    });

    bots[username] = bot; 

    let hasNavigated = false;
    let navTimeout;

    function containsIgnoredSymbols(text) {
        return text.includes('❤') || text.includes('★') || text.includes('⛨');
    }

    bot.on('spawn', () => {
        sendLog(username, "Spawned into lobby. Initializing staggered auth...", 'system');
        hasNavigated = false;
        clearTimeout(navTimeout);

        // First step: Drop the registration trigger 2 seconds after spawning
        setTimeout(() => {
            sendLog(username, "Sending /register...", 'system');
            bot.chat(`/register ${PASSWORD}`); 

            // FIXED: Added a distinct 3-second delay before firing /login
            setTimeout(() => {
                sendLog(username, "3s delay elapsed. Sending /login...", 'system');
                bot.chat(`/login ${PASSWORD}`);

                // Queue up the item selector action after the login fires
                clearTimeout(navTimeout);
                navTimeout = setTimeout(() => {
                    if (!hasNavigated) navigateToSurvival(bot);
                }, 3500);
            }, 3000);

        }, 2000);
    });

    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString().trim();
        if (containsIgnoredSymbols(message)) return; 

        sendLog(username, message, 'chat');
        const msgLower = message.toLowerCase();

        // Speed up selector action if successful text confirmation comes early
        if (msgLower.includes('successful') || msgLower.includes('berhasil') || msgLower.includes('logged in') || msgLower.includes('selamat datang')) {
            clearTimeout(navTimeout);
            navTimeout = setTimeout(() => {
                if (!hasNavigated) navigateToSurvival(bot);
            }, 1000);
        }

        // Teleport Requests
        if (message.includes(TARGET_PLAYER) && (msgLower.includes('tpahere') || msgLower.includes('teleport'))) {
            sendLog(username, `Accepting TPA from ${TARGET_PLAYER}`, 'system');
            bot.chat('/tpaccept');
        }

        if (msgLower.includes('moved')) {
            sendLog(username, "Server move detected. Retrying navigation in 3s...", 'system');
            hasNavigated = false; // Reset state so it can trigger again
            clearTimeout(navTimeout);
            navTimeout = setTimeout(() => {
                if (!hasNavigated) navigateToSurvival(bot);
            }, 3000);
        }

        // Hub/Lobby switches
        if (msgLower.includes('welcome to the hub') || msgLower.includes('lobby') || msgLower.includes('useful commands:')) {
            clearTimeout(navTimeout);
            navTimeout = setTimeout(() => {
                if (!hasNavigated) navigateToSurvival(bot);
            }, 1500);
        }
    });

    bot.on('actionBar', (jsonMsg) => {
        const message = jsonMsg.toString();
        if (containsIgnoredSymbols(message)) return; 
    });

    bot.on('windowOpen', async (window) => {
        sendLog(username, `Server Menu opened. Clicking slot 12...`, 'system');
        try {
            await bot.clickWindow(12, 0, 0);
            sendLog(username, "Successfully selected slot 12.", 'system');
            hasNavigated = true;
        } catch (err) {
            sendLog(username, `Failed window interaction: ${err.message}`, 'system');
        }
    });

    bot.on('end', (reason) => {
        sendLog(username, `Disconnected: ${reason}`, 'system');
        hasNavigated = false;
        clearTimeout(navTimeout);
        delete bots[username];
        
        sendLog(username, "Reconnecting in 10 seconds...", 'system');
        setTimeout(() => startBot(username), 10000);
    });

    bot.on('error', (err) => {
        if (!err.message.includes('ECONNRESET')) {
            sendLog(username, `Internal Error: ${err.message}`, 'system');
        }
    });
}

async function navigateToSurvival(bot) {
    sendLog(bot.username, "Selecting hotbar slot 0...", 'system');
    try {
        bot.setQuickBarSlot(0); 
        
        setTimeout(() => {
            sendLog(bot.username, "Right-clicking selector item...", 'system');
            bot.activateItem(false); 
        }, 500); 
    } catch (err) {
        sendLog(bot.username, `Hotbar sequence error: ${err.message}`, 'system');
    }
}

