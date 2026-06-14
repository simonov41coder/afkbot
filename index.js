const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { SocksClient } = require('socks');
const fs = require('fs');

// ==================== CONFIGURATION ====================
const CONFIG = {
    host: 'play.minegens.id',
    port: 25565,
    version: '1.20.1',

    botNames: ['SuperSusu', 'HiroHito', 'Yatta_'],
    proxyFile: path.join(__dirname, 'proxy.txt'),

    hotbarSlot: 0,
    menuTargetSlot: 12,

    botConnectTimeoutMs: 20000,
    reconnectDelayMs: 5000,
    botSpawnDelayMs: 4000,

    // Performance
    viewDistance: 'tiny',   // tiny(2) < short(4) < normal(8) < far(16)
    chatMode: 'enabled',    // needed to receive server messages
    colorsEnabled: false,   // we strip colors anyway, skip processing
    enablePhysics: false,   // no pathfinding = no physics tick needed
};
// =======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let activeBots = {};
let proxyList = [];
let currentProxyIndex = 0;
let proxySetInUse = new Set();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== UTILITIES ====================

function generatePasswordFromUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const uniquePart = Math.abs(hash).toString(36);
    return `McAfk_${uniquePart}_Pass!`;
}

function logCombined(username, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${username}] ${message}`);
    io.emit('chat-message', { time: timestamp, username, message });
}

// ==================== PROXY LOADING ====================

/**
 * Supports these formats in proxy.txt (one per line):
 *
 *   host:port:username:password        ← Webshare default export format
 *   socks5://username:password@host:port
 *   socks5://host:port                 ← no auth
 */
function parseProxyLine(line) {
    line = line.trim();
    if (!line || line.startsWith('#')) return null;

    if (line.startsWith('socks5://') || line.startsWith('socks4://')) {
        try {
            const url = new URL(line);
            return {
                host: url.hostname,
                port: parseInt(url.port, 10),
                userId: url.username || undefined,
                password: url.password || undefined,
                raw: line,
            };
        } catch { return null; }
    }

    const parts = line.split(':');

    // Webshare format: host:port:username:password
    if (parts.length === 4) {
        const [host, port, userId, password] = parts;
        return {
            host,
            port: parseInt(port, 10),
            userId,
            password,
            raw: `socks5://${userId}:${password}@${host}:${port}`,
        };
    }

    // Bare host:port
    if (parts.length === 2) {
        const [host, port] = parts;
        return {
            host,
            port: parseInt(port, 10),
            userId: undefined,
            password: undefined,
            raw: `socks5://${host}:${port}`,
        };
    }

    return null;
}

function loadProxies() {
    if (!fs.existsSync(CONFIG.proxyFile)) {
        console.error(`[System] proxy.txt not found at: ${CONFIG.proxyFile}`);
        console.error(`[System] Supported formats:`);
        console.error(`[System]   host:port:username:password`);
        console.error(`[System]   socks5://username:password@host:port`);
        process.exit(1);
    }

    const lines = fs.readFileSync(CONFIG.proxyFile, 'utf-8').split('\n');
    const parsed = lines.map(parseProxyLine).filter(Boolean);

    if (parsed.length === 0) {
        console.error('[System] proxy.txt is empty or has no valid entries.');
        process.exit(1);
    }

    proxyList = parsed;
    console.log(`[System] Loaded ${proxyList.length} proxies from proxy.txt`);
    proxyList.forEach((p, i) => {
        const auth = p.userId ? ` (auth: ${p.userId})` : ' (no auth)';
        console.log(`  [${i + 1}] ${p.host}:${p.port}${auth}`);
    });
}

function getNextProxy() {
    if (proxyList.length === 0) return undefined;

    let attempts = 0;
    while (attempts < proxyList.length) {
        if (currentProxyIndex >= proxyList.length) currentProxyIndex = 0;
        const proxy = proxyList[currentProxyIndex];
        currentProxyIndex++;
        if (!proxySetInUse.has(proxy.raw)) return proxy;
        attempts++;
    }

    if (currentProxyIndex >= proxyList.length) currentProxyIndex = 0;
    return proxyList[currentProxyIndex++];
}

function removeProxy(proxyRaw) {
    if (!proxyRaw) return;
    proxySetInUse.delete(proxyRaw);
    const idx = proxyList.findIndex(p => p.raw === proxyRaw);
    if (idx !== -1) {
        proxyList.splice(idx, 1);
        if (currentProxyIndex > idx && currentProxyIndex > 0) currentProxyIndex--;
        if (currentProxyIndex >= proxyList.length) currentProxyIndex = 0;
        console.log(`[System] Proxy removed. ${proxyList.length} remaining.`);
    }
}

// ==================== BOT MANAGEMENT ====================

function createBot(username, proxy = null) {
    const botPassword = generatePasswordFromUsername(username);
    let navigationInterval = null;
    let connectTimeoutHandle = null;
    let isInSurvivalWorld = false;

    const assignedProxy = proxy || getNextProxy();
    if (assignedProxy) proxySetInUse.add(assignedProxy.raw);
    let hubCheckInterval = null;

    logCombined(username, `[Proxy] Using: ${assignedProxy?.raw || 'Direct WAN'} [Pool: ${proxyList.length}]`);

    const botOptions = {
        host: CONFIG.host,
        port: CONFIG.port,
        username,
        version: CONFIG.version,
        auth: 'offline',
        keepAlive: true,
        fakeHost: CONFIG.host,

        // ── Performance options ──────────────────────────────
        // Minimal view distance — server sends far fewer chunk
        // packets, reducing bandwidth and CPU on both ends.
        viewDistance: CONFIG.viewDistance,

        // Skip client-side chat colour parsing — we strip it anyway.
        chatColors: CONFIG.colorsEnabled,

        // Disable mineflayer's physics simulation entirely.
        // The bot doesn't move by itself, so there's no need to
        // run the physics tick every 50 ms for each bot.
        physicsEnabled: CONFIG.enablePhysics,

        // Disable plugins the bot doesn't need.
        // Each disabled plugin removes event listeners and timers.
        plugins: {
            bed:          false,
            book:         false,
            boss_bar:     false,
            craft:        false,
            digging:      false,
            dispenser:    false,
            fishing:      false,
            painting:     false,
            scoreboard:   false,
            title:        false,
            villager:     false,
        },
    };

    if (assignedProxy) {
        botOptions.connect = (client) => {
            logCombined(username, `[Proxy] Opening SOCKS5 tunnel via ${assignedProxy.host}:${assignedProxy.port}...`);

            SocksClient.createConnection({
                proxy: {
                    host: assignedProxy.host,
                    port: assignedProxy.port,
                    type: 5,
                    userId: assignedProxy.userId,
                    password: assignedProxy.password,
                },
                command: 'connect',
                destination: {
                    host: CONFIG.host,
                    port: CONFIG.port,
                },
            }, (err, info) => {
                if (err) {
                    logCombined(username, `⚠️ [Proxy] Tunnel failed: ${err.message}. Rotating...`);
                    removeProxy(assignedProxy.raw);
                    client.emit('error', err);
                    return;
                }
                logCombined(username, `✅ [Proxy] Tunnel established via ${assignedProxy.host}`);
                client.setSocket(info.socket);
                client.emit('connect');
            });
        };
    }

    const bot = mineflayer.createBot(botOptions);
    activeBots[username] = bot;

    // Swallow bad map/chunk decompression packets silently
    bot.once('inject_allowed', () => {
        bot._client.on('error', (err) => {
            if (err.message && (
                err.message.includes('uncompressed length') ||
                err.message.includes('Chunk size') ||
                err.message.includes('partial packet')
            )) return; // silently ignore — just corrupted map data
            logCombined(username, `⚠️ [Client Error] ${err.message}`);
        });

        // Send minimum view distance to server immediately after login
        // so the server stops sending chunks we don't need.
        bot._client.once('login', () => {
            try {
                bot._client.write('settings', {
                    locale: 'en_US',
                    viewDistance: 2,          // 2 = tiny (minimum the server will respect)
                    chatFlags: 0,
                    chatColors: false,
                    skinParts: 127,
                    mainHand: 1,
                    enableTextFiltering: false,
                    enableServerListing: false,
                });
            } catch { /* older server versions may not support all fields */ }
        });
    });

    // Connection timeout guard
    connectTimeoutHandle = setTimeout(() => {
        if (activeBots[username] === bot && !bot.entity) {
            logCombined(username, `⏱️ [Timeout] No spawn in ${CONFIG.botConnectTimeoutMs / 1000}s. Rotating proxy...`);
            removeProxy(assignedProxy?.raw);
            bot.quit('Connection Timeout');
        }
    }, CONFIG.botConnectTimeoutMs);

    bot.on('spawn', () => {
        clearTimeout(connectTimeoutHandle);
        io.emit('bot-status', { username, status: 'Online' });

        if (isInSurvivalWorld) {
            logCombined(username, '🟢 Respawn confirmed in survival world.');
            return;
        }

        logCombined(username, '🟢 Spawned in lobby. Registering...');
        bot.chat(`/register ${botPassword}`);
        runNavigationScheduler(bot, username);
    });

    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString();

        // Skip noisy decorative chat lines
        if (message.includes('❤') || message.includes('★') || message.includes('⛨')) return;
        if (!message.trim()) return;

        logCombined(username, `[Chat] ${message}`);

        const msg = message.toLowerCase();

        if (msg.includes('already registered') && !msg.includes('already logged')) {
            logCombined(username, '🔑 [Auth] Pre-registered. Logging in...');
            bot.chat(`/login ${botPassword}`);
        }

        if (msg.includes('startsession') || msg.includes('cracked launcher')) {
            logCombined(username, '📲 [Auth] Session notice. Sending bypass...');
            bot.chat('/startsession');
        }

        if (msg.includes('sending you to survival') || msg.includes('joined to survival')) {
            isInSurvivalWorld = true;
            if (navigationInterval) clearInterval(navigationInterval);
            logCombined(username, '⚔️ [State] Survival world confirmed.');
            startHubCheck(bot, username);
        }

        // Real IP block — rotate proxy
        const isIpBlocked =
            msg.includes('too many accounts') ||
            msg.includes('too many players logged in with your ip address') ||
            msg.includes('ip has been blocked') ||
            msg.includes('ip limit');

        if (isIpBlocked) {
            logCombined(username, `🚨 [Proxy] IP limit hit. Removing proxy and rotating...`);
            if (navigationInterval) clearInterval(navigationInterval);
            isInSurvivalWorld = false;
            removeProxy(assignedProxy?.raw);
            bot.quit('Proxy IP Blocked');
        }
    });

    bot.on('windowOpen', async (window) => {
        if (navigationInterval) clearInterval(navigationInterval);
        logCombined(username, `📦 [Window] Opened: "${window.title}"`);

        setTimeout(async () => {
            try {
                if (activeBots[username] === bot && !isInSurvivalWorld) {
                    await bot.clickWindow(CONFIG.menuTargetSlot, 0, 0);
                    logCombined(username, '✅ [UI] Target slot clicked.');
                }
            } catch (err) {
                logCombined(username, `❌ [UI] Click failed: ${err.message}`);
            }
        }, 1500);
    });

    bot.on('end', (reason) => {
        clearTimeout(connectTimeoutHandle);
        if (navigationInterval) clearInterval(navigationInterval);
        if (hubCheckInterval) clearInterval(hubCheckInterval);
        isInSurvivalWorld = false;

        if (assignedProxy) proxySetInUse.delete(assignedProxy.raw);
        io.emit('bot-status', { username, status: 'Disconnected' });
        logCombined(username, `🔴 Disconnected: [${reason}]. Reconnecting in ${CONFIG.reconnectDelayMs / 1000}s...`);

        activeBots[username] = null;

        setTimeout(() => {
            createBot(username, getNextProxy());
        }, CONFIG.reconnectDelayMs);
    });

    bot.on('error', (err) => {
        logCombined(username, `⚠️ [Error] ${err.message}`);
    });

    function startHubCheck(bot, username) {
        if (hubCheckInterval) clearInterval(hubCheckInterval);

        logCombined(username, '🔍 [HubCheck] Periodic survival check started (every 10 min).');

        hubCheckInterval = setInterval(() => {
            if (!bot.entity || activeBots[username] !== bot) {
                clearInterval(hubCheckInterval);
                return;
            }

            // Check if clock is in hotbar slot 0 — means we're in hub/lobby, not survival
            const slot0 = bot.inventory.slots[36]; // slot 36 = hotbar position 0
            const hasClock = slot0 && slot0.name === 'clock';

            if (hasClock) {
                logCombined(username, '⚠️ [HubCheck] Clock detected in slot 0 — bot is stuck in hub! Re-navigating...');
                isInSurvivalWorld = false;
                runNavigationScheduler(bot, username);
            } else {
                logCombined(username, '✅ [HubCheck] No clock in slot 0 — bot is in survival. OK.');
            }
        }, 10 * 60 * 1000); // every 10 minutes
    }

    function runNavigationScheduler(bot, username) {
        logCombined(username, `[Nav] Waiting 6s for server transition...`);

        setTimeout(() => {
            if (bot.currentWindow || isInSurvivalWorld || activeBots[username] !== bot) return;

            logCombined(username, `[Nav] Triggering right-click...`);
            triggerLobbyNavigation(bot, username);

            let attempts = 0;
            if (navigationInterval) clearInterval(navigationInterval);

            navigationInterval = setInterval(() => {
                if (bot.currentWindow || isInSurvivalWorld || activeBots[username] !== bot) {
                    clearInterval(navigationInterval);
                    return;
                }

                attempts++;
                logCombined(username, `⚠️ [Failsafe] Menu missing (attempt #${attempts}). Retrying...`);
                triggerLobbyNavigation(bot, username);

                if (attempts === 2) bot.chat('/menu');
                if (attempts === 3) bot.chat('/selector');
                if (attempts === 4) bot.chat('/server survivalrpg');
                if (attempts >= 5) {
                    logCombined(username, `❌ [Failsafe] Stuck in lobby. Forcing reconnect...`);
                    clearInterval(navigationInterval);
                    bot.quit('Lobby Navigation Failure');
                }
            }, 5000);
        }, 6000);
    }
}

function triggerLobbyNavigation(bot, username) {
    try {
        bot.setQuickBarSlot(CONFIG.hotbarSlot);
        setTimeout(() => {
            try {
                if (activeBots[username] === bot) {
                    const currentItem = bot.heldItem;
                    if (currentItem && currentItem.name === 'clock') {
                        logCombined(username, '[Nav] Right-clicking clock...');
                        bot.activateItem(false);
                    } else {
                        logCombined(username, `[Nav] Held item is "${currentItem?.name ?? 'nothing'}" — expected clock.`);
                    }
                }
            } catch (err) {
                logCombined(username, `❌ [Nav] Inner click error: ${err.message}`);
            }
        }, 500);
    } catch (err) {
        logCombined(username, `❌ [Nav] Exception: ${err.message}`);
    }
}

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
    socket.emit('sync-bot-list', Object.keys(activeBots));

    Object.keys(activeBots).forEach(username => {
        const status = activeBots[username]?.entity ? 'Online' : 'Connecting';
        socket.emit('bot-status', { username, status });
    });

    socket.on('send-command', ({ target, command }) => {
        const send = (username) => {
            const b = activeBots[username];
            if (b?.entity) b.chat(command);
        };

        if (target === 'all') {
            Object.keys(activeBots).forEach(send);
        } else {
            send(target);
        }
    });
});

// ==================== STARTUP ====================

async function startApp() {
    loadProxies();

    CONFIG.botNames.forEach((name, i) => {
        setTimeout(() => {
            createBot(name, getNextProxy());
        }, i * CONFIG.botSpawnDelayMs);
    });

    server.listen(3000, () => {
        console.log('\n======================================================');
        console.log(`🖥️  Dashboard: http://localhost:3000`);
        console.log('======================================================\n');
    });
}

startApp();

