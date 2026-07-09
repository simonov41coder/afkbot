const mineflayer = require('mineflayer');

// Configuration
const SERVER_HOST = 'play.minegens.id';
const SERVER_VERSION = '1.20.1';
const PASSWORD = 'IceTruckKlr';

const accounts = ['JustLife44', 'errty'];
const bots = {};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function sleep(ms) {
  // Add up to 800ms of jitter so no two delays are identical
  return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 800));
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

function emitLog(msg) {
  console.log(msg);
}

const ACTIONBAR_RE = /❤.*★.*⛨/;

// ------------------------------------------------------------
// Bot Logic
// ------------------------------------------------------------
accounts.forEach((username, index) => {
  // Stagger joins 15–30s apart to avoid IP-cluster detection
  const stagger = 15000 + Math.random() * 15000;
  setTimeout(() => startBot(username), index * stagger);
});

function startBot(username) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    username: username,
    auth: 'offline',
    version: SERVER_VERSION,
    viewDistance: 'tiny',
    hideErrors: false,
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
    const jittered = delay + Math.random() * 2000;
    navTimeout = setTimeout(() => {
      if (!hasNavigated) navigateToSurvival();
    }, jittered);
  }

  function authBurst() {
    if (authDone) return;
    emitLog(`[${username}] Registering...`);
    bot.chat(`/register ${PASSWORD}`);

    const jitteredDelay = 3000 + Math.random() * 2000;
    setTimeout(() => {
      if (authDone) return;
      emitLog(`[${username}] Logging in...`);
      bot.chat(`/login ${PASSWORD}`);
    }, jitteredDelay);
  }

  function startAntiBotEvasionLoops() {
    // Random head twitch (recursive setTimeout so interval is always random)
    function lookLoop() {
      if (!bot.entity) {
        bot.once('spawn', lookLoop);
        return;
      }
      const yawJitter = (Math.random() - 0.5) * 0.12;
      const pitchJitter = (Math.random() - 0.5) * 0.06;
      bot.look(bot.entity.yaw + yawJitter, bot.entity.pitch + pitchJitter, true);
      setTimeout(lookLoop, 20000 + Math.random() * 60000);
    }
    lookLoop();

    // Random sneak toggle
    function sneakLoop() {
      if (!bot.entity) {
        bot.once('spawn', sneakLoop);
        return;
      }
      bot.setControlState('sneak', true);
      const duration = 300 + Math.random() * 700;
      setTimeout(() => bot.setControlState('sneak', false), duration);
      setTimeout(sneakLoop, 120000 + Math.random() * 180000);
    }
    sneakLoop();
  }

  async function navigateToSurvival() {
    if (hasNavigated || inSurvival) return;
    try {
      emitLog(`[${username}] Navigating to survival...`);
      bot.setQuickBarSlot(0);
      await sleep(600);
      bot.activateItem(false);

      const window = await waitForWindow(bot, 5000);
      if (!window) {
        emitLog(`[${username}] Window didn't open. Retrying in 3s...`);
        scheduleNav(3000);
        return;
      }

      await sleep(700);
      await bot.clickWindow(12, 0, 0);
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
    }, 10000);
  }

  bot.on('login', () => {
    emitLog(`[${username}] Login packet received.`);
    // Physics is now active, so position packets are already flowing.
  });

  bot.on('spawn', () => {
    emitLog(`[${username}] Spawned.`);

    if (authInterval) clearInterval(authInterval);
    authDone = false;
    authBurst();
    authInterval = setInterval(authBurst, 15 * 60 * 1000);

    startPresenceCheck();
    startAntiBotEvasionLoops();
    scheduleNav(8000);
  });

  bot.on('message', (jsonMsg) => {
    const raw = jsonMsg.toString();

    if (ACTIONBAR_RE.test(raw)) {
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

    // --- AUTO TPA SYSTEM ---
    if (msg.includes('ditnshyky') && (msg.includes('tpahere') || msg.includes('teleport') || msg.includes('request'))) {
      emitLog(`[${username}] Detected TPA request from ditnshyky. Accepting...`);
      // Human-like reaction delay
      setTimeout(() => {
        bot.chat('/tpaccept ditnshyky');
      }, 1200 + Math.random() * 2500);
      return;
    }

    if (msg.includes('already logged in') || msg.includes('wrong password') || msg.includes('invalid password')) {
      emitLog(`[${username}] ⚠ AUTH FAILURE: ${raw}`);
      return;
    }

    if (msg.includes('successful') || msg.includes('logged in')) {
      authDone = true;
      if (authInterval) {
        clearInterval(authInterval);
        authInterval = null;
      }
      return;
    }
  });

  bot.on('kicked', (reason) => {
    emitLog(`[${username}] KICKED: ${reason}`);
  });

  bot._client.on('error', (err) => {
    emitLog(`[${username}] Protocol error: ${err.message}`);
  });

  bot.on('end', () => {
    emitLog(`[${username}] Disconnected. Reconnecting in 10s...`);
    if (authInterval) clearInterval(authInterval);
    clearInterval(presenceCheckInterval);
    clearTimeout(navTimeout);
    delete bots[username];
    setTimeout(() => startBot(username), 10000);
  });

  bot.on('error', (err) => {
    emitLog(`[${username}] Error: ${err.message}`);
  });
}

