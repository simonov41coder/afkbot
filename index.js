const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const GLOBAL_CONFIG = {
  host: 'play.minegens.id',
  port: 25565,
  version: '1.20.1',
  botNames: ['SuperSusu', 'HiroHito', 'Yatta_'],
  hotbarSlot: 0,       // New index for navigation item
  menuTargetSlot: 12   // New slot index inside container menu
};
// =======================================================

const bots = {};
let webLogs = [];

// --- UTILS ---

function logCombined(name, msg) {
  const timestamp = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' });
  const cleanMsg = msg.replace(/§[0-9a-fk-or]/g, '');
  if (cleanMsg.includes('❤') || cleanMsg.includes('★') || cleanMsg.includes('⛨') || cleanMsg.trim() === '') return;

  const consoleLog = `[${timestamp}] [${name}] ${cleanMsg}`;
  console.log(consoleLog);

  const webEntry = `<span style="color: #888">[${timestamp}]</span> <b style="color: #55ff55">[${name}]</b> ${cleanMsg}`;
  webLogs.unshift(webEntry);
  if (webLogs.length > 100) webLogs.pop();

  io.emit('chat-message', { time: timestamp, username: name, message: cleanMsg });
}

// New Dynamic Password Generation
function generatePasswordFromUsername(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const uniquePart = Math.abs(hash).toString(36);
  return `McAfk_${uniquePart}_Pass!`; 
}

// --- BOT INSTANCE CLASS (Your Original Working Architecture) ---
class BotInstance {
  constructor(username, index) {
    this.username = username;
    this.status = 'Initializing';
    this.navigationInterval = null;
    this.isInSurvivalWorld = false;

    // 🟢 Keep your exact working 5-second staggering delay
    setTimeout(() => this.connect(), index * 5000);
  }

  connect() {
    this.status = 'Connecting...';
    logCombined(this.username, `[System] Opening network socket channel...`);

    const botPassword = generatePasswordFromUsername(this.username);

    this.bot = mineflayer.createBot({
      host: GLOBAL_CONFIG.host,
      port: GLOBAL_CONFIG.port,
      username: this.username,
      version: GLOBAL_CONFIG.version,
      auth: 'offline'
    });

    this.bot.once('connect', () => {
      logCombined(this.username, `📡 [Network] Handshake completed successfully.`);
    });

    this.bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString();
      logCombined(this.username, msg);

      const msgLower = msg.toLowerCase();
      if (msgLower.includes('already registered') && !msgLower.includes('already logged')) {
         this.bot.chat(`/login ${botPassword}`);
      }
    });

    this.bot.once('spawn', async () => {
      this.status = 'Lobby (Auth)';
      io.emit('bot-status', { username: this.username, status: 'Online' });

      await this.wait(2000);
      this.bot.chat(`/register ${botPassword}`);
      await this.wait(2000);
      this.bot.chat(`/login ${botPassword}`);
      
      this.startJoinCheck();
    });

    // 📦 Updated menu container click matching your new target slot rules
    this.bot.on('windowOpen', async (window) => {
      logCombined(this.username, `📦 [WINDOW OPENED] "${window.title}" - Clicking destination node...`);
      await this.wait(1200);
      try {
        if (this.bot) {
          await this.bot.clickWindow(GLOBAL_CONFIG.menuTargetSlot, 0, 0);
          logCombined(this.username, '✅ [UI Success] Click registered.');
        }
      } catch (e) {
        logCombined(this.username, `❌ [UI Exception] Click dropped: ${e.message}`);
      }
    });

    this.bot.on('end', (reason) => {
      this.status = 'Offline';
      this.isInSurvivalWorld = false;
      if (this.navigationInterval) clearInterval(this.navigationInterval);

      io.emit('bot-status', { username: this.username, status: 'Disconnected' });
      logCombined(this.username, `🔴 Socket Closed [${reason}]. Reconnecting in 25s...`);
      
      setTimeout(() => this.connect(), 25000);
    });

    this.bot.on('error', (err) => {
      logCombined(this.username, `⚠️ Network Engine Error: ${err.message}`);
    });
  }

  // 📥 Modernized Navigation loop logic wrapped in your original stable checker format
  startJoinCheck() {
    if (this.navigationInterval) clearInterval(this.navigationInterval);

    this.navigationInterval = setInterval(async () => {
      if (!this.bot || !this.bot.inventory) return;
      
      // Look for any standard lobby navigation items anywhere in inventory slots
      const items = this.bot.inventory.items();
      const hasLobbyItem = items.some(i => 
         i && (i.name.includes('compass') || i.name.includes('clock') || i.name.includes('star') || i.name.includes('book'))
      );

      if (!hasLobbyItem) {
         if (!this.isInSurvivalWorld) {
            this.isInSurvivalWorld = true;
            this.status = 'In-Game';
            logCombined(this.username, '⚔️ [Inventory Success] Inside Survival World!');
            clearInterval(this.navigationInterval);
         }
         return;
      }

      this.status = 'Lobby (Joining)';
      this.isInSurvivalWorld = false;

      try {
        if (this.bot.currentWindow) return;
        
        // Select your new customizable hotbar index slot configuration
        this.bot.setQuickBarSlot(GLOBAL_CONFIG.hotbarSlot);
        await this.wait(250);
        this.bot.activateItem(false);
      } catch (e) {}
    }, 5000);
  }

  sendChat(msg) { if (this.bot) this.bot.chat(msg); }
  wait(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// --- INITIALIZE BOT LOOPS ---
GLOBAL_CONFIG.botNames.forEach((name, i) => { bots[name] = new BotInstance(name, i); });

// --- DASHBOARD ROUTINGS ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- BACKWARDS COMPATIBLE EXPRESS/SOCKET ENDPOINTS ---
io.on('connection', (socket) => {
  socket.emit('sync-bot-list', Object.keys(bots));
  
  socket.on('send-command', (data) => {
    const { target, command } = data;
    if (target === 'all') {
      Object.values(bots).forEach(b => b.sendChat(command));
    } else {
      bots[target]?.sendChat(command);
    }
  });
});

server.listen(port, () => console.log(`Dashboard running stably on port ${port}`));

