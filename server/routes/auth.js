const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');
const crypto = require('crypto');
const net = require('net');

// Configure Passport strategies
auth.configureLocalStrategy(
    async (username) => await db.users.getByUsername(username),
    async (password, hash) => await auth.verifyPassword(password, hash)
);

auth.configureJwtStrategy(
    async (id) => await db.users.getById(id)
);

// Configure Passport session serialization (required for OIDC)
auth.configureSessionSerialization(
    async (id) => await db.users.getById(id)
);

// Configure OIDC Strategy
auth.configureOidcStrategy(
    async (oidcId) => await db.users.getByOidcId(oidcId),
    async (email) => await db.users.getByEmail(email),
    async (userData) => await db.users.create(userData)
);

function requireOidcEnabled(req, res, next) {
    if (!auth.isOidcEnabled()) {
        return res.status(503).json({ error: 'SSO is not configured on this server' });
    }
    next();
}

function isDiscordOauthEnabled() {
    return Boolean(
        process.env.DISCORD_OAUTH_CLIENT_ID &&
        process.env.DISCORD_OAUTH_CLIENT_SECRET &&
        process.env.DISCORD_OAUTH_REDIRECT_URI
    );
}

function getDiscordOauthScopes() {
    return process.env.DISCORD_OAUTH_SCOPES || 'identify email';
}

function requireDiscordOauthEnabled(req, res, next) {
    if (!isDiscordOauthEnabled()) {
        return res.status(503).json({ error: 'Discord OAuth is not configured on this server' });
    }
    next();
}

function getDiscordAdminRoleId() {
    return String(process.env.DISCORD_ADMIN_ROLE_ID || '1356477545989799990').trim();
}

function getDiscordGuildId() {
    return String(
        process.env.DISCORD_GUILD_ID ||
        process.env.DISCORD_SERVER_ID ||
        '1356477545964372048'
    ).trim();
}

function getDiscordBotToken() {
    return String(process.env.DISCORD_BOT_TOKEN || '').trim();
}

function canCheckDiscordGuildMembership() {
    return Boolean(getDiscordGuildId() && getDiscordBotToken());
}

function getDiscordAuthBaseUrl() {
    return 'https://discord.com/api/oauth2/authorize';
}

function buildDiscordOauthUrl(state) {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_OAUTH_CLIENT_ID,
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: getDiscordOauthScopes(),
        state,
        prompt: 'consent'
    });
    return `${getDiscordAuthBaseUrl()}?${params.toString()}`;
}

async function exchangeDiscordCodeForToken(code) {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_OAUTH_CLIENT_ID,
        client_secret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
        throw new Error(data?.error_description || data?.error || 'Discord token exchange failed');
    }

    return data.access_token;
}

async function fetchDiscordUser(accessToken) {
    const response = await fetch('https://discord.com/api/users/@me', {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
        throw new Error(data?.message || 'Failed to fetch Discord profile');
    }

    return data;
}

function buildDiscordAvatarUrl(discordUser) {
    const userId = String(discordUser?.id || '').trim();
    const avatar = String(discordUser?.avatar || '').trim();
    if (!userId || !avatar) return '';
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=128`;
}

function extractClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map(v => v.trim())
        .find(Boolean);
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    const candidate = forwardedFor || realIp || String(req.ip || req.socket?.remoteAddress || '').trim();
    if (!candidate) return '';

    let value = candidate;
    if (value.startsWith('::ffff:')) value = value.slice(7);
    const bracketIpv6 = value.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketIpv6) value = bracketIpv6[1];
    const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) value = ipv4WithPort[1];

    if (value === '::1') return '127.0.0.1';
    return value;
}

function getIpVisibility(ip) {
    const value = String(ip || '').trim();
    if (!value || value.toLowerCase() === 'localhost') return 'unknown';
    const family = net.isIP(value);
    if (!family) return 'unknown';
    if (family === 4) {
        if (value.startsWith('127.')) return 'loopback';
        if (value.startsWith('10.')) return 'private';
        if (value.startsWith('192.168.')) return 'private';
        if (value.startsWith('169.254.')) return 'private';
        const secondOctet = Number(value.split('.')[1] || 0);
        if (value.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return 'private';
    } else {
        const normalized = value.toLowerCase();
        if (normalized === '::1') return 'loopback';
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
        if (normalized.startsWith('fe80')) return 'private';
    }
    return 'public';
}

function isPublicIp(ip) {
    return getIpVisibility(ip) === 'public';
}

function formatIpForDisplay(ip) {
    const value = String(ip || '').trim();
    if (!value) return 'Unavailable';
    const visibility = getIpVisibility(value);
    if (visibility === 'loopback') return `${value} (localhost)`;
    if (visibility === 'private') return `${value} (private network)`;
    if (visibility === 'public') return `${value} (public)`;
    return value;
}

function formatGeoForDisplay(geo, ip) {
    if (geo) {
        const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
        const coords = (geo.latitude !== null && geo.longitude !== null)
            ? ` (${geo.latitude}, ${geo.longitude})`
            : '';
        return `${place || 'Location resolved'}${coords}`;
    }
    const visibility = getIpVisibility(ip);
    if (visibility === 'loopback' || visibility === 'private') return 'Not available for local/private IP';
    if (visibility === 'public') return 'Lookup failed';
    return 'Unavailable';
}

function parseClientFromUserAgent(userAgent) {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return 'unknown';
    if (ua.includes('discord')) return 'Discord';
    if (ua.includes('edg/')) return 'Edge';
    if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
    if (ua.includes('chrome/')) return 'Chrome';
    if (ua.includes('firefox/')) return 'Firefox';
    if (ua.includes('safari/') && !ua.includes('chrome/')) return 'Safari';
    if (ua.includes('postman')) return 'Postman';
    if (ua.includes('curl/')) return 'curl';
    return 'other';
}

async function lookupGeoByIp(ip) {
    if (!isPublicIp(ip)) return null;
    try {
        const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
            signal: AbortSignal.timeout(2500)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success === false) return null;

        const city = String(data?.city || '').trim();
        const region = String(data?.region || '').trim();
        const country = String(data?.country || '').trim();

        return {
            city: city || null,
            region: region || null,
            country: country || null,
            countryCode: String(data?.country_code || '').trim() || null,
            latitude: Number.isFinite(Number(data?.latitude)) ? Number(data.latitude) : null,
            longitude: Number.isFinite(Number(data?.longitude)) ? Number(data.longitude) : null,
            timezone: String(data?.timezone?.id || '').trim() || null,
            org: String(data?.connection?.org || '').trim() || null,
            isp: String(data?.connection?.isp || '').trim() || null
        };
    } catch (_) {
        return null;
    }
}

async function getConfiguredDiscordLogChannelId() {
    try {
        const s = await db.settings.get();
        return String(s?.discordLogChannelId || '').trim();
    } catch (_) {
        return '';
    }
}

async function sendDiscordAuditLogToChannel(payload) {
    const botToken = getDiscordBotToken();
    const channelId = await getConfiguredDiscordLogChannelId();
    if (!botToken || !channelId || !payload) return false;

    try {
        const ipLabel = formatIpForDisplay(payload.ip);
        const geoLabel = formatGeoForDisplay(payload.geo, payload.ip);
        const siteUser = `${payload.siteUsername || 'unknown'} (#${payload.siteUserId || 'n/a'})`;
        const discordUser = `${payload.discordUsername || 'unknown'} (${payload.discordId || 'n/a'})`;

        const embed = {
            title: 'Discord Link Audit',
            color: 0x5865F2,
            timestamp: payload.timestamp || new Date().toISOString(),
            fields: [
                { name: 'Site User', value: siteUser, inline: true },
                { name: 'Discord User', value: discordUser, inline: true },
                { name: 'Client', value: payload.client || 'unknown', inline: true },
                { name: 'IP Address', value: ipLabel, inline: false },
                { name: 'Geo', value: geoLabel, inline: false }
            ],
            footer: { text: 'NodeCast Security Audit' }
        };

        const response = await fetch(`https://discord.com/api/channels/${encodeURIComponent(channelId)}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

        return response.ok;
    } catch (_) {
        return false;
    }
}

async function logDiscordLinkAudit(req, linkUser, discordUser) {
    const ip = extractClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').trim();
    const geo = await lookupGeoByIp(ip);

    const payload = {
        event: 'discord_link_success',
        timestamp: new Date().toISOString(),
        siteUserId: linkUser?.id || null,
        siteUsername: linkUser?.username || null,
        discordId: String(discordUser?.id || '') || null,
        discordUsername: discordUser?.username || null,
        discordDisplayName: discordUser?.global_name || discordUser?.username || null,
        ip: ip || null,
        client: parseClientFromUserAgent(userAgent),
        userAgent: userAgent || null,
        geo
    };

    console.log('[DiscordLinkAudit]', JSON.stringify(payload));
    await sendDiscordAuditLogToChannel(payload);
}

async function fetchDiscordGuildMember(discordUserId) {
    const guildId = getDiscordGuildId();
    const botToken = getDiscordBotToken();

    if (!guildId || !botToken || !discordUserId) {
        return null;
    }

    const response = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`, {
        headers: {
            Authorization: `Bot ${botToken}`
        }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.user?.id) {
        return null;
    }
    return data;
}

async function hasDiscordAdminRole(discordUserId) {
    if (!canCheckDiscordGuildMembership()) return false;
    const adminRoleId = getDiscordAdminRoleId();
    if (!discordUserId || !adminRoleId) return false;

    const member = await fetchDiscordGuildMember(discordUserId);
    if (!member || !Array.isArray(member.roles)) return false;

    return member.roles.some(roleId => String(roleId) === adminRoleId);
}

async function getDiscordMemberStatus(discordUserId) {
    if (!discordUserId) return 'not_linked';
    if (!canCheckDiscordGuildMembership()) return 'unknown';
    const member = await fetchDiscordGuildMember(discordUserId);
    return member ? 'in_server' : 'not_in_server';
}

async function isDashboardAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!user.discordId) return false;
    return hasDiscordAdminRole(user.discordId);
}

async function requireDashboardAdmin(req, res, next) {
    try {
        const user = await db.users.getById(req.user?.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const allowed = await isDashboardAdminUser(user);
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }
        next();
    } catch (err) {
        console.error('Dashboard admin authorization failed:', err);
        return res.status(500).json({ error: 'Authorization check failed' });
    }
}

async function sendDiscordLinkSuccessDm(discordUserId, lurkedTvUsername) {
    const botToken = getDiscordBotToken();
    if (!botToken || !discordUserId) return false;

    try {
        const dmChannelResponse = await fetch('https://discord.com/api/users/@me/channels', {
            method: 'POST',
            headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipient_id: String(discordUserId) })
        });

        const dmChannel = await dmChannelResponse.json().catch(() => ({}));
        if (!dmChannelResponse.ok || !dmChannel?.id) return false;

        const embed = {
            title: 'Discord Account Linked',
            color: 0x3DD68C,
            description: 'Your Discord account is now linked to LurkedTV.',
            fields: [
                {
                    name: 'Account',
                    value: lurkedTvUsername || 'Unknown user',
                    inline: true
                },
                {
                    name: 'Bot Commands',
                    value: '!download  !status  !recent  !help',
                    inline: false
                }
            ],
            footer: { text: 'LurkedTV' },
            timestamp: new Date().toISOString()
        };

        const messageResponse = await fetch(`https://discord.com/api/channels/${encodeURIComponent(dmChannel.id)}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });
        return messageResponse.ok;
    } catch (err) {
        console.warn('Failed to send Discord link success DM:', err.message);
        return false;
    }
}

/**
 * Start OIDC Login
 * GET /api/auth/oidc/login
 */
router.get('/oidc/login', requireOidcEnabled, auth.passport.authenticate('openidconnect'));

/**
 * OIDC Callback
 * GET /api/auth/oidc/callback
 */
router.get('/oidc/callback',
    requireOidcEnabled,
    auth.passport.authenticate('openidconnect', { session: false, failureRedirect: '/login.html?error=SSO+Failed' }),
    (req, res) => {
        // Successful authentication
        const token = auth.generateToken(req.user);

        // Redirect to hompage with token
        res.redirect(`/?token=${token}`);
    }
);

/**
 * Start Discord OAuth Login
 * GET /api/auth/discord/login
 */
router.get('/discord/login', requireDiscordOauthEnabled, (req, res) => {
    return res.status(410).json({
        error: 'Discord sign-in is disabled. Sign in with Firebase, then link Discord from Settings.'
    });
});

/**
 * Start Discord linking for authenticated Firebase user
 * POST /api/auth/discord/link/start
 */
router.post('/discord/link/start', auth.requireAuth, requireDiscordOauthEnabled, async (req, res) => {
    try {
        const user = await db.users.getById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const state = crypto.randomBytes(24).toString('hex');
        req.session.discordLinkState = {
            state,
            userId: user.id,
            createdAt: Date.now()
        };

        return res.json({ url: buildDiscordOauthUrl(state) });
    } catch (err) {
        console.error('Discord link init failed:', err);
        return res.status(500).json({ error: err.message || 'Failed to start Discord link flow' });
    }
});

/**
 * Remove linked Discord account from current user
 * DELETE /api/auth/discord/link
 */
router.delete('/discord/link', auth.requireAuth, async (req, res) => {
    try {
        const user = await db.users.getById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        await db.users.update(user.id, {
            discordId: null,
            discordUsername: null,
            discordDisplayName: null,
            discordAvatarUrl: null,
            discordMemberStatus: null
        });
        return res.json({ success: true });
    } catch (err) {
        console.error('Discord unlink failed:', err);
        return res.status(500).json({ error: err.message || 'Failed to unlink Discord account' });
    }
});

/**
 * Discord OAuth Callback
 * GET /api/auth/discord/callback
 */
router.get('/discord/callback', requireDiscordOauthEnabled, async (req, res) => {
    try {
        const { code, state } = req.query;
        const linkState = req.session.discordLinkState;

        if (!linkState || !code || !state || state !== linkState.state) {
            return res.redirect('/login.html?error=Discord+link+session+is+invalid+or+expired');
        }
        delete req.session.discordLinkState;

        const discordAccessToken = await exchangeDiscordCodeForToken(String(code));
        const discordUser = await fetchDiscordUser(discordAccessToken);
        const linkUser = await db.users.getById(linkState.userId);
        if (!linkUser) {
            return res.redirect('/?discord=link_failed_user_not_found#settings');
        }

        const existing = await db.users.getByDiscordId(discordUser.id);
        if (existing && Number(existing.id) !== Number(linkUser.id)) {
            return res.redirect('/?discord=already_linked#settings');
        }

        await db.users.update(linkUser.id, {
            discordId: discordUser.id,
            discordUsername: discordUser.username || null,
            discordDisplayName: discordUser.global_name || discordUser.username || null,
            discordAvatarUrl: buildDiscordAvatarUrl(discordUser) || null,
            discordMemberStatus: await getDiscordMemberStatus(discordUser.id)
        });

        await logDiscordLinkAudit(req, linkUser, discordUser);
        await sendDiscordLinkSuccessDm(discordUser.id, linkUser.username);
        res.redirect('/?discord=linked#settings');
    } catch (err) {
        console.error('Discord OAuth callback failed:', err);
        res.redirect('/?discord=link_failed#settings');
    }
});

/**
 * Exchange linked Discord user ID for LurkedTV JWT (bot-only)
 * POST /api/auth/discord/bot-token
 */
router.post('/discord/bot-token', async (req, res) => {
    try {
        const expectedSecret = process.env.DISCORD_BOT_AUTH_SECRET || '';
        if (!expectedSecret) {
            return res.status(503).json({ error: 'DISCORD_BOT_AUTH_SECRET is not configured' });
        }

        const providedSecret = String(req.headers['x-bot-auth'] || '');
        if (!providedSecret || providedSecret !== expectedSecret) {
            return res.status(401).json({ error: 'Invalid bot auth secret' });
        }

        const discordId = String(req.body?.discordId || '').trim();
        if (!discordId) {
            return res.status(400).json({ error: 'discordId is required' });
        }

        const user = await db.users.getByDiscordId(discordId);
        if (!user) {
            return res.status(404).json({ error: 'Discord account is not linked to a LurkedTV user' });
        }

        const token = auth.generateToken(user);
        return res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                email: user.email || null
            }
        });
    } catch (err) {
        console.error('Discord bot token exchange failed:', err);
        res.status(500).json({ error: err.message || 'Failed to exchange Discord identity' });
    }
});

/**
 * Check if initial setup is required
 * GET /api/auth/setup-required
 */
router.get('/setup-required', async (req, res) => {
    try {
        const userCount = await db.users.count();
        res.json({ setupRequired: userCount === 0 });
    } catch (err) {
        console.error('Error in /setup-required:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Initial setup - Create admin user
 * POST /api/auth/setup
 */
router.post('/setup', async (req, res) => {
    return res.status(410).json({
        error: 'Local admin setup is disabled. Use Firebase authentication.'
    });
});

/**
 * Login with Passport Local Strategy
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
    return res.status(410).json({
        error: 'Username/password login is disabled. Use Firebase authentication.'
    });
});

/**
 * Check whether current user qualifies for admin dashboard access using Discord role
 * GET /api/auth/discord/admin-status
 */
router.get('/discord/admin-status', auth.requireAuth, async (req, res) => {
    try {
        const user = await db.users.getById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const hasRole = await hasDiscordAdminRole(user.discordId);
        const isAdmin = user.role === 'admin' || hasRole;

        return res.json({
            isAdmin,
            source: user.role === 'admin' ? 'nodecast-role' : (hasRole ? 'discord-role' : 'none'),
            discordLinked: !!user.discordId,
            discordRoleVerified: hasRole,
            membershipCheckAvailable: canCheckDiscordGuildMembership(),
            requiredRoleId: getDiscordAdminRoleId()
        });
    } catch (err) {
        console.error('Discord admin status check failed:', err);
        return res.status(500).json({ error: err.message || 'Failed to check Discord admin status' });
    }
});

/**
 * Login with Firebase ID token
 * POST /api/auth/firebase
 */
router.post('/firebase', async (req, res) => {
    try {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'idToken is required' });
        }

        const firebaseIdentity = await auth.verifyFirebaseIdToken(idToken);

        if (!firebaseIdentity.email) {
            return res.status(400).json({ error: 'Firebase account must have an email address' });
        }

        if (!firebaseIdentity.emailVerified) {
            return res.status(403).json({ error: 'Email not verified. Please verify your email before continuing.' });
        }

        let user = await db.users.getByFirebaseUid(firebaseIdentity.uid);

        if (!user) {
            user = await db.users.getByEmail(firebaseIdentity.email);
        }

        if (!user) {
            const userCount = await db.users.count();
            const role = userCount === 0 ? 'admin' : 'viewer';
            const baseUsername = firebaseIdentity.email.split('@')[0] || 'user';
            let username = baseUsername;
            let suffix = 1;

            while (await db.users.getByUsername(username)) {
                username = `${baseUsername}${suffix++}`;
            }

            user = await db.users.create({
                username,
                role,
                email: firebaseIdentity.email,
                firebaseUid: firebaseIdentity.uid
            });
        } else if (!user.firebaseUid) {
            user = await db.users.update(user.id, { firebaseUid: firebaseIdentity.uid });
        }

        const token = auth.generateToken(user);

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                email: user.email,
                defaultLanguage: user.defaultLanguage || '',
                emailVerified: true
            }
        });
    } catch (err) {
        console.error('Firebase login error:', err);
        res.status(401).json({ error: err.message || 'Firebase authentication failed' });
    }
});

/**
 * Logout (client-side handles token removal)
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    // With JWT, logout is handled client-side by removing the token
    // This endpoint exists for consistency and future server-side token blacklisting
    res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * Get current user
 * GET /api/auth/me
 */
router.get('/me', auth.requireAuth, async (req, res) => {
    try {
        const user = await db.users.getById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let liveDiscordMemberStatus = user.discordMemberStatus || null;
        if (user.discordId) {
            liveDiscordMemberStatus = await getDiscordMemberStatus(user.discordId);
            if (liveDiscordMemberStatus !== user.discordMemberStatus) {
                await db.users.update(user.id, { discordMemberStatus: liveDiscordMemberStatus });
            }
        }

        const discordAdmin = await isDashboardAdminUser(user);

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email || null,
            defaultLanguage: user.defaultLanguage || '',
            emailVerified: !!user.firebaseUid,
            discordLinked: !!user.discordId,
            discordAdmin,
            discordUsername: user.discordUsername || null,
            discordDisplayName: user.discordDisplayName || null,
            discordAvatarUrl: user.discordAvatarUrl || null,
            discordMemberStatus: liveDiscordMemberStatus
        });
    } catch (err) {
        console.error('Error in /me:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Update current user preferences
 * PATCH /api/auth/me/preferences
 */
router.patch('/me/preferences', auth.requireAuth, async (req, res) => {
    try {
        const { defaultLanguage } = req.body;

        const updates = {};
        if (defaultLanguage !== undefined) {
            updates.defaultLanguage = String(defaultLanguage || '').trim().toLowerCase().slice(0, 12);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid preference updates provided' });
        }

        const user = await db.users.update(req.user.id, updates);

        const discordAdmin = await isDashboardAdminUser(user);

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email || null,
            defaultLanguage: user.defaultLanguage || '',
            emailVerified: !!user.firebaseUid,
            discordLinked: !!user.discordId,
            discordAdmin,
            discordUsername: user.discordUsername || null,
            discordDisplayName: user.discordDisplayName || null,
            discordAvatarUrl: user.discordAvatarUrl || null,
            discordMemberStatus: user.discordMemberStatus || null
        });
    } catch (err) {
        console.error('Error updating preferences:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Change current user username
 * POST /api/auth/me/change-username
 */
router.post('/me/change-username', auth.requireAuth, async (req, res) => {
    try {
        const requestedUsername = String(req.body?.username || '').trim();

        if (!requestedUsername) {
            return res.status(400).json({ error: 'Username is required' });
        }
        if (requestedUsername.length < 3 || requestedUsername.length > 32) {
            return res.status(400).json({ error: 'Username must be 3-32 characters long' });
        }
        if (!/^[A-Za-z0-9_.-]+$/.test(requestedUsername)) {
            return res.status(400).json({ error: 'Username can only contain letters, numbers, dot, underscore, and dash' });
        }

        const currentUser = await db.users.getById(req.user.id);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (requestedUsername === currentUser.username) {
            const discordAdmin = await isDashboardAdminUser(currentUser);
            return res.json({
                id: currentUser.id,
                username: currentUser.username,
                role: currentUser.role,
                email: currentUser.email || null,
                defaultLanguage: currentUser.defaultLanguage || '',
                emailVerified: !!currentUser.firebaseUid,
                discordLinked: !!currentUser.discordId,
                discordAdmin,
                discordUsername: currentUser.discordUsername || null,
                discordDisplayName: currentUser.discordDisplayName || null,
                discordAvatarUrl: currentUser.discordAvatarUrl || null,
                discordMemberStatus: currentUser.discordMemberStatus || null
            });
        }

        const existing = await db.users.getByUsername(requestedUsername);
        if (existing && existing.id !== currentUser.id) {
            return res.status(409).json({ error: 'Username already exists' });
        }

        const updatedUser = await db.users.update(req.user.id, { username: requestedUsername });
        const discordAdmin = await isDashboardAdminUser(updatedUser);

        res.json({
            id: updatedUser.id,
            username: updatedUser.username,
            role: updatedUser.role,
            email: updatedUser.email || null,
            defaultLanguage: updatedUser.defaultLanguage || '',
            emailVerified: !!updatedUser.firebaseUid,
            discordLinked: !!updatedUser.discordId,
            discordAdmin,
            discordUsername: updatedUser.discordUsername || null,
            discordDisplayName: updatedUser.discordDisplayName || null,
            discordAvatarUrl: updatedUser.discordAvatarUrl || null,
            discordMemberStatus: updatedUser.discordMemberStatus || null
        });
    } catch (err) {
        console.error('Error changing username:', err);
        res.status(500).json({ error: err.message || 'Failed to change username' });
    }
});

/**
 * Change current user password
 * POST /api/auth/me/change-password
 */
router.post('/me/change-password', auth.requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = await db.users.getById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Firebase users: verify current password, then update via Firebase.
        if (user.firebaseUid && user.email) {
            const session = await auth.verifyFirebasePassword(user.email, currentPassword);

            if (session.localId !== user.firebaseUid) {
                return res.status(403).json({ error: 'Account mismatch while updating password' });
            }

            await auth.updateFirebasePassword(session.idToken, newPassword);
            return res.json({ success: true, message: 'Password updated successfully' });
        }

        // Local users fallback.
        if (!user.passwordHash) {
            return res.status(400).json({ error: 'This account does not support local password changes' });
        }

        const isValid = await auth.verifyPassword(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const passwordHash = await auth.hashPassword(newPassword);
        await db.users.update(user.id, { passwordHash });

        return res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).json({ error: err.message || 'Failed to change password' });
    }
});

/**
 * Get all users (admin only)
 * GET /api/auth/users
 */
router.get('/users', auth.requireAuth, requireDashboardAdmin, async (req, res) => {
    try {
        const allUsers = await db.users.getAll();

        // Remove password hashes
        const users = allUsers.map(u => {
            const { passwordHash, ...userWithoutPassword } = u;
            return userWithoutPassword;
        });

        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Create a new user (admin only)
 * POST /api/auth/users
 */
router.post('/users', auth.requireAuth, requireDashboardAdmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ error: 'Username, password, and role are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        if (!['admin', 'viewer'].includes(role)) {
            return res.status(400).json({ error: 'Role must be either "admin" or "viewer"' });
        }

        const passwordHash = await auth.hashPassword(password);
        const newUser = await db.users.create({
            username,
            passwordHash,
            role
        });

        res.status(201).json(newUser);
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Update a user (admin only)
 * PUT /api/auth/users/:id
 */
router.put('/users/:id', auth.requireAuth, requireDashboardAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, role } = req.body;

        const updates = {};

        if (username) {
            updates.username = username;
        }

        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            updates.passwordHash = await auth.hashPassword(password);
        }

        if (role) {
            if (!['admin', 'viewer'].includes(role)) {
                return res.status(400).json({ error: 'Role must be either "admin" or "viewer"' });
            }

            // Prevent removing admin role from the last admin
            const user = await db.users.getById(id);
            if (user && user.role === 'admin' && role !== 'admin') {
                const allUsers = await db.users.getAll();
                const adminCount = allUsers.filter(u => u.role === 'admin').length;
                if (adminCount <= 1) {
                    return res.status(400).json({ error: 'Cannot remove admin role from the last admin user' });
                }
            }

            updates.role = role;
        }

        const updatedUser = await db.users.update(id, updates);
        res.json(updatedUser);
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

/**
 * Delete a user (admin only)
 * DELETE /api/auth/users/:id
 */
router.delete('/users/:id', auth.requireAuth, requireDashboardAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting yourself
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        await db.users.delete(id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

module.exports = router;
