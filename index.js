const mineflayer = require('mineflayer');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Configuration
const SERVER_HOST = 'play.minegens.id';
const PASSWORD = 'Aww_lucuk';
const TARGET_PLAYER = 'ditnshyky';
const WEB_PORT = 3000;

const accounts = ['Chernobyls', 'LitraaAcuu'];
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
            body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #1e1e24; color: #fff; margin: 20px; }
            #console { background: #111; height: 400px; overflow-y: scroll; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 13px; }
            .msg { margin-bottom: 5px; border-left: 3px solid #555; padding-left: 8px; }
        </style>
    </head>
    <body>
        <h1>Bot Network Dashboard</h1>
        <div id="console"></div>
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

http.listen(WEB_PORT, () => console.log(`> Web Dashboard: http://localhost:${WEB_PORT}`));

// ------------------------------------------------------------
// Bot Logic
// ------------------------------------------------------------

accounts.forEach((username, index) => {
    setTimeout(() => startBot(username), index * 5000);
});

function startBot(username) {
    const bot = mineflayer.createBot({ host: SERVER_HOST, username: username, auth: 'offline' });
    bots[username] = bot;

    let hasNavigated = false;
    let navTimeout;
    let authInterval;

    function authBurst() {
        console.log(`[${username}] Triggering auth heartbeat...`);
        bot.chat(`/register ${PASSWORD}`);
        setTimeout(() => bot.chat(`/login ${PASSWORD}`), 3000);
    }

    bot.on('spawn', () => {
        console.log(`[${username}] Spawned.`);
        if (authInterval) clearInterval(authInterval);
        authInterval = setInterval(authBurst, 15 * 60 * 1000);
        authBurst();

        navTimeout = setTimeout(() => { if (!hasNavigated) navigateToSurvival(bot); }, 8000);
    });

    bot.on('message', (jsonMsg) => {
        const msg = jsonMsg.toString().toLowerCase();
        
        if (msg.includes('moved')) {
            console.log(`[${username}] Server move detected. Retrying in 3s...`);
            hasNavigated = false;
            clearTimeout(navTimeout);
            navTimeout = setTimeout(() => navigateToSurvival(bot), 3000);
        }

        if (msg.includes('successful') || msg.includes('logged in')) {
            clearTimeout(navTimeout);
            navTimeout = setTimeout(() => navigateToSurvival(bot), 1000);
        }
    });

    bot.on('windowOpen', async (window) => {
        try {
            await bot.clickWindow(12, 0, 0);
            hasNavigated = true;
        } catch (e) {}
    });

    bot.on('end', () => {
        clearInterval(authInterval);
        clearTimeout(navTimeout);
        delete bots[username];
        setTimeout(() => startBot(username), 10000);
    });
}

async function navigateToSurvival(bot) {
    try {
        bot.setQuickBarSlot(0);
        setTimeout(() => bot.activateItem(false), 500);
    } catch (e) {}
}

