require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

let prefix = process.env.DISCORD_BOT_PREFIX || '!';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE_URL = (process.env.NODECAST_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DEFAULT_NODECAST_TOKEN = process.env.NODECAST_API_TOKEN || '';
let activeWindowMs = Number(process.env.NODECAST_ACTIVE_WINDOW_MS || 300000);
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCnw2SySq8zl2PHjneE7_zEuosYueOo5Pk';
const NODECAST_EMAIL = process.env.NODECAST_EMAIL || '';
const NODECAST_PASSWORD = process.env.NODECAST_PASSWORD || '';
const NODECAST_DISCORD_AUTH_SECRET = process.env.NODECAST_DISCORD_AUTH_SECRET || '';
let commandDedupeWindowMs = Number(process.env.DISCORD_COMMAND_DEDUPE_WINDOW_MS || 15000);
const TARGET_GUILD_ID = String(
    process.env.DISCORD_GUILD_ID ||
    process.env.DISCORD_SERVER_ID ||
    '1356477545964372048'
).trim();

function parseUserTokenMap(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([k, v]) => k && typeof v === 'string' && v.trim())
                .map(([k, v]) => [k, v.trim()])
        );
    } catch (err) {
        console.warn('[DiscordBot] Invalid DISCORD_USER_TOKEN_MAP JSON:', err.message);
        return {};
    }
}

const userTokenMap = parseUserTokenMap(process.env.DISCORD_USER_TOKEN_MAP);
let autoTokenCache = { token: '', expiresAt: 0 };
let autoTokenPromise = null;
const processedMessageIds = new Map();

function buildEmbed({ title, description, color = 0x2f3136, fields = [], thumbnail, image, footer }) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
    if (fields.length) embed.addFields(fields);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);
    if (footer) embed.setFooter({ text: footer });
    return embed;
}

function sanitizeEmbedText(value, fallback = '') {
    const s = String(value ?? '').trim();
    return s || fallback;
}

function truncateText(value, maxLen = 240) {
    const s = sanitizeEmbedText(value, '');
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen - 3)}...` : s;
}

function formatSeconds(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function buildProgressText(progress, duration) {
    const p = Math.max(0, Math.floor(Number(progress) || 0));
    const d = Math.max(0, Math.floor(Number(duration) || 0));
    if (!d) return formatSeconds(p);
    const pct = Math.max(0, Math.min(100, Math.floor((p / d) * 100)));
    return `${formatSeconds(p)} / ${formatSeconds(d)} (${pct}%)`;
}

function getPosterUrl(item) {
    const poster = sanitizeEmbedText(item?.data?.poster, '');
    if (!poster) return '';
    if (poster.startsWith('http://') || poster.startsWith('https://')) return poster;
    return '';
}

function getItemTitle(item) {
    return sanitizeEmbedText(item?.data?.title || item?.name, 'Unknown Title');
}

function getItemSubtitle(item) {
    return sanitizeEmbedText(item?.data?.subtitle, '');
}

function getItemDescription(item) {
    return sanitizeEmbedText(item?.data?.description, '');
}

function getItemType(item) {
    return sanitizeEmbedText(item?.item_type || 'unknown', 'unknown');
}

function getProgressField(item) {
    const progress = Number(item?.progress || 0);
    const duration = Number(item?.duration || item?.data?.duration || 0);
    return buildProgressText(progress, duration);
}

function getStreamDetails(item) {
    const width = Number(item?.data?.streamWidth || 0);
    const height = Number(item?.data?.streamHeight || 0);
    const v = sanitizeEmbedText(item?.data?.streamVideoCodec, '');
    const a = sanitizeEmbedText(item?.data?.streamAudioCodec, '');
    const c = sanitizeEmbedText(item?.data?.streamContainer, '');
    const resolution = width > 0 && height > 0 ? `${width}x${height}` : '';
    const parts = [resolution, v, a, c].filter(Boolean);
    return parts.length ? parts.join(' | ') : 'Unknown';
}

async function apiGet(path, token) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const error = body?.error || `HTTP ${response.status}`;
        throw new Error(error);
    }

    return body;
}

async function apiPost(path, token, payload) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload || {})
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const error = body?.error || `HTTP ${response.status}`;
        throw new Error(error);
    }

    return body;
}

function getJwtExpiryMs(jwtToken) {
    try {
        const parts = String(jwtToken || '').split('.');
        if (parts.length < 2) return 0;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const exp = Number(payload?.exp || 0);
        if (!Number.isFinite(exp) || exp <= 0) return 0;
        return exp * 1000;
    } catch (_) {
        return 0;
    }
}

async function getFirebaseIdTokenByEmailPassword() {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: NODECAST_EMAIL,
            password: NODECAST_PASSWORD,
            returnSecureToken: true
        })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.idToken) {
        throw new Error(body?.error?.message || 'Firebase login failed');
    }
    return body.idToken;
}

async function getAutoFetchedNodecastToken() {
    const now = Date.now();
    if (autoTokenCache.token && autoTokenCache.expiresAt - now > 60_000) {
        return autoTokenCache.token;
    }

    if (autoTokenPromise) return autoTokenPromise;
    autoTokenPromise = (async () => {
        if (!NODECAST_EMAIL || !NODECAST_PASSWORD) {
            throw new Error('NODECAST_EMAIL/NODECAST_PASSWORD not configured');
        }
        const firebaseIdToken = await getFirebaseIdTokenByEmailPassword();
        const result = await apiPost('/api/auth/firebase', firebaseIdToken, { idToken: firebaseIdToken });
        const nodecastJwt = result?.token;
        if (!nodecastJwt) throw new Error('LurkedTV auth token missing in /api/auth/firebase response');

        const exp = getJwtExpiryMs(nodecastJwt);
        autoTokenCache = {
            token: nodecastJwt,
            expiresAt: exp || (Date.now() + 5 * 60 * 1000)
        };
        return nodecastJwt;
    })();

    try {
        return await autoTokenPromise;
    } finally {
        autoTokenPromise = null;
    }
}

async function getNodecastTokenFromDiscordLink(discordUserId) {
    if (!NODECAST_DISCORD_AUTH_SECRET) return '';

    const response = await fetch(`${API_BASE_URL}/api/auth/discord/bot-token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET
        },
        body: JSON.stringify({ discordId: discordUserId })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        return '';
    }
    return String(body?.token || '');
}

async function getNodecastTokenForDiscordUser(discordUserId) {
    const linkedToken = await getNodecastTokenFromDiscordLink(discordUserId);
    if (linkedToken) return linkedToken;
    if (userTokenMap[discordUserId]) return userTokenMap[discordUserId];
    if (DEFAULT_NODECAST_TOKEN) return DEFAULT_NODECAST_TOKEN;
    return getAutoFetchedNodecastToken();
}

function isLikelyWatchingNow(historyItem) {
    if (!historyItem) return false;
    const updatedAt = Number(historyItem.updated_at || 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
    return (Date.now() - updatedAt) <= activeWindowMs;
}

async function getDownloadInfoForLatestItem(token) {
    const history = await apiGet('/api/history?limit=1', token);
    if (!Array.isArray(history) || history.length === 0) return null;

    const item = history[0];
    if (!isLikelyWatchingNow(item)) return null;

    const sourceId = item.source_id || item?.data?.sourceId;
    const itemId = item.item_id;
    const itemType = item.item_type;
    if (!sourceId || !itemId || !itemType) return null;

    const streamType = itemType === 'movie' ? 'movie' : 'series';
    const container = item?.data?.containerExtension || 'mp4';

    const stream = await apiGet(
        `/api/proxy/xtream/${encodeURIComponent(sourceId)}/stream/${encodeURIComponent(itemId)}/${encodeURIComponent(streamType)}?container=${encodeURIComponent(container)}`,
        token
    );

    const url = stream?.url;
    if (!url) return null;

    const absoluteUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    const title = getItemTitle(item);
    return { title, absoluteUrl, itemType, item };
}

async function getLatestHistoryItems(token, limit = 1) {
    const safeLimit = Math.max(1, Math.min(10, Number(limit) || 1));
    const history = await apiGet(`/api/history?limit=${safeLimit}`, token);
    return Array.isArray(history) ? history : [];
}

function formatHistoryItem(item) {
    const name = getItemTitle(item);
    const subtitle = getItemSubtitle(item);
    const type = getItemType(item);
    const progress = getProgressField(item);
    const watchedAt = Number(item?.updated_at || 0);
    const when = watchedAt > 0 ? `<t:${Math.floor(watchedAt / 1000)}:R>` : 'unknown time';
    return `- **${name}**${subtitle ? ` - ${truncateText(subtitle, 60)}` : ''} (${type}) - ${progress} - ${when}`;
}

function isDuplicateCommandMessage(messageId) {
    const now = Date.now();
    const lastSeen = processedMessageIds.get(messageId) || 0;
    if (lastSeen && (now - lastSeen) < commandDedupeWindowMs) {
        return true;
    }
    processedMessageIds.set(messageId, now);

    for (const [id, ts] of processedMessageIds.entries()) {
        if ((now - ts) > commandDedupeWindowMs) {
            processedMessageIds.delete(id);
        }
    }
    return false;
}

function buildHelpEmbed() {
    return buildEmbed({
        title: 'LurkedTV Bot Commands',
        description: [
            `\`${prefix}download\` - Get a direct download link for what you are currently watching.`,
            `\`${prefix}status\` - Show what you are currently watching.`,
            `\`${prefix}recent [count]\` - Show your recent watch history (default 3, max 10).`,
            `\`${prefix}ping\` - Check bot responsiveness.`,
            `\`${prefix}help\` - Show this command list.`
        ].join('\n'),
        color: 0x5865f2
    });
}

async function syncRuntimeConfigFromServer() {
    if (!NODECAST_DISCORD_AUTH_SECRET) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/discord-bot/runtime`, {
            headers: {
                'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET
            }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return;

        if (typeof body.prefix === 'string' && body.prefix.trim()) {
            prefix = body.prefix.trim().slice(0, 3);
        }
        if (Number.isFinite(Number(body.activeWindowMs))) {
            activeWindowMs = Number(body.activeWindowMs);
        }
        if (Number.isFinite(Number(body.commandDedupeWindowMs))) {
            commandDedupeWindowMs = Number(body.commandDedupeWindowMs);
        }
    } catch (_) {
        // Ignore transient sync failures.
    }
}

async function sendHeartbeat() {
    if (!NODECAST_DISCORD_AUTH_SECRET) return;
    try {
        await fetch(`${API_BASE_URL}/api/settings/discord-bot/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET
            },
            body: JSON.stringify({
                botTag: client.user?.tag || '',
                guildCount: client.guilds?.cache?.size || 0
            })
        });
    } catch (_) {
        // Ignore heartbeat failures.
    }
}

async function handleDownloadCommand(message) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const info = await getDownloadInfoForLatestItem(nodecastToken);
    if (!info) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: 'Nothing Playing',
                    description: 'You are not currently watching anything.',
                    color: 0xfee75c
                })
            ]
        });
        return;
    }

    await message.reply({
        embeds: [
            buildEmbed({
                title: 'Download Link Ready',
                description: `Here is the download link for **${info.title}**.`,
                color: 0x57f287,
                image: getPosterUrl(info.item),
                fields: [
                    {
                        name: 'Link',
                        value: info.absoluteUrl
                    },
                    {
                        name: 'Type',
                        value: info.itemType,
                        inline: true
                    },
                    {
                        name: 'Progress',
                        value: getProgressField(info.item),
                        inline: true
                    },
                    {
                        name: 'Stream',
                        value: getStreamDetails(info.item),
                        inline: false
                    }
                ],
                footer: getItemSubtitle(info.item) || undefined
            })
        ]
    });
}

async function handleStatusCommand(message) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const history = await getLatestHistoryItems(nodecastToken, 1);
    const item = history[0];
    if (!item || !isLikelyWatchingNow(item)) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: 'Status',
                    description: 'You are not currently watching anything.',
                    color: 0xfee75c
                })
            ]
        });
        return;
    }

    let streamLink = 'Unavailable';
    try {
        const sourceId = item.source_id || item?.data?.sourceId;
        const itemId = item.item_id;
        const itemType = item.item_type;
        if (sourceId && itemId && itemType) {
            const streamType = itemType === 'movie' ? 'movie' : 'series';
            const container = item?.data?.containerExtension || 'mp4';
            const stream = await apiGet(
                `/api/proxy/xtream/${encodeURIComponent(sourceId)}/stream/${encodeURIComponent(itemId)}/${encodeURIComponent(streamType)}?container=${encodeURIComponent(container)}`,
                nodecastToken
            );
            if (stream?.url) {
                streamLink = stream.url.startsWith('http')
                    ? stream.url
                    : `${API_BASE_URL}${stream.url.startsWith('/') ? '' : '/'}${stream.url}`;
            }
        }
    } catch (_) {
        // Ignore link lookup failures and keep embed responsive.
    }

    await message.reply({
        embeds: [
            buildEmbed({
                title: 'Now Watching',
                description: truncateText(getItemDescription(item), 350) || formatHistoryItem(item),
                color: 0x57f287,
                image: getPosterUrl(item),
                fields: [
                    {
                        name: 'Title',
                        value: getItemTitle(item),
                        inline: false
                    },
                    {
                        name: 'Type',
                        value: getItemType(item),
                        inline: true
                    },
                    {
                        name: 'Progress',
                        value: getProgressField(item),
                        inline: true
                    },
                    {
                        name: 'Updated',
                        value: Number(item?.updated_at || 0) > 0 ? `<t:${Math.floor(Number(item.updated_at) / 1000)}:R>` : 'unknown',
                        inline: true
                    },
                    {
                        name: 'Stream Link',
                        value: streamLink,
                        inline: false
                    }
                ],
                footer: getItemSubtitle(item) || undefined
            })
        ]
    });
}

async function handleRecentCommand(message, rawCount) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const requestedCount = Number(rawCount);
    const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10, requestedCount)) : 3;
    const history = await getLatestHistoryItems(nodecastToken, count);

    if (!history.length) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: 'Recent History',
                    description: 'No watch history found.',
                    color: 0xfee75c
                })
            ]
        });
        return;
    }

    await message.reply({
        embeds: [
            buildEmbed({
                title: `Recent History (last ${history.length})`,
                description: history.map(formatHistoryItem).join('\n'),
                color: 0x5865f2,
                thumbnail: getPosterUrl(history[0]) || undefined
            })
        ]
    });
}

if (!BOT_TOKEN) {
    console.error('[DiscordBot] Missing DISCORD_BOT_TOKEN in environment.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', async () => {
    console.log(`[DiscordBot] Logged in as ${client.user.tag}`);
    console.log(`[DiscordBot] Prefix: ${prefix}`);
    console.log(`[DiscordBot] Target guild: ${TARGET_GUILD_ID || '(not set)'}`);

    if (!TARGET_GUILD_ID) {
        console.warn('[DiscordBot] DISCORD_GUILD_ID is not configured.');
        return;
    }

    try {
        const guild = await client.guilds.fetch(TARGET_GUILD_ID);
        if (guild) {
            console.log(`[DiscordBot] Connected to guild: ${guild.name} (${guild.id})`);
        }
    } catch (err) {
        console.warn('[DiscordBot] Could not fetch target guild. Verify bot is invited to this server and token is correct.');
        console.warn(`[DiscordBot] Guild fetch error: ${err.message}`);
    }

    await syncRuntimeConfigFromServer();
    await sendHeartbeat();
    setInterval(() => {
        syncRuntimeConfigFromServer();
        sendHeartbeat();
    }, 30_000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;
    if (isDuplicateCommandMessage(message.id)) return;

    const [rawCommand, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = (rawCommand || '').toLowerCase();

    try {
        if (command === 'download') {
            await handleDownloadCommand(message);
            return;
        }

        if (command === 'status' || command === 'nowplaying') {
            await handleStatusCommand(message);
            return;
        }

        if (command === 'recent' || command === 'history') {
            await handleRecentCommand(message, args[0]);
            return;
        }

        if (command === 'ping') {
            await message.reply({
                embeds: [
                    buildEmbed({
                        title: 'Pong',
                        description: `Latency: ${Date.now() - message.createdTimestamp}ms`,
                        color: 0x57f287
                    })
                ]
            });
            return;
        }

        if (command === 'help' || command === '') {
            await message.reply({ embeds: [buildHelpEmbed()] });
            return;
        }
    } catch (err) {
        await message.reply({
            embeds: [
                    buildEmbed({
                        title: 'Command Failed',
                        description: `Could not complete \`${prefix}${command}\`.\n\n\`${err.message}\``,
                        color: 0xed4245
                    })
                ]
        });
    }
});

client.login(BOT_TOKEN);


