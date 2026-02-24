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

// ─── Brand Colors ──────────────────────────────────────────────────────────────
const COLORS = {
    primary:   0x6C63FF, // Electric violet — brand accent
    success:   0x3DD68C, // Mint green — playing / download ready
    warning:   0xFFB347, // Warm amber — nothing playing
    error:     0xFF5C5C, // Coral red — command failed
    info:      0x5CB8E4, // Sky blue — recent history
    neutral:   0x2B2D31, // Near-black — fallback
};

// ─── Emoji constants ───────────────────────────────────────────────────────────
const EMOJI = {
    play:      '▶️',
    download:  '⬇️',
    history:   '🕘',
    ping:      '🏓',
    help:      '📋',
    film:      '🎬',
    tv:        '📺',
    time:      '⏱️',
    stream:    '📡',
    link:      '🔗',
    updated:   '🔄',
    progress:  '📊',
    type:      '🎭',
    none:      '🚫',
    success:   '✅',
    error:     '❌',
    warning:   '⚠️',
    sparkle:   '✨',
    clock:     '🕐',
    gear:      '⚙️',
};

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

// ─── Enhanced Embed Builder ────────────────────────────────────────────────────

/**
 * Creates a richly styled embed. Extra options:
 *   authorName / authorIcon / authorUrl  → embed author line
 *   url                                  → clickable title
 */
function buildEmbed({
    title,
    description,
    color = COLORS.neutral,
    fields = [],
    thumbnail,
    image,
    footer,
    authorName,
    authorIcon,
    authorUrl,
    url,
}) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp();

    if (title) embed.setTitle(title);
    if (url) embed.setURL(url);
    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);
    if (footer) embed.setFooter({ text: footer, iconURL: undefined });
    if (authorName) embed.setAuthor({ name: authorName, iconURL: authorIcon || undefined, url: authorUrl || undefined });

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

function buildProgressBar(progress, duration, barLength = 14) {
    const p = Math.max(0, Math.floor(Number(progress) || 0));
    const d = Math.max(0, Math.floor(Number(duration) || 0));
    if (!d) return formatSeconds(p);

    const pct = Math.max(0, Math.min(1, p / d));
    const filled = Math.round(pct * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const pctLabel = Math.floor(pct * 100);
    return `\`${bar}\` ${pctLabel}%\n${formatSeconds(p)} / ${formatSeconds(d)}`;
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
    const raw = sanitizeEmbedText(item?.item_type || 'unknown', 'unknown');
    // Capitalise first letter
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isSeriesLikeItem(item) {
    const t = sanitizeEmbedText(item?.item_type, '').toLowerCase();
    return t === 'series' || t === 'episode';
}

function toPositiveInt(value) {
    const n = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSeasonEpisodeFromSubtitle(subtitle) {
    const s = sanitizeEmbedText(subtitle, '');
    if (!s) return { season: null, episode: null, episodeTitle: '' };

    // Supports patterns like:
    // S2 E5 - Title, S02E05 - Title, Season 2 Episode 5 - Title
    const se = s.match(/S(?:eason)?\s*0*(\d+)\s*E(?:pisode)?\s*0*(\d+)(?:\s*[-:]\s*(.+))?/i);
    if (se) {
        return {
            season: toPositiveInt(se[1]),
            episode: toPositiveInt(se[2]),
            episodeTitle: sanitizeEmbedText(se[3], ''),
        };
    }

    const full = s.match(/Season\s*0*(\d+)\s*Episode\s*0*(\d+)(?:\s*[-:]\s*(.+))?/i);
    if (full) {
        return {
            season: toPositiveInt(full[1]),
            episode: toPositiveInt(full[2]),
            episodeTitle: sanitizeEmbedText(full[3], ''),
        };
    }

    return { season: null, episode: null, episodeTitle: '' };
}

function getSeriesContext(item) {
    const data = item?.data || {};
    const subtitle = getItemSubtitle(item);
    const parsed = parseSeasonEpisodeFromSubtitle(subtitle);

    const season = toPositiveInt(
        data.currentSeason ?? data.season ?? data.seasonNum ?? data.seasonNumber ?? data.season_number
    ) ?? parsed.season;

    const episode = toPositiveInt(
        data.currentEpisode ?? data.episode ?? data.episodeNum ?? data.episodeNumber ?? data.episode_number
    ) ?? parsed.episode;

    const episodeTitle = sanitizeEmbedText(
        data.episodeTitle ?? data.episode_title ?? data.title2,
        ''
    ) || parsed.episodeTitle;

    return { season, episode, episodeTitle };
}

function getTypeEmoji(item) {
    const t = (item?.item_type || '').toLowerCase();
    if (t === 'movie') return EMOJI.film;
    if (t === 'series' || t === 'episode') return EMOJI.tv;
    return EMOJI.type;
}

function getProgressField(item) {
    const progress = Number(item?.progress || 0);
    const duration = Number(item?.duration || item?.data?.duration || 0);
    return buildProgressText(progress, duration);
}

function getProgressBar(item) {
    const progress = Number(item?.progress || 0);
    const duration = Number(item?.duration || item?.data?.duration || 0);
    return buildProgressBar(progress, duration);
}

function getStreamDetails(item) {
    const width = Number(item?.data?.streamWidth || 0);
    const height = Number(item?.data?.streamHeight || 0);
    const v = sanitizeEmbedText(item?.data?.streamVideoCodec, '');
    const a = sanitizeEmbedText(item?.data?.streamAudioCodec, '');
    const c = sanitizeEmbedText(item?.data?.streamContainer, '');
    const resolution = width > 0 && height > 0 ? `${width}×${height}` : '';
    const parts = [resolution, v, a, c].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Unknown';
}

function toAbsoluteUrl(url) {
    const s = sanitizeEmbedText(url, '');
    if (!s) return '';
    return s.startsWith('http')
        ? s
        : `${API_BASE_URL}${s.startsWith('/') ? '' : '/'}${s}`;
}

function uniqueValues(values) {
    const out = [];
    const seen = new Set();
    for (const v of values) {
        const s = sanitizeEmbedText(v, '').toLowerCase();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function getContainerCandidates(item, streamType = 'series') {
    const preferred = [
        item?.data?.containerExtension,
        item?.data?.streamContainer,
        item?.data?.container,
    ];
    const defaults = streamType === 'movie'
        ? ['mp4', 'mkv', 'avi']
        : ['mkv', 'mp4', 'm3u8', 'ts'];
    return uniqueValues([...preferred, ...defaults]);
}

async function tryResolveStreamUrl(token, sourceId, streamId, streamType, containerCandidates = []) {
    const containers = uniqueValues(containerCandidates.length ? containerCandidates : ['mp4']);
    for (const container of containers) {
        try {
            const stream = await apiGet(
                `/api/proxy/xtream/${encodeURIComponent(sourceId)}/stream/${encodeURIComponent(streamId)}/${encodeURIComponent(streamType)}?container=${encodeURIComponent(container)}`,
                token
            );
            if (stream?.url) return { url: toAbsoluteUrl(stream.url), container };
        } catch (_) { /* try next container */ }
    }
    return null;
}

function findEpisodeFromSeriesInfo(seriesInfo, seriesCtx, fallbackEpisodeId) {
    const episodesBySeason = seriesInfo?.episodes;
    if (!episodesBySeason || typeof episodesBySeason !== 'object') return null;

    const targetSeason = toPositiveInt(seriesCtx?.season);
    const targetEpisode = toPositiveInt(seriesCtx?.episode);

    const candidates = [];
    for (const [seasonKey, list] of Object.entries(episodesBySeason)) {
        if (!Array.isArray(list)) continue;
        for (const ep of list) {
            candidates.push({
                ...ep,
                _season: toPositiveInt(seasonKey),
                _episode: toPositiveInt(ep?.episode_num ?? ep?.episode ?? ep?.episodeNumber),
                _id: sanitizeEmbedText(ep?.id ?? ep?.stream_id ?? ep?.episode_id, ''),
                _container: sanitizeEmbedText(ep?.container_extension ?? ep?.container, ''),
            });
        }
    }

    if (!candidates.length) return null;

    if (targetSeason && targetEpisode) {
        const exact = candidates.find(ep => ep._season === targetSeason && ep._episode === targetEpisode);
        if (exact) return exact;
    }

    const fallbackId = sanitizeEmbedText(fallbackEpisodeId, '');
    if (fallbackId) {
        const byId = candidates.find(ep => ep._id === fallbackId);
        if (byId) return byId;
    }

    return candidates[0];
}

async function resolveHistoryItemStreamLink(token, item) {
    const sourceId = item?.source_id || item?.data?.sourceId;
    const itemId = sanitizeEmbedText(item?.item_id, '');
    const itemType = sanitizeEmbedText(item?.item_type, '');
    if (!sourceId || !itemId || !itemType) return null;

    const streamType = itemType === 'movie' ? 'movie' : 'series';
    const baseContainers = getContainerCandidates(item, streamType);

    // First attempt: direct item_id from history row.
    const direct = await tryResolveStreamUrl(token, sourceId, itemId, streamType, baseContainers);
    if (direct?.url) return direct.url;

    // Series fallback: resolve episode ID/container via series_info.
    if (streamType !== 'series') return null;
    const seriesId = sanitizeEmbedText(item?.data?.seriesId || item?.parent_id, '');
    if (!seriesId) return null;

    try {
        const seriesInfo = await apiGet(
            `/api/proxy/xtream/${encodeURIComponent(sourceId)}/series_info?series_id=${encodeURIComponent(seriesId)}`,
            token
        );
        const seriesCtx = getSeriesContext(item);
        const episode = findEpisodeFromSeriesInfo(seriesInfo, seriesCtx, itemId);
        const episodeId = sanitizeEmbedText(episode?._id, '');
        if (!episodeId) return null;

        const fallbackContainers = uniqueValues([
            episode?._container,
            ...baseContainers,
        ]);
        const resolved = await tryResolveStreamUrl(token, sourceId, episodeId, 'series', fallbackContainers);
        return resolved?.url || null;
    } catch (_) {
        return null;
    }
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(path, token) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
}

async function apiPost(path, token, payload) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    });
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
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
    } catch (_) { return 0; }
}

async function getFirebaseIdTokenByEmailPassword() {
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: NODECAST_EMAIL, password: NODECAST_PASSWORD, returnSecureToken: true })
        }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.idToken) throw new Error(body?.error?.message || 'Firebase login failed');
    return body.idToken;
}

async function getAutoFetchedNodecastToken() {
    const now = Date.now();
    if (autoTokenCache.token && autoTokenCache.expiresAt - now > 60_000) return autoTokenCache.token;
    if (autoTokenPromise) return autoTokenPromise;

    autoTokenPromise = (async () => {
        if (!NODECAST_EMAIL || !NODECAST_PASSWORD) throw new Error('NODECAST_EMAIL/NODECAST_PASSWORD not configured');
        const firebaseIdToken = await getFirebaseIdTokenByEmailPassword();
        const result = await apiPost('/api/auth/firebase', firebaseIdToken, { idToken: firebaseIdToken });
        const nodecastJwt = result?.token;
        if (!nodecastJwt) throw new Error('LurkedTV auth token missing in /api/auth/firebase response');
        const exp = getJwtExpiryMs(nodecastJwt);
        autoTokenCache = { token: nodecastJwt, expiresAt: exp || (Date.now() + 5 * 60 * 1000) };
        return nodecastJwt;
    })();

    try { return await autoTokenPromise; } finally { autoTokenPromise = null; }
}

async function getNodecastTokenFromDiscordLink(discordUserId) {
    if (!NODECAST_DISCORD_AUTH_SECRET) return '';
    const response = await fetch(`${API_BASE_URL}/api/auth/discord/bot-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET },
        body: JSON.stringify({ discordId: discordUserId })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return '';
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
    const itemType = item.item_type;
    if (!sourceId || !itemType) return null;

    const absoluteUrl = await resolveHistoryItemStreamLink(token, item);
    if (!absoluteUrl) return null;
    return { title: getItemTitle(item), absoluteUrl, itemType, item };
}

async function getLatestHistoryItems(token, limit = 1) {
    const safeLimit = Math.max(1, Math.min(10, Number(limit) || 1));
    const history = await apiGet(`/api/history?limit=${safeLimit}`, token);
    return Array.isArray(history) ? history : [];
}

function formatHistoryItem(item, index) {
    const name = getItemTitle(item);
    const subtitle = getItemSubtitle(item);
    const typeEmoji = getTypeEmoji(item);
    const progress = getProgressField(item);
    const seriesCtx = getSeriesContext(item);
    const watchedAt = Number(item?.updated_at || 0);
    const when = watchedAt > 0 ? `<t:${Math.floor(watchedAt / 1000)}:R>` : 'unknown';
    const num = index !== undefined ? `**${index + 1}.** ` : '';
    const sub = subtitle ? ` — *${truncateText(subtitle, 50)}*` : '';
    const se =
        isSeriesLikeItem(item) && (seriesCtx.season || seriesCtx.episode)
            ? ` · S${seriesCtx.season || '?'}E${seriesCtx.episode || '?'}`
            : '';
    return `${num}${typeEmoji} **${name}**${sub}\n   ${EMOJI.progress} ${progress}${se} · ${EMOJI.clock} ${when}`;
}

function isDuplicateCommandMessage(messageId) {
    const now = Date.now();
    const lastSeen = processedMessageIds.get(messageId) || 0;
    if (lastSeen && (now - lastSeen) < commandDedupeWindowMs) return true;
    processedMessageIds.set(messageId, now);
    for (const [id, ts] of processedMessageIds.entries()) {
        if ((now - ts) > commandDedupeWindowMs) processedMessageIds.delete(id);
    }
    return false;
}

// ─── Embed builders ────────────────────────────────────────────────────────────

function buildHelpEmbed() {
    return buildEmbed({
        title: `${EMOJI.help} LurkedTV — Command Reference`,
        description: '> Stream, track, and download your media right from Discord.',
        color: COLORS.primary,
        fields: [
            {
                name: `${EMOJI.download} \`${prefix}download\``,
                value: 'Get a direct download link for what you are currently watching.',
                inline: false,
            },
            {
                name: `${EMOJI.play} \`${prefix}status\``,
                value: 'Show your currently playing title with live progress.',
                inline: false,
            },
            {
                name: `${EMOJI.history} \`${prefix}recent [count]\``,
                value: 'Show your recent watch history. Default **3**, max **10**.',
                inline: false,
            },
            {
                name: `${EMOJI.ping} \`${prefix}ping\``,
                value: 'Check bot response latency.',
                inline: false,
            },
            {
                name: `${EMOJI.help} \`${prefix}help\``,
                value: 'Show this command list.',
                inline: false,
            },
        ],
        footer: 'LurkedTV Bot  •  Powered by NodeCast',
        authorName: 'LurkedTV',
    });
}

function buildNothingPlayingEmbed(context = 'watching') {
    const contextMap = {
        watching: 'You are not currently watching anything.',
        download: 'There is nothing currently playing to generate a download link for.',
    };
    return buildEmbed({
        title: `${EMOJI.none} Nothing Playing`,
        description: contextMap[context] || contextMap.watching,
        color: COLORS.warning,
        footer: `Active window: ${Math.round(activeWindowMs / 60000)} min`,
    });
}

function buildErrorEmbed(command, errorMessage) {
    return buildEmbed({
        title: `${EMOJI.error} Command Failed`,
        description: [
            `An error occurred while running \`${prefix}${command}\`.`,
            '',
            `\`\`\`${errorMessage}\`\`\``,
        ].join('\n'),
        color: COLORS.error,
        footer: 'If this keeps happening, check your API connection.',
    });
}

// ─── Command handlers ──────────────────────────────────────────────────────────

async function handleDownloadCommand(message) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const info = await getDownloadInfoForLatestItem(nodecastToken);

    if (!info) {
        await message.reply({ embeds: [buildNothingPlayingEmbed('download')] });
        return;
    }

    const { title, absoluteUrl, itemType, item } = info;
    const subtitle = getItemSubtitle(item);
    const poster = getPosterUrl(item);

    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.download} Download Ready`,
                description: [
                    `### ${getTypeEmoji(item)} ${title}`,
                    subtitle ? `*${subtitle}*` : '',
                    '',
                    `${EMOJI.link} **[Click to download](${absoluteUrl})**`,
                ].filter(line => line !== null).join('\n'),
                color: COLORS.success,
                image: poster || undefined,
                fields: [
                    {
                        name: `${EMOJI.type} Type`,
                        value: getItemType(item),
                        inline: true,
                    },
                    {
                        name: `${EMOJI.time} Progress`,
                        value: getProgressField(item),
                        inline: true,
                    },
                    {
                        name: `${EMOJI.stream} Stream Info`,
                        value: getStreamDetails(item),
                        inline: false,
                    },
                    {
                        name: `${EMOJI.link} Direct URL`,
                        value: `\`\`\`${absoluteUrl}\`\`\``,
                        inline: false,
                    },
                ],
                footer: `Requested by ${message.author.username}`,
                authorName: 'LurkedTV Download',
            }),
        ],
    });
}

async function handleStatusCommand(message) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const history = await getLatestHistoryItems(nodecastToken, 1);
    const item = history[0];

    if (!item || !isLikelyWatchingNow(item)) {
        await message.reply({ embeds: [buildNothingPlayingEmbed('watching')] });
        return;
    }

    let streamLink = null;
    try {
        streamLink = await resolveHistoryItemStreamLink(nodecastToken, item);
    } catch (_) { /* keep embed responsive */ }

    const title = getItemTitle(item);
    const subtitle = getItemSubtitle(item);
    const desc = getItemDescription(item);
    const poster = getPosterUrl(item);
    const seriesCtx = getSeriesContext(item);
    const updatedAt = Number(item?.updated_at || 0);

    const descLines = [
        `### ${getTypeEmoji(item)} ${title}`,
        subtitle ? `*${subtitle}*` : '',
        '',
        desc ? truncateText(desc, 300) : '',
    ].filter(l => l !== null);

    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.play} Now Watching`,
                description: descLines.join('\n'),
                color: COLORS.success,
                image: poster || undefined,
                fields: [
                    {
                        name: `${EMOJI.type} Type`,
                        value: getItemType(item),
                        inline: true,
                    },
                    ...(isSeriesLikeItem(item)
                        ? [{
                            name: `${EMOJI.tv} Episode`,
                            value: (seriesCtx.season || seriesCtx.episode)
                                ? `S${seriesCtx.season || '?'}E${seriesCtx.episode || '?'}`
                                : 'Unknown',
                            inline: true,
                          }]
                        : []),
                    ...(isSeriesLikeItem(item) && seriesCtx.episodeTitle
                        ? [{
                            name: `${EMOJI.sparkle} Episode Title`,
                            value: truncateText(seriesCtx.episodeTitle, 120),
                            inline: true,
                          }]
                        : []),
                    {
                        name: `${EMOJI.updated} Last Updated`,
                        value: updatedAt > 0 ? `<t:${Math.floor(updatedAt / 1000)}:R>` : 'Unknown',
                        inline: true,
                    },
                    {
                        name: `${EMOJI.stream} Stream Info`,
                        value: getStreamDetails(item),
                        inline: false,
                    },
                    {
                        name: `${EMOJI.progress} Progress`,
                        value: getProgressBar(item),
                        inline: false,
                    },
                    ...(streamLink
                        ? [{
                            name: `${EMOJI.link} Stream URL`,
                            value: `[Open Stream](${streamLink})`,
                            inline: false,
                          }]
                        : []),
                ],
                footer: `Requested by ${message.author.username}`,
                authorName: 'LurkedTV Status',
            }),
        ],
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
                    title: `${EMOJI.history} Recent History`,
                    description: 'No watch history found.',
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    const mostRecent = history[0];
    const thumbnail = getPosterUrl(mostRecent) || undefined;

    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.history} Watch History — Last ${history.length}`,
                description: history.map((item, i) => formatHistoryItem(item, i)).join('\n\n'),
                color: COLORS.info,
                thumbnail,
                footer: `${message.author.username}  •  Showing ${history.length} of up to ${count}`,
                authorName: 'LurkedTV History',
            }),
        ],
    });
}

// ─── Runtime sync & heartbeat ──────────────────────────────────────────────────

async function syncRuntimeConfigFromServer() {
    if (!NODECAST_DISCORD_AUTH_SECRET) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/discord-bot/runtime`, {
            headers: { 'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return;
        if (typeof body.prefix === 'string' && body.prefix.trim()) prefix = body.prefix.trim().slice(0, 3);
        if (Number.isFinite(Number(body.activeWindowMs))) activeWindowMs = Number(body.activeWindowMs);
        if (Number.isFinite(Number(body.commandDedupeWindowMs))) commandDedupeWindowMs = Number(body.commandDedupeWindowMs);
    } catch (_) {}
}

async function sendHeartbeat() {
    if (!NODECAST_DISCORD_AUTH_SECRET) return;
    try {
        await fetch(`${API_BASE_URL}/api/settings/discord-bot/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-auth': NODECAST_DISCORD_AUTH_SECRET },
            body: JSON.stringify({ botTag: client.user?.tag || '', guildCount: client.guilds?.cache?.size || 0 })
        });
    } catch (_) {}
}

// ─── Bot bootstrap ─────────────────────────────────────────────────────────────

if (!BOT_TOKEN) {
    console.error('[DiscordBot] Missing DISCORD_BOT_TOKEN in environment.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
        if (guild) console.log(`[DiscordBot] Connected to guild: ${guild.name} (${guild.id})`);
    } catch (err) {
        console.warn('[DiscordBot] Could not fetch target guild. Verify bot is invited and token is correct.');
        console.warn(`[DiscordBot] Guild fetch error: ${err.message}`);
    }

    await syncRuntimeConfigFromServer();
    await sendHeartbeat();
    setInterval(() => { syncRuntimeConfigFromServer(); sendHeartbeat(); }, 30_000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;
    if (isDuplicateCommandMessage(message.id)) return;

    const [rawCommand, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = (rawCommand || '').toLowerCase();

    try {
        if (command === 'download') { await handleDownloadCommand(message); return; }
        if (command === 'status' || command === 'nowplaying') { await handleStatusCommand(message); return; }
        if (command === 'recent' || command === 'history') { await handleRecentCommand(message, args[0]); return; }

        if (command === 'ping') {
            const latency = Date.now() - message.createdTimestamp;
            await message.reply({
                embeds: [
                    buildEmbed({
                        title: `${EMOJI.ping} Pong!`,
                        description: `Roundtrip latency: **${latency}ms**\nAPI latency: **${Math.round(client.ws.ping)}ms**`,
                        color: latency < 100 ? COLORS.success : latency < 300 ? COLORS.warning : COLORS.error,
                        footer: 'LurkedTV Bot',
                    }),
                ],
            });
            return;
        }

        if (command === 'help' || command === '') {
            await message.reply({ embeds: [buildHelpEmbed()] });
            return;
        }
    } catch (err) {
        await message.reply({
            embeds: [buildErrorEmbed(command, err.message)],
        });
    }
});

client.login(BOT_TOKEN);
