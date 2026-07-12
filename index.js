const mineflayer = require('mineflayer');
const dns = require('dns').promises;

const SERVER_HOST = 'play.minegens.id';
const SERVER_VERSION = '1.20.1';
const PASSWORD = 'IceTruckKlr';

const accounts = ['ggs_pvper', 'binggo_777'];
const bots = {};

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

const ACTIONBAR_RE = /❤.*★.*⛨/;

// Resolve IPv6 before starting bots
async function resolveServer() {
  try {
    const addresses = await dns.resolve6(SERVER_HOST);
    if (addresses && addresses.length > 0) {
      console.log(`[IPv6] Resolved ${SERVER_HOST} -> ${addresses[0]}`);
      return { host: addresses[0], family: 6 };
    }
  } catch (e) {
    console.log(`[IPv6] No AAAA record for ${SERVER_HOST}, falling back to IPv4`);
  }
  return { host: SERVER_HOST, family: 4 };
}

async function main() {
  const serverInfo = await resolveServer();
  console.log(`[INIT] Connecting via IPv${serverInfo.family} to ${serverInfo.host}`);

  accounts.forEach((username, index) => {
    setTimeout(() => startBot(username, serverInfo), index * 5000);
  });
}

function startBot(username, serverInfo) {
  const bot = mineflayer.createBot({
    host: serverInfo.host,
    port: 25565,
    username: username,
    auth: 'offline',
    version: SERVER_VERSION,
    viewDistance: 'tiny',
    hideErrors: true,
    plugins: {
      physics: false, blocks: false, digging: false,
      place_block: false, place_entity: false, generic_place: false,
      craft: false, furnace: false, chest: false, anvil: false,
      enchantment_table: false, villager: false, book: false,
      bed: false, breath: false, experience: false, explosion: false,
      fishing: false, ray_trace: false, resource_pack: false,
      scoreboard: false, spawn_point: false, tablist: false,
      team: false, time: false, title: false, boss_bar: false,
      particle: false, rain: false, sound: false,
      block_actions: false, command_block: false, creative: false
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

  const log = (msg) => console.log(`[${new Date().toISOString()}] [${username}] ${msg}`);

  function scheduleNav(delay) {
    clearTimeout(navTimeout);
    navTimeout = setTimeout(() => {
      if (!hasNavigated) navigateToSurvival();
    }, delay);
  }

  function authBurst() {
    if (authDone) return;
    log('Sending /register...');
    bot.chat(`/register ${PASSWORD}`);
    setTimeout(() => {
      if (authDone) return;
      log('Sending /login...');
      bot.chat(`/login ${PASSWORD}`);
    }, 3000);
  }

  async function navigateToSurvival() {
    if (hasNavigated || inSurvival) return;
    try {
      log('Opening compass menu...');
      bot.setQuickBarSlot(0);
      await sleep(500);
      bot.activateItem(false);

      const window = await waitForWindow(bot, 5000);
      if (!window) {
        log('Compass menu did not open, retrying in 3s...');
        scheduleNav(3000);
        return;
      }

      await sleep(500);
      log('Clicking survival option (slot 12)...');
      await bot.clickWindow(12, 0, 0);
      log('Waiting for survival HUD confirmation...');
    } catch (e) {
      log(`Navigation failed: ${e.message}`);
      scheduleNav(3000);
    }
  }

  function startPresenceCheck() {
    clearInterval(presenceCheckInterval);
    presenceCheckInterval = setInterval(() => {
      const elapsed = Date.now() - lastActionBarTime;
      if (elapsed > 10000) {
        if (inSurvival) {
          log('Survival HUD lost — likely back at hub, re-navigating...');
        }
        inSurvival = false;
        hasNavigated = false;
        scheduleNav(2000);
      }
    }, 10000);
  }

  // ─── EVENTS ───

  bot.on('spawn', () => {
    log(`Spawned in world via IPv${serverInfo.family}.`);
    if (authInterval) clearInterval(authInterval);
    authDone = false;
    authBurst();
    authInterval = setInterval(authBurst, 15 * 60 * 1000);
    startPresenceCheck();
    scheduleNav(8000);
  });

  bot.on('login', () => {
    log(`Connected to server via IPv${serverInfo.family}.`);
  });

  bot.on('message', (jsonMsg) => {
    const raw = jsonMsg.toString();

    if (ACTIONBAR_RE.test(raw)) {
      lastActionBarTime = Date.now();
      if (!inSurvival) {
        inSurvival = true;
        hasNavigated = true;
        clearTimeout(navTimeout);
        log('Confirmed in survival world.');
      }
      return;
    }

    const msg = raw.toLowerCase();

    if (msg.includes('ditnshyky') && (msg.includes('tpahere') || msg.includes('request'))) {
      log('TPA request detected — accepting.');
      bot.chat('/tpaccept ditnshyky');
      return;
    }

    if (msg.includes('already logged in') || msg.includes('wrong password') || msg.includes('invalid password')) {
      log(`Auth issue: ${raw}`);
      return;
    }
    if (msg.includes('successful') || msg.includes('logged in')) {
      log('Authenticated successfully.');
      authDone = true;
      if (authInterval) {
        clearInterval(authInterval);
        authInterval = null;
      }
      return;
    }
  });

  bot.on('kicked', (reason) => {
    log(`Kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    log(`Error: ${err.message}`);
  });

  bot._client.on('error', (err) => {
    log(`Protocol error: ${err.message}`);
  });

  bot.on('end', () => {
    log('Disconnected. Reconnecting in 10s...');
    if (authInterval) clearInterval(authInterval);
    clearInterval(presenceCheckInterval);
    clearTimeout(navTimeout);
    delete bots[username];
    setTimeout(() => startBot(username, serverInfo), 10000);
  });

  bot.on('death', () => {
    log('Died.');
  });

  bot.on('respawn', () => {
    log('Respawned.');
  });
}

main().catch(err => {
  console.error('[INIT] Failed to resolve server:', err.message);
  process.exit(1);
});

