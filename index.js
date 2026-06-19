const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Configuration
const SERVER_HOST = 'play.minegens.id';
const SERVER_VERSION = '1.20.1';
const PASSWORD = 'Aww_Lucuk';
const WEB_PORT = 3000;

const accounts = ['Chernobyls', 'Litra_Acuu'];
const bots = {};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForWindow(bot, timeout = 5000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            bot.off('windowOpen', handler);
            resolve(null);
        }, timeout);

        const handler = (window) => {
            clearTimeout(timer);
            resolve(window);
        };

        bot.once('windowOpen', handler);
    });
}

// ------------------------------------------------------------
// Web Dashboard
// ------------------------------------------------------------

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mineflayer Bot Dashboard</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #1e1e24; color: #fff; margin: 20px; }
            #console { background: #111; height: 400px; overflow-y: scroll; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 13px; }
            .msg { margin-bottom: 5px; border-left: 3px solid #555; padding-left: 8px; }
            input, select, button { margin-top: 10px; padding: 6px 10px; border-radius: 4px; border: none; }
            button { background: #4e9af1; color: #fff; cursor: pointer; }
        </style>
    </head>
    <body>
        <h1>Bot Network Dashboard</h1>
        <div id="console"></div>
        <select id="botSelect">
            <option value="all">All Bots</option>
            ${accounts.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
        <input id="chatInput" type="text" placeholder="Message..." />
        <button onclick="sendChat()">Send</button>
        <script>
            const socket = io();
            socket.on('log', ({ msg }) => {
                const div = document.getElementById('console');
                const line = document.createElement('div');
                line.className = 'msg';
                line.textContent = msg;
                div.appendChild(line);
                div.scrollTop = div.scrollHeight;
            });
            function sendChat() {
                const botName = document.getElementById('botSelect').value;
                const message = document.getElementById('chatInput').value;
                if (message.trim()) socket.emit('send-chat', { botName, message });
            }
        </script>
    </body>
    </html>
    `);
});

io.on('connection', (socket) => {
    socket.on('send-chat', ({ botName, message }) => {
        if (botName === 'all') Object.values(bots).forEach(b => b?.chat(message));
        else if (bots[botName]) bots[botName].chat(message);
    });
});

function emitLog(msg) {
    console.log(msg);
    io.emit('log', { msg });
}

http.listen(WEB_PORT, () => emitLog(`> Web Dashboard: http://localhost:${WEB_PORT}`));

// ------------------------------------------------------------
// Bot Logic
// ------------------------------------------------------------

accounts.forEach((username, index) => {
    setTimeout(() => startBot(username), index * 5000);
});

function startBot(username) {
    const bot = mineflayer.createBot({
        host: SERVER_HOST,
        username: username,
        auth: 'offline',
        version: SERVER_VERSION
    });

    bots[username] = bot;

    let hasNavigated = false;
    let inSurvival = false;
    let lastActionBarTime = 0;
    let navTimeout = null;
    let authInterval = null;
    let authDone = false;
    let presenceCheckInterval = null;

    function scheduleNav(delay) {
        clearTimeout(navTimeout);
        navTimeout = setTimeout(() => {
            if (!hasNavigated) navigateToSurvival();
        }, delay);
    }

    function authBurst() {
        if (!authDone) {
            emitLog(`[${username}] Registering...`);
            bot.chat(`/register ${PASSWORD}`);
        }
        setTimeout(() => {
            emitLog(`[${username}] Logging in...`);
            bot.chat(`/login ${PASSWORD}`);
        }, 3000);
    }

    async function navigateToSurvival() {
        if (hasNavigated || inSurvival) return;

        try {
            emitLog(`[${username}] Navigating to survival...`);

            bot.setQuickBarSlot(0);
            await sleep(500);
            bot.activateItem(false);

            const window = await waitForWindow(bot, 5000);
            if (!window) {
                emitLog(`[${username}] Window didn't open. Retrying in 3s...`);
                scheduleNav(3000);
                return;
            }

            await sleep(500);
            await bot.clickWindow(12, 0, 0); // Adjust slot to match your server's GUI
            emitLog(`[${username}] Clicked survival GUI option, awaiting confirmation...`);

        } catch (e) {
            emitLog(`[${username}] Nav error: ${e.message}`);
            scheduleNav(3000);
        }
    }

    function startPresenceCheck() {
        clearInterval(presenceCheckInterval);
        presenceCheckInterval = setInterval(() => {
            const elapsed = Date.now() - lastActionBarTime;
            if (elapsed > 10000) {
                if (inSurvival) {
                    emitLog(`[${username}] Lost survival HUD signal. Assuming hub — retrying nav.`);
                }
                inSurvival = false;
                hasNavigated = false;
                scheduleNav(2000);
            }
        }, 5000);
    }

    bot.on('spawn', () => {
        emitLog(`[${username}] Spawned.`);

        if (authInterval) clearInterval(authInterval);
        authDone = false;
        authBurst();
        authInterval = setInterval(authBurst, 15 * 60 * 1000);

        startPresenceCheck();
        scheduleNav(8000);
    });

    bot.on('message', (jsonMsg) => {
        const raw = jsonMsg.toString();

        if (/❤.*★.*⛨/.test(raw)) {
            lastActionBarTime = Date.now();
            if (!inSurvival) {
                inSurvival = true;
                hasNavigated = true;
                clearTimeout(navTimeout);
                emitLog(`[${username}] Confirmed in survival (actionbar detected).`);
            }
            return;
        }

        const msg = raw.toLowerCase();
        emitLog(`[${username}] Chat: ${raw}`);

        // --- AUTO TPA SYSTEM ---
        // Checks if the message contains your name and a variation of teleport request wording
        if (msg.includes('ditnshyky') && (msg.includes('tpahere') || msg.includes('teleport') || msg.includes('request'))) {
            emitLog(`[${username}] Detected TPA request from ditnshyky. Accepting...`);
            bot.chat('/tpaccept ditnshyky');
        }
        // -----------------------

        if (msg.includes('already logged in') || msg.includes('wrong password') || msg.includes('invalid password')) {
            emitLog(`[${username}] ⚠ AUTH FAILURE: ${raw}`);
        }

        if (msg.includes('successful') || msg.includes('logged in')) {
            authDone = true;
        }
    });

    bot.on('kicked', (reason) => {
        emitLog(`[${username}] KICKED: ${reason}`);
    });

    bot._client.on('end', (reason) => {
        emitLog(`[${username}] Connection ended: ${reason}`);
    });

    bot._client.on('error', (err) => {
        emitLog(`[${username}] Protocol error: ${err.message}`);
    });

    bot.on('end', () => {
        emitLog(`[${username}] Disconnected. Reconnecting in 10s...`);
        clearInterval(authInterval);
        clearInterval(presenceCheckInterval);
        clearTimeout(navTimeout);
        delete bots[username];
        setTimeout(() => startBot(username), 10000);
    });

    bot.on('error', (err) => {
        emitLog(`[${username}] Error: ${err.message}`);
    });
}

