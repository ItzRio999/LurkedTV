require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');

let prefix = process.env.DISCORD_BOT_PREFIX || '.';
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
const MUST_WATCH_MEMORY_FILE = path.join(__dirname, '..', 'data', 'discord-bot', 'mustwatch-seen.json');
let mustWatchMemoryLoaded = false;
let mustWatchMemoryCache = null;
let mustWatchMemoryWriteQueue = Promise.resolve();

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

function formatCount(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
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

async function apiPut(path, token, payload) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'PUT',
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
    throw new Error('Your Discord account is not linked to a LurkedTV account.');
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSourceSyncStatuses(token) {
    const statuses = await apiGet('/api/sources/status', token);
    return Array.isArray(statuses) ? statuses : [];
}

async function getSourceProcessingStats(token, sourceIds = []) {
    const uniqueIds = [...new Set((sourceIds || []).map(id => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) {
        return { statsById: new Map(), totals: { channels: 0, programmes: 0, movies: 0, series: 0, items: 0 } };
    }

    const query = encodeURIComponent(uniqueIds.join(','));
    const payload = await apiGet(`/api/sources/stats?sourceIds=${query}`, token);
    const rows = Array.isArray(payload?.stats) ? payload.stats : [];
    const statsById = new Map(
        rows.map((row) => {
            const sid = String(row?.sourceId ?? '');
            return [sid, {
                channels: Number(row?.channels || 0),
                programmes: Number(row?.programmes || 0),
                movies: Number(row?.movies || 0),
                series: Number(row?.series || 0),
                items: Number(row?.items || 0),
            }];
        })
    );

    const totals = {
        channels: Number(payload?.totals?.channels || 0),
        programmes: Number(payload?.totals?.programmes || 0),
        movies: Number(payload?.totals?.movies || 0),
        series: Number(payload?.totals?.series || 0),
        items: Number(payload?.totals?.items || 0),
    };

    return { statsById, totals };
}

function getLatestAllSyncStatusForSource(statuses, sourceId) {
    const sid = String(sourceId);
    const rows = statuses
        .filter(row => String(row?.source_id) === sid && String(row?.type || '').toLowerCase() === 'all')
        .sort((a, b) => Number(b?.last_sync || 0) - Number(a?.last_sync || 0));
    return rows[0] || null;
}

async function waitForRefreshCompletion(token, sourceIds, startedAfterMs, timeoutMs = 20 * 60 * 1000, pollMs = 5000) {
    const pending = new Set((sourceIds || []).map(id => String(id)));
    const results = new Map();
    const deadline = Date.now() + timeoutMs;

    while (pending.size > 0 && Date.now() < deadline) {
        const statuses = await getSourceSyncStatuses(token);
        for (const sid of [...pending]) {
            const latest = getLatestAllSyncStatusForSource(statuses, sid);
            if (!latest) continue;

            const lastSync = Number(latest?.last_sync || 0);
            if (!Number.isFinite(lastSync) || lastSync < (startedAfterMs - 1500)) continue;

            const status = String(latest?.status || '').toLowerCase();
            if (status === 'success' || status === 'error') {
                results.set(sid, {
                    status,
                    error: sanitizeEmbedText(latest?.error, ''),
                    lastSync,
                });
                pending.delete(sid);
            }
        }

        if (pending.size > 0) await sleep(pollMs);
    }

    return { timedOut: pending.size > 0, pending: [...pending], results };
}

async function monitorRefreshAndNotify({
    message,
    token,
    sourceIds = [],
    sourceNameById = {},
    startedAfterMs,
    scopeLabel,
    requestedByLabel,
}) {
    try {
        const outcome = await waitForRefreshCompletion(token, sourceIds, startedAfterMs);
        if (outcome.timedOut) {
            await message.reply({
                embeds: [
                    buildEmbed({
                        title: `${EMOJI.warning} Refresh Still Running`,
                        description: `Refresh for **${scopeLabel}** is still in progress (or timed out waiting).`,
                        color: COLORS.warning,
                    }),
                ],
            });
            return;
        }

        const failed = [];
        for (const [sid, result] of outcome.results.entries()) {
            if (result.status !== 'error') continue;
            failed.push({
                sourceId: sid,
                sourceName: sanitizeEmbedText(sourceNameById[sid], `Source ${sid}`),
                error: sanitizeEmbedText(result.error, 'Unknown sync failure'),
            });
        }

        if (failed.length) {
            const lines = failed.map(f => `**${f.sourceName}** (ID: \`${f.sourceId}\`)\n\`\`\`${f.error}\`\`\``);
            await message.reply({
                embeds: [
                    buildEmbed({
                        title: `${EMOJI.error} Refresh Failed`,
                        description: lines.join('\n\n'),
                        color: COLORS.error,
                        footer: requestedByLabel ? `Requested by ${requestedByLabel}` : undefined,
                    }),
                ],
            });
            return;
        }

        let statsById = new Map();
        let totals = { channels: 0, programmes: 0, movies: 0, series: 0, items: 0 };
        try {
            const statsPayload = await getSourceProcessingStats(token, sourceIds);
            statsById = statsPayload.statsById;
            totals = statsPayload.totals;
        } catch (_) {
            // Keep completion notification resilient even if stats lookup fails.
        }

        const fields = [];
        if (requestedByLabel) {
            fields.push({ name: 'Requested By', value: requestedByLabel, inline: true });
        }
        if (sourceIds.length === 1) {
            const sid = String(sourceIds[0]);
            const sourceName = sanitizeEmbedText(sourceNameById[sid], `Source ${sid}`);
            fields.push({ name: 'Playlist', value: `${sourceName} (ID: \`${sid}\`)`, inline: true });
            const stats = statsById.get(sid);
            if (stats) {
                fields.push({
                    name: 'Processed',
                    value: `${formatCount(stats.channels)} channels\n${formatCount(stats.programmes)} programmes\n${formatCount(stats.movies)} movies\n${formatCount(stats.series)} series`,
                    inline: true,
                });
            }
        } else {
            fields.push({ name: 'Playlists', value: `${formatCount(sourceIds.length)} refreshed`, inline: true });
            if (totals) {
                fields.push({
                    name: 'Processed',
                    value: `${formatCount(totals.channels)} channels\n${formatCount(totals.programmes)} programmes\n${formatCount(totals.movies)} movies\n${formatCount(totals.series)} series`,
                    inline: true,
                });
            }

            const perPlaylist = sourceIds
                .map((sid) => {
                    const sourceName = sanitizeEmbedText(sourceNameById[sid], `Source ${sid}`);
                    const stats = statsById.get(String(sid));
                    if (!stats) return null;
                    return `- ${sourceName}: ${formatCount(stats.channels)} ch, ${formatCount(stats.programmes)} prog, ${formatCount(stats.movies)} mov, ${formatCount(stats.series)} ser`;
                })
                .filter(Boolean);
            if (perPlaylist.length) {
                const visible = perPlaylist.slice(0, 8);
                const remaining = perPlaylist.length - visible.length;
                if (remaining > 0) visible.push(`...and ${remaining} more`);
                fields.push({ name: 'By Playlist', value: visible.join('\n'), inline: false });
            }
        }

        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.success} Refresh Completed`,
                    description: `Refresh finished successfully for **${scopeLabel}**.`,
                    fields,
                    color: COLORS.success,
                }),
            ],
        });
    } catch (err) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.error} Refresh Monitor Error`,
                    description: `\`\`\`${sanitizeEmbedText(err?.message, 'Unknown error')}\`\`\``,
                    color: COLORS.error,
                }),
            ],
        });
    }
}

function createEmptyMustWatchMemory() {
    return { version: 1, users: {} };
}

function getMovieMemoryKey(movie) {
    const sourceId = sanitizeEmbedText(movie?.sourceId, '');
    const itemId = sanitizeEmbedText(movie?.itemId, '');
    if (sourceId && itemId) return `${sourceId}:${itemId}`;
    const title = sanitizeEmbedText(movie?.title, '').toLowerCase();
    const year = sanitizeEmbedText(movie?.year, '');
    return title ? `${title}:${year}` : '';
}

async function loadMustWatchMemory() {
    if (mustWatchMemoryLoaded && mustWatchMemoryCache) return mustWatchMemoryCache;

    try {
        const raw = await fs.readFile(MUST_WATCH_MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const users = parsed.users && typeof parsed.users === 'object' && !Array.isArray(parsed.users) ? parsed.users : {};
            mustWatchMemoryCache = { version: 1, users };
        } else {
            mustWatchMemoryCache = createEmptyMustWatchMemory();
        }
    } catch (_) {
        mustWatchMemoryCache = createEmptyMustWatchMemory();
    }

    mustWatchMemoryLoaded = true;
    return mustWatchMemoryCache;
}

function queueMustWatchMemoryWrite() {
    mustWatchMemoryWriteQueue = mustWatchMemoryWriteQueue
        .then(async () => {
            const payload = mustWatchMemoryCache || createEmptyMustWatchMemory();
            await fs.mkdir(path.dirname(MUST_WATCH_MEMORY_FILE), { recursive: true });
            await fs.writeFile(MUST_WATCH_MEMORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
        })
        .catch((err) => {
            console.warn('[DiscordBot] Failed to persist must-watch memory:', err.message);
        });
    return mustWatchMemoryWriteQueue;
}

async function getSeenMovieKeysForUser(discordUserId) {
    const memory = await loadMustWatchMemory();
    const userBucket = memory?.users?.[discordUserId];
    const seen = userBucket?.seen;
    if (!seen || typeof seen !== 'object') return new Set();
    return new Set(Object.keys(seen));
}

async function markMoviesAsSeenForUser(discordUserId, movies) {
    if (!discordUserId || !Array.isArray(movies) || !movies.length) return;
    const memory = await loadMustWatchMemory();
    if (!memory.users[discordUserId]) memory.users[discordUserId] = { seen: {} };
    if (!memory.users[discordUserId].seen || typeof memory.users[discordUserId].seen !== 'object') {
        memory.users[discordUserId].seen = {};
    }

    const now = Date.now();
    for (const movie of movies) {
        const key = getMovieMemoryKey(movie);
        if (!key) continue;
        const existing = memory.users[discordUserId].seen[key];
        memory.users[discordUserId].seen[key] = {
            key,
            sourceId: movie?.sourceId || null,
            itemId: movie?.itemId || null,
            title: movie?.title || 'Unknown Movie',
            year: movie?.year || null,
            firstSeenAt: existing?.firstSeenAt || now,
            lastSeenAt: now,
            timesRecommended: Number(existing?.timesRecommended || 0) + 1,
        };
    }

    await queueMustWatchMemoryWrite();
}

async function getUnseenMoviesForUser(discordUserId, movies) {
    const seenKeys = await getSeenMovieKeysForUser(discordUserId);
    return movies.filter(movie => {
        const key = getMovieMemoryKey(movie);
        return key && !seenKeys.has(key);
    });
}

async function resetSeenMoviesForUser(discordUserId) {
    if (!discordUserId) return 0;
    const memory = await loadMustWatchMemory();
    const userBucket = memory?.users?.[discordUserId];
    const seen = userBucket?.seen && typeof userBucket.seen === 'object' ? userBucket.seen : {};
    const count = Object.keys(seen).length;
    delete memory.users[discordUserId];
    await queueMustWatchMemoryWrite();
    return count;
}

function parseNumericRating(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value <= 0) return null;
        return value > 10 ? (value / 10) : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed > 10 ? (parsed / 10) : parsed;
}

function formatRatingLabel(value) {
    const n = parseNumericRating(value);
    if (!n) return 'N/A';
    return `${Math.min(10, n).toFixed(1)}/10`;
}

function parseYearValue(...candidates) {
    for (const value of candidates) {
        const raw = String(value ?? '').trim();
        if (!raw) continue;
        const match = raw.match(/\b(19|20)\d{2}\b/);
        if (!match) continue;
        const year = Number(match[0]);
        if (Number.isFinite(year)) return year;
    }
    return null;
}

function parseTimestampMs(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value <= 0) return 0;
        return value > 10_000_000_000 ? value : (value * 1000);
    }
    const raw = String(value).trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) {
        const asNum = Number(raw);
        if (Number.isFinite(asNum) && asNum > 0) {
            return asNum > 10_000_000_000 ? asNum : (asNum * 1000);
        }
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMovieItem(item) {
    const data = item?.data && typeof item.data === 'object' ? item.data : {};
    const title = sanitizeEmbedText(item?.name || data.title || data.name, 'Unknown Movie');
    const rating = parseNumericRating(
        data.rating ??
        data.vote_average ??
        data.votes ??
        item?.rating
    );
    const year = parseYearValue(
        item?.year,
        data.year,
        data.releaseDate,
        data.releasedate,
        data.release_date
    );
    const addedAtMs = parseTimestampMs(item?.added_at ?? data.added ?? data.added_at ?? data.last_modified);

    return {
        sourceId: item?.source_id,
        itemId: sanitizeEmbedText(item?.item_id, ''),
        title,
        rating,
        year,
        addedAtMs,
        container: sanitizeEmbedText(item?.container_extension || data.container_extension || data.containerExtension, ''),
        poster: sanitizeEmbedText(item?.stream_icon || data.poster || data.stream_icon || data.cover, ''),
        thumbnail: sanitizeEmbedText(data.cover_big || data.cover || data.stream_icon || item?.stream_icon || '', ''),
    };
}

function rankMustWatchMovies(items, limit = 5) {
    const normalized = items.map(normalizeMovieItem).filter(m => m.itemId && m.sourceId);
    normalized.sort((a, b) => {
        const ar = a.rating ?? -1;
        const br = b.rating ?? -1;
        if (br !== ar) return br - ar;

        const ay = a.year ?? 0;
        const by = b.year ?? 0;
        if (by !== ay) return by - ay;

        return (b.addedAtMs || 0) - (a.addedAtMs || 0);
    });

    const unique = [];
    const seen = new Set();
    for (const movie of normalized) {
        const key = movie.title.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(movie);
        if (unique.length >= limit) break;
    }
    return unique;
}

async function resolveCatalogMovieStreamLink(token, movie) {
    if (!movie?.sourceId || !movie?.itemId) return null;
    const fakeHistoryItem = {
        data: {
            containerExtension: movie.container,
            streamContainer: movie.container,
        }
    };
    const containers = getContainerCandidates(fakeHistoryItem, 'movie');
    const resolved = await tryResolveStreamUrl(token, movie.sourceId, movie.itemId, 'movie', containers);
    return resolved?.url || null;
}

async function getMustWatchMovies(token, discordUserId, limit = 5) {
    const poolSize = Math.max(20, Math.min(100, limit * 12));
    const movies = await apiGet(`/api/channels/recent?type=movie&limit=${poolSize}`, token);
    if (!Array.isArray(movies) || !movies.length) return [];
    const ranked = rankMustWatchMovies(movies, poolSize);
    const unseen = await getUnseenMoviesForUser(discordUserId, ranked);
    return unseen.slice(0, limit);
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
                value: 'Get a direct download link for what you are currently watching.\nAliases: none',
                inline: false,
            },
            {
                name: `${EMOJI.play} \`${prefix}status\``,
                value: `Show your currently playing title with live progress.\nAliases: \`${prefix}nowplaying\``,
                inline: false,
            },
            {
                name: `${EMOJI.history} \`${prefix}recent [count]\``,
                value: `Show your recent watch history. Default **3**, max **10**.\nAliases: \`${prefix}history\``,
                inline: false,
            },
            {
                name: `${EMOJI.updated} \`${prefix}refresh [sourceId|all]\``,
                value: `Refresh your library cache. Default is all enabled sources.\nAliases: \`${prefix}sync\`, \`${prefix}resync\``,
                inline: false,
            },
            {
                name: `${EMOJI.film} \`${prefix}mustwatch [count]\``,
                value: `Show top-rated movies you actually have. Default **5**, max **10**.\nAliases: \`${prefix}must-watch\`, \`${prefix}mw\``,
                inline: false,
            },
            {
                name: `${EMOJI.gear} \`${prefix}mwreset\``,
                value: `Clear your Must Watch seen-history so titles can be recommended again.\nAliases: \`${prefix}resetmw\`, \`${prefix}mwclear\``,
                inline: false,
            },
            {
                name: `${EMOJI.gear} \`${prefix}clear [count]\``,
                value: 'Clear recent messages in this channel (default 10, max 99). Requires Manage Messages permission.',
                inline: false,
            },
            {
                name: `${EMOJI.gear} \`${prefix}prefix [newPrefix]\``,
                value: `Show or change the bot command prefix at runtime (1-3 chars, no spaces).\nAliases: \`${prefix}setprefix\``,
                inline: false,
            },
            {
                name: `${EMOJI.gear} \`${prefix}makeadmin <user>\``,
                value: `Promote a LurkedTV user to admin by username, user ID, or Discord mention.\nAliases: \`${prefix}addadmin\`, \`${prefix}promoteadmin\``,
                inline: false,
            },
            {
                name: `${EMOJI.ping} \`${prefix}ping\``,
                value: `Check bot response latency.\nAliases: \`${prefix}latency\``,
                inline: false,
            },
            {
                name: `${EMOJI.help} \`${prefix}help\``,
                value: `Show this command list.\nAliases: \`${prefix}commands\`, \`${prefix}cmds\``,
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

function buildDiscordLinkRequiredEmbed() {
    return buildEmbed({
        title: `${EMOJI.warning} Discord Link Required`,
        description: 'You must link this Discord account on the LurkedTV website before using bot commands.',
        fields: [
            { name: 'Link Path', value: 'Settings -> Account Status -> Link Discord', inline: false },
        ],
        color: COLORS.warning,
        footer: 'After linking, run your command again.',
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

async function handleRefreshCommand(message, rawSourceId) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const parsedSourceId = toPositiveInt(rawSourceId);
    const wantsAll = !rawSourceId || String(rawSourceId).toLowerCase() === 'all';

    if (!wantsAll && !parsedSourceId) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.warning} Invalid Source`,
                    description: `Use \`${prefix}refresh\`, \`${prefix}refresh all\`, or \`${prefix}refresh 3\`.`,
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    if (wantsAll) {
        const sourceList = await apiGet('/api/sources', nodecastToken);
        const enabledSources = Array.isArray(sourceList) ? sourceList.filter(s => s?.enabled) : [];
        const enabledCount = enabledSources.length;
        if (!enabledCount) {
            await message.reply({
                embeds: [
                    buildEmbed({
                        title: `${EMOJI.warning} No Enabled Sources`,
                        description: 'There are no enabled sources to refresh.',
                        color: COLORS.warning,
                    }),
                ],
            });
            return;
        }

        const startedAfterMs = Date.now();
        const sourceIds = enabledSources.map(s => String(s.id));
        const sourceNameById = Object.fromEntries(enabledSources.map(s => [String(s.id), sanitizeEmbedText(s?.name, `Source ${s?.id}`)]));
        const requesterLabel = `${message.author.username} (<@${message.author.id}>)`;
        const playlistPreview = enabledSources
            .map((s) => sanitizeEmbedText(s?.name, `Source ${s?.id}`))
            .slice(0, 8);
        const playlistLines = playlistPreview.map((name) => `- ${name}`);
        if (enabledSources.length > playlistPreview.length) {
            playlistLines.push(`...and ${enabledSources.length - playlistPreview.length} more`);
        }
        await apiPost('/api/sources/sync-all', nodecastToken, {});
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.updated} Refreshing All Playlists`,
                    description: `Refreshing ${enabledCount} enabled playlist${enabledCount === 1 ? '' : 's'}.`,
                    fields: [
                        { name: 'Requested By', value: requesterLabel, inline: true },
                        { name: 'Playlists', value: `${formatCount(enabledCount)}`, inline: true },
                        { name: 'Queue', value: playlistLines.join('\n'), inline: false },
                    ],
                    color: COLORS.success,
                    authorName: 'LurkedTV Refresh',
                }),
            ],
        });
        monitorRefreshAndNotify({
            message,
            token: nodecastToken,
            sourceIds,
            sourceNameById,
            startedAfterMs,
            scopeLabel: `all enabled sources (${enabledCount})`,
            requestedByLabel: requesterLabel,
        }).catch(() => {});
        return;
    }

    const source = await apiGet(`/api/sources/${parsedSourceId}`, nodecastToken);
    const sourceName = sanitizeEmbedText(source?.name, String(parsedSourceId));
    const requesterLabel = `${message.author.username} (<@${message.author.id}>)`;
    const startedAfterMs = Date.now();
    await apiPost(`/api/sources/${parsedSourceId}/sync`, nodecastToken, {});

    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.updated} Refreshing ${sourceName}`,
                description: `Refreshing playlist **${sourceName}** (ID: \`${parsedSourceId}\`).`,
                fields: [
                    { name: 'Requested By', value: requesterLabel, inline: true },
                    { name: 'Playlist', value: `${sourceName} (ID: \`${parsedSourceId}\`)`, inline: true },
                ],
                color: COLORS.success,
                authorName: 'LurkedTV Refresh',
            }),
        ],
    });
    monitorRefreshAndNotify({
        message,
        token: nodecastToken,
        sourceIds: [String(parsedSourceId)],
        sourceNameById: { [String(parsedSourceId)]: sourceName },
        startedAfterMs,
        scopeLabel: sourceName,
        requestedByLabel: requesterLabel,
    }).catch(() => {});
}

async function handleMustWatchCommand(message, rawCount) {
    const nodecastToken = await getNodecastTokenForDiscordUser(message.author.id);
    const requestedCount = Number(rawCount);
    const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10, requestedCount)) : 5;

    const picks = await getMustWatchMovies(nodecastToken, message.author.id, count);
    if (!picks.length) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.film} Must Watch`,
                    description: 'No unseen must-watch picks left right now. You have likely cycled through available recommendations.',
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    const resolvedLinks = await Promise.all(
        picks.map(async (movie) => {
            try {
                const url = await resolveCatalogMovieStreamLink(nodecastToken, movie);
                return { movie, url };
            } catch (_) {
                return { movie, url: null };
            }
        })
    );

    const embeds = resolvedLinks.map(({ movie, url }, idx) => {
        const ratingLabel = formatRatingLabel(movie.rating);
        const yearLabel = movie.year ? ` (${movie.year})` : '';
        const when = movie.addedAtMs > 0 ? `<t:${Math.floor(movie.addedAtMs / 1000)}:R>` : 'unknown';
        const poster = sanitizeEmbedText(movie.poster, '');
        const thumbnail = sanitizeEmbedText(movie.thumbnail, '');
        const hasPoster = poster.startsWith('http://') || poster.startsWith('https://');
        const hasThumbnail = thumbnail.startsWith('http://') || thumbnail.startsWith('https://');
        const watchLine = url ? `${EMOJI.link} [Watch](${url})` : `${EMOJI.link} Watch link unavailable`;

        return buildEmbed({
            title: `${EMOJI.film} #${idx + 1} of ${resolvedLinks.length} - ${movie.title}${yearLabel}`,
            description: `${EMOJI.sparkle} Rating: **${ratingLabel}**\n${EMOJI.clock} Added: ${when}\n${watchLine}`,
            color: COLORS.primary,
            image: hasPoster ? poster : undefined,
            thumbnail: !hasPoster && hasThumbnail ? thumbnail : undefined,
            footer: `${message.author.username}  -  Must Watch`,
            authorName: 'LurkedTV Recommendations',
        });
    });

    await markMoviesAsSeenForUser(message.author.id, resolvedLinks.map(r => r.movie));
    await message.reply({ embeds });
}

async function handleMustWatchResetCommand(message) {
    const removed = await resetSeenMoviesForUser(message.author.id);
    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.success} Must Watch Reset`,
                description: `Cleared **${removed}** seen-item records for your account.`,
                color: COLORS.success,
                footer: `Requested by ${message.author.username}`,
                authorName: 'LurkedTV Recommendations',
            }),
        ],
    });
}

async function handleClearCommand(message, rawTarget) {
    if (!message.guild || !message.channel || !message.channel.isTextBased()) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.warning} Guild Command Only`,
                    description: 'This command can only be used in server text channels.',
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    const memberPerms = message.member?.permissions;
    const userCanManage = Boolean(
        memberPerms?.has(PermissionsBitField.Flags.ManageMessages) ||
        memberPerms?.has(PermissionsBitField.Flags.Administrator)
    );
    if (!userCanManage) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.error} Permission Required`,
                    description: 'You need **Manage Messages** permission to use this command.',
                    color: COLORS.error,
                }),
            ],
        });
        return;
    }

    const botPerms = message.guild.members.me?.permissionsIn(message.channel);
    const botCanManage = Boolean(
        botPerms?.has(PermissionsBitField.Flags.ManageMessages) &&
        botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)
    );
    if (!botCanManage) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.error} Missing Bot Permission`,
                    description: 'I need **Manage Messages** and **Read Message History** in this channel.',
                    color: COLORS.error,
                }),
            ],
        });
        return;
    }

    const requested = Number.parseInt(String(rawTarget ?? '').trim(), 10);
    const count = Number.isFinite(requested) ? Math.max(1, Math.min(99, requested)) : 10;
    const toDelete = Math.min(100, count + 1); // include the clear command message

    const deleted = await message.channel.bulkDelete(toDelete, true);
    const removed = Math.max(0, (deleted?.size || 0) - 1);
    const confirmation = await message.channel.send({
        embeds: [
            buildEmbed({
                title: `${EMOJI.success} Channel Cleared`,
                description: `Deleted **${removed}** message(s).`,
                color: COLORS.success,
                footer: 'Only messages newer than 14 days can be bulk deleted.',
            }),
        ],
    });

    setTimeout(() => {
        confirmation.delete().catch(() => {});
    }, 5000);
}

async function handlePrefixCommand(message, rawNewPrefix) {
    const requested = sanitizeEmbedText(rawNewPrefix, '');

    if (!requested) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.gear} Current Prefix`,
                    description: `Current prefix is \`${prefix}\`.\nUsage: \`${prefix}prefix ?\``,
                    color: COLORS.info,
                }),
            ],
        });
        return;
    }

    if (/\s/.test(requested) || requested.length > 3) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.warning} Invalid Prefix`,
                    description: 'Prefix must be 1-3 non-space characters.',
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    const oldPrefix = prefix;
    prefix = requested;

    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.success} Prefix Updated`,
                description: `Prefix changed from \`${oldPrefix}\` to \`${prefix}\`.`,
                color: COLORS.success,
                footer: 'Runtime change (resets on bot restart unless server runtime config overrides).',
            }),
        ],
    });
}

function parseDiscordMentionUserId(value) {
    const raw = sanitizeEmbedText(value, '');
    const match = raw.match(/^<@!?(\d+)>$/);
    return match ? match[1] : '';
}

async function handleMakeAdminCommand(message, rawTarget) {
    const targetRaw = sanitizeEmbedText(rawTarget, '');
    if (!targetRaw) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.warning} Missing Target User`,
                    description: `Usage: \`${prefix}makeadmin <username|userId|@discordUser>\``,
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    const isDiscordAdmin = Boolean(
        message.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
        message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)
    );
    if (!isDiscordAdmin) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.error} Permission Required`,
                    description: 'You need **Administrator** or **Manage Server** permission to run this command.',
                    color: COLORS.error,
                }),
            ],
        });
        return;
    }

    const token = await getNodecastTokenForDiscordUser(message.author.id);
    const users = await apiGet('/api/auth/users', token);
    if (!Array.isArray(users) || users.length === 0) {
        throw new Error('No users were returned by the API.');
    }

    const mentionId = parseDiscordMentionUserId(targetRaw);
    const targetIdRaw = mentionId || targetRaw;
    const targetLower = targetRaw.toLowerCase();

    const targetUser = users.find((u) =>
        String(u?.id || '') === targetIdRaw ||
        String(u?.discordId || '') === targetIdRaw ||
        String(u?.username || '').toLowerCase() === targetLower
    );

    if (!targetUser) {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.warning} User Not Found`,
                    description: `Could not find user \`${targetRaw}\`. Try username, Nodecast user ID, or Discord mention.`,
                    color: COLORS.warning,
                }),
            ],
        });
        return;
    }

    if (String(targetUser.role || '').toLowerCase() === 'admin') {
        await message.reply({
            embeds: [
                buildEmbed({
                    title: `${EMOJI.info} Already Admin`,
                    description: `**${targetUser.username || `User ${targetUser.id}`}** already has admin role.`,
                    color: COLORS.info,
                }),
            ],
        });
        return;
    }

    await apiPut(`/api/auth/users/${encodeURIComponent(String(targetUser.id))}`, token, { role: 'admin' });
    await message.reply({
        embeds: [
            buildEmbed({
                title: `${EMOJI.success} Admin Role Granted`,
                description: `Promoted **${targetUser.username || `User ${targetUser.id}`}** to admin.`,
                color: COLORS.success,
                footer: `Requested by ${message.author.username}`,
            }),
        ],
    });
}

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

client.once('clientReady', async () => {
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
    const knownCommands = new Set([
        'download',
        'status', 'nowplaying',
        'recent', 'history',
        'refresh', 'sync', 'resync',
        'mustwatch', 'must-watch', 'mw',
        'mwreset', 'resetmw', 'mwclear',
        'clear',
        'prefix', 'setprefix',
        'makeadmin', 'addadmin', 'promoteadmin',
        'ping', 'latency',
        'help', 'commands', 'cmds',
        '',
    ]);

    try {
        if (knownCommands.has(command)) {
            const linkedToken = await getNodecastTokenFromDiscordLink(message.author.id);
            if (!linkedToken) {
                await message.reply({ embeds: [buildDiscordLinkRequiredEmbed()] });
                return;
            }
        }

        if (command === 'download') { await handleDownloadCommand(message); return; }
        if (command === 'status' || command === 'nowplaying') { await handleStatusCommand(message); return; }
        if (command === 'recent' || command === 'history') { await handleRecentCommand(message, args[0]); return; }
        if (command === 'refresh' || command === 'sync' || command === 'resync') { await handleRefreshCommand(message, args[0]); return; }
        if (command === 'mustwatch' || command === 'must-watch' || command === 'mw') { await handleMustWatchCommand(message, args[0]); return; }
        if (command === 'mwreset' || command === 'resetmw' || command === 'mwclear') { await handleMustWatchResetCommand(message); return; }
        if (command === 'clear') { await handleClearCommand(message, args[0]); return; }
        if (command === 'prefix' || command === 'setprefix') { await handlePrefixCommand(message, args[0]); return; }
        if (command === 'makeadmin' || command === 'addadmin' || command === 'promoteadmin') {
            await handleMakeAdminCommand(message, args.join(' '));
            return;
        }

        if (command === 'ping' || command === 'latency') {
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

        if (command === 'help' || command === 'commands' || command === 'cmds' || command === '') {
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
