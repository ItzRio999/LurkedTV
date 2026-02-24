const express = require('express');
const router = express.Router();
const { settings, getDefaultSettings } = require('../db');
const auth = require('../auth');
const syncService = require('../services/syncService');
const firebaseCacheSync = require('../services/firebaseCacheSync');

let discordBotHeartbeat = {
    lastSeenAt: 0,
    botTag: '',
    guildCount: 0
};

function getDiscordBotAuthSecret() {
    return String(process.env.DISCORD_BOT_AUTH_SECRET || process.env.NODECAST_DISCORD_AUTH_SECRET || '').trim();
}

function requireDiscordBotAuth(req, res, next) {
    const expected = getDiscordBotAuthSecret();
    if (!expected) return res.status(503).json({ error: 'Discord bot auth secret is not configured' });

    const provided = String(req.headers['x-bot-auth'] || '').trim();
    if (!provided || provided !== expected) {
        return res.status(401).json({ error: 'Invalid bot auth secret' });
    }
    next();
}

function toSafeString(value, fallback = '') {
    const s = String(value ?? '').trim();
    return s || fallback;
}

function toSafeInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function getEffectiveDiscordBotConfig() {
    const s = await settings.get();
    return {
        prefix: toSafeString(s.discordBotPrefix, process.env.DISCORD_BOT_PREFIX || '!'),
        guildId: toSafeString(s.discordGuildId, process.env.DISCORD_GUILD_ID || process.env.DISCORD_SERVER_ID || '1356477545964372048'),
        adminRoleId: toSafeString(s.discordAdminRoleId, process.env.DISCORD_ADMIN_ROLE_ID || '1356477545989799990'),
        logChannelId: toSafeString(s.discordLogChannelId, ''),
        activeWindowMs: toSafeInt(s.discordActiveWindowMs, Number(process.env.NODECAST_ACTIVE_WINDOW_MS || 300000)),
        commandDedupeWindowMs: toSafeInt(s.discordCommandDedupeWindowMs, Number(process.env.DISCORD_COMMAND_DEDUPE_WINDOW_MS || 15000))
    };
}

async function discordApiRequest(pathname) {
    const token = toSafeString(process.env.DISCORD_BOT_TOKEN, '');
    if (!token) return { ok: false, error: 'DISCORD_BOT_TOKEN is missing' };

    const response = await fetch(`https://discord.com/api${pathname}`, {
        headers: { Authorization: `Bot ${token}` }
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        return { ok: false, error: body?.message || `HTTP ${response.status}`, status: response.status, body };
    }
    return { ok: true, data: body, status: response.status };
}

/**
 * Get all settings
 * GET /api/settings
 */
router.get('/', async (req, res) => {
    try {
        let currentSettings = await settings.get();

        // Ensure optimized auto-profile is applied at least once.
        if (!currentSettings.autoProfileVersion || currentSettings.autoProfileVersion < 1) {
            const hwDetect = require('../services/hwDetect');
            const capabilities = hwDetect.getCapabilities() || await hwDetect.detect();
            const result = await settings.applyAutoProfileIfNeeded(capabilities);
            currentSettings = result.settings;
        }

        res.json(currentSettings);
    } catch (err) {
        console.error('Error getting settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Update settings (partial update)
 * PUT /api/settings
 */
router.put('/', async (req, res) => {
    try {
        const updates = req.body;
        const updatedSettings = await settings.update(updates);

        // If sync interval changed, restart the server-side sync timer
        if (updates.epgRefreshInterval !== undefined) {
            syncService.restartSyncTimer().catch(console.error);
        }

        res.json(updatedSettings);
    } catch (err) {
        console.error('Error updating settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Reset settings to defaults
 * DELETE /api/settings
 */
router.delete('/', async (req, res) => {
    try {
        const defaultSettings = await settings.reset();
        res.json(defaultSettings);
    } catch (err) {
        console.error('Error resetting settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Get default settings (for reference)
 * GET /api/settings/defaults
 */
router.get('/defaults', (req, res) => {
    res.json(getDefaultSettings());
});

/**
 * Get sync status (last sync time)
 * GET /api/settings/sync-status
 */
router.get('/sync-status', (req, res) => {
    const lastSyncTime = syncService.getLastSyncTime();
    const firebaseCache = firebaseCacheSync.getStatus();

    res.json({
        lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
        firebaseCache
    });
});

/**
 * Trigger Firebase media cache sync (manual)
 * POST /api/settings/firebase-cache/sync
 */
router.post('/firebase-cache/sync', async (req, res) => {
    try {
        const result = await firebaseCacheSync.syncNow('manual');
        res.json(result);
    } catch (err) {
        console.error('Error syncing Firebase media cache:', err);
        res.status(503).json({ error: err.message || 'Firebase cache sync failed' });
    }
});

/**
 * Get hardware capabilities (GPU acceleration support)
 * GET /api/settings/hw-info
 */
router.get('/hw-info', async (req, res) => {
    try {
        const hwDetect = require('../services/hwDetect');
        let capabilities = hwDetect.getCapabilities();

        // If not yet detected, run detection now
        if (!capabilities) {
            capabilities = await hwDetect.detect();
        }

        res.json(capabilities);
    } catch (err) {
        console.error('Error getting hardware info:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Refresh hardware detection (re-probe GPUs)
 * POST /api/settings/hw-info/refresh
 */
router.post('/hw-info/refresh', async (req, res) => {
    try {
        const hwDetect = require('../services/hwDetect');
        const capabilities = await hwDetect.refresh();
        res.json(capabilities);
    } catch (err) {
        console.error('Error refreshing hardware info:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Apply or re-apply system auto-profile from detected hardware
 * POST /api/settings/auto-profile/apply
 */
router.post('/auto-profile/apply', async (req, res) => {
    try {
        const hwDetect = require('../services/hwDetect');
        const refreshHardware = req.body?.refreshHardware === true;
        const force = req.body?.force !== false; // default true for manual endpoint

        const capabilities = refreshHardware
            ? await hwDetect.refresh()
            : (hwDetect.getCapabilities() || await hwDetect.detect());

        const result = await settings.applyAutoProfileIfNeeded(capabilities, { force });
        res.json(result);
    } catch (err) {
        console.error('Error applying auto-profile:', err);
        res.status(500).json({ error: err.message || 'Failed to apply auto-profile' });
    }
});

/**
 * Get Discord bot monitor status (admin)
 * GET /api/settings/discord-bot/status
 */
router.get('/discord-bot/status', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const config = await getEffectiveDiscordBotConfig();
        const hasBotToken = Boolean(toSafeString(process.env.DISCORD_BOT_TOKEN, ''));
        const hasBotAuthSecret = Boolean(getDiscordBotAuthSecret());

        let botIdentity = { ok: false, tag: '', id: '', error: '' };
        let guildStatus = { ok: false, id: config.guildId, name: '', error: '' };
        let roleStatus = { ok: false, id: config.adminRoleId, name: '', error: '' };

        const me = await discordApiRequest('/users/@me');
        if (me.ok) {
            const u = me.data || {};
            botIdentity = {
                ok: true,
                id: String(u.id || ''),
                tag: `${u.username || 'unknown'}${u.discriminator && u.discriminator !== '0' ? `#${u.discriminator}` : ''}`,
                error: ''
            };
        } else {
            botIdentity = { ok: false, id: '', tag: '', error: me.error || 'Unable to fetch bot identity' };
        }

        if (config.guildId) {
            const guild = await discordApiRequest(`/guilds/${encodeURIComponent(config.guildId)}`);
            if (guild.ok) {
                guildStatus = {
                    ok: true,
                    id: String(guild.data?.id || config.guildId),
                    name: guild.data?.name || '',
                    error: ''
                };

                if (config.adminRoleId) {
                    const roles = await discordApiRequest(`/guilds/${encodeURIComponent(config.guildId)}/roles`);
                    if (roles.ok && Array.isArray(roles.data)) {
                        const role = roles.data.find(r => String(r.id) === config.adminRoleId);
                        roleStatus = role
                            ? { ok: true, id: String(role.id), name: role.name || '', error: '' }
                            : { ok: false, id: config.adminRoleId, name: '', error: 'Role not found in guild' };
                    } else {
                        roleStatus = { ok: false, id: config.adminRoleId, name: '', error: roles.error || 'Unable to fetch roles' };
                    }
                }
            } else {
                guildStatus = { ok: false, id: config.guildId, name: '', error: guild.error || 'Guild lookup failed' };
            }
        }

        const now = Date.now();
        const heartbeatAgeMs = discordBotHeartbeat.lastSeenAt ? (now - discordBotHeartbeat.lastSeenAt) : null;
        const heartbeatOnline = heartbeatAgeMs !== null && heartbeatAgeMs < 90_000;

        return res.json({
            config,
            monitor: {
                hasBotToken,
                hasBotAuthSecret,
                botIdentity,
                guildStatus,
                roleStatus,
                heartbeat: {
                    online: heartbeatOnline,
                    lastSeenAt: discordBotHeartbeat.lastSeenAt || null,
                    ageMs: heartbeatAgeMs,
                    botTag: discordBotHeartbeat.botTag || '',
                    guildCount: discordBotHeartbeat.guildCount || 0
                }
            }
        });
    } catch (err) {
        console.error('Error getting Discord bot status:', err);
        res.status(500).json({ error: err.message || 'Failed to get Discord bot status' });
    }
});

/**
 * Update Discord bot config (admin)
 * PUT /api/settings/discord-bot/config
 */
router.put('/discord-bot/config', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const updates = {};
        if (req.body?.prefix !== undefined) updates.discordBotPrefix = toSafeString(req.body.prefix, '!').slice(0, 3);
        if (req.body?.guildId !== undefined) updates.discordGuildId = toSafeString(req.body.guildId, '');
        if (req.body?.adminRoleId !== undefined) updates.discordAdminRoleId = toSafeString(req.body.adminRoleId, '');
        if (req.body?.logChannelId !== undefined) updates.discordLogChannelId = toSafeString(req.body.logChannelId, '');
        if (req.body?.activeWindowMs !== undefined) updates.discordActiveWindowMs = toSafeInt(req.body.activeWindowMs, 300000);
        if (req.body?.commandDedupeWindowMs !== undefined) updates.discordCommandDedupeWindowMs = toSafeInt(req.body.commandDedupeWindowMs, 15000);

        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'No valid Discord bot config fields provided' });
        }

        await settings.update(updates);
        const config = await getEffectiveDiscordBotConfig();
        return res.json({ success: true, config });
    } catch (err) {
        console.error('Error updating Discord bot config:', err);
        res.status(500).json({ error: err.message || 'Failed to update Discord bot config' });
    }
});

/**
 * Runtime config consumed by Discord bot process (bot-auth only)
 * GET /api/settings/discord-bot/runtime
 */
router.get('/discord-bot/runtime', requireDiscordBotAuth, async (req, res) => {
    try {
        const config = await getEffectiveDiscordBotConfig();
        return res.json(config);
    } catch (err) {
        console.error('Error getting Discord bot runtime config:', err);
        return res.status(500).json({ error: err.message || 'Failed to get runtime config' });
    }
});

/**
 * Heartbeat updates from Discord bot process (bot-auth only)
 * POST /api/settings/discord-bot/heartbeat
 */
router.post('/discord-bot/heartbeat', requireDiscordBotAuth, (req, res) => {
    discordBotHeartbeat = {
        lastSeenAt: Date.now(),
        botTag: toSafeString(req.body?.botTag, ''),
        guildCount: toSafeInt(req.body?.guildCount, 0)
    };
    res.json({ success: true, ts: discordBotHeartbeat.lastSeenAt });
});

module.exports = router;

