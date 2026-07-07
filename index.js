const mineflayer = require('mineflayer');

// Configuration
const SERVER_HOST = 'play.minegens.id';
const SERVER_VERSION = '1.20.1';
const PASSWORD = 'Aww_Lucuk';

const accounts = ['Chernobyls', 'Litra_Acuu', 'Sponsored_one'];
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

function emitLog(msg) {
  console.log(msg);
}

const ACTIONBAR_RE = /❤.*★.*⛨/;

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
    version: SERVER_VERSION,
    viewDistance: 'tiny', // Optimization: minimizes incoming chunk data
    hideErrors: true,     // Optimization: skip internal warning string building
    plugins: {            // Optimization: skip loading unused plugins — test live, re-enable any that throw on inject
      physics: false,     // bots never move, so drop the tick loop entirely
      blocks: false,
      digging: false,
      place_block: false,
      place_entity: false,
      generic_place: false,
      craft: false,
      furnace: false,
      chest: false,
      anvil: false,
      enchantment_table: false,
      villager: false,
      book: false,
      bed: false,
      breath: false,
      experience: false,
      explosion: false,
      fishing: false,
      ray_trace: false,
      resource_pack: false,
      scoreboard: false,
      spawn_point: false,
      tablist: false,
      team: false,
      time: false,
      title: false,
      boss_bar: false,
      particle: false,
      rain: false,
      sound: false,
      block_actions: false,
      command_block: false,
      creative: false
    }
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
    if (authDone) return;
    emitLog(`[${username}] Registering...`);
    bot.chat(`/register ${PASSWORD}`);
    setTimeout(() => {
      if (authDone) return;
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
      await bot.clickWindow(12, 0, 0);
      emitLog(`[${username}] Clicked survival GUI option, awaiting confirmation...`);
    } catch (e) {
      emitLog(`[${username}] Nav error: ${e.message}`);
      scheduleNav(3000);
    }
  }

  function startPresenceCheck() {
    clearInterval(presenceCheckInterval);
    // Optimization: 10s tick instead of 5s halves wakeups across all bots
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
      bot.chat('/tpaccept ditnshyky');
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

    // Optimization: no more catch-all chat logging — dropped high-volume console.log per line
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

