const express = require('express');
require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const passport = require('passport');
const syncService = require('./services/syncService');
const firebaseCacheSync = require('./services/firebaseCacheSync');

// Initialize database
const dbStore = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const startupAt = Date.now();

function clearConsole() {
    if (process.stdout.isTTY && process.env.NO_CLEAR !== '1') {
        process.stdout.write('\x1Bc');
    }
}

function startupLog(message) {
    console.log(`[Startup] ${message}`);
}

function startupDivider(title = '') {
    const line = '============================================================';
    console.log(line);
    if (title) {
        console.log(`[Startup] ${title}`);
        console.log(line);
    }
}

// Keep startup output readable during dev restarts
clearConsole();
startupDivider('LurkedTv Server Boot');

// Trust proxy headers (X-Forwarded-Proto, X-Forwarded-For, etc.)
// Required for correct protocol detection behind reverse proxies (nginx, Caddy, etc.)
app.set('trust proxy', true);

// Middleware
app.use(express.json({ limit: '50mb' }));

// Initialize Passport
const session = require('express-session');
app.use(session({
    secret: process.env.JWT_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

// In production (NODE_ENV=production) serve the pre-built dist/ directory.
// In development the Express server still serves public/ directly; Vite (port 5173)
// is the recommended dev entry point and proxies /api requests here.
const distDir = path.join(__dirname, '..', 'dist');
const publicDir = path.join(__dirname, '..', 'public');
const frontendDir = (process.env.NODE_ENV === 'production' && fs.existsSync(distDir))
  ? distDir
  : publicDir;

app.use(express.static(frontendDir));

// FFMPEG Configuration (optional - for transcoding support)
// Priority: 1. System FFmpeg (better Docker DNS support), 2. ffmpeg-static npm package
const { execSync } = require('child_process');

function findFFmpeg() {
    // Try system FFmpeg first (better Docker compatibility)
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        startupLog('FFmpeg binary: ffmpeg (system)');
        return 'ffmpeg';
    } catch (e) {
        // System FFmpeg not found, try ffmpeg-static
    }

    // Try ffmpeg-static npm package
    try {
        let ffmpegPath = require('ffmpeg-static');
        // In packaged Electron apps, ffmpeg-static returns path inside .asar archive
        // but the binary is actually unpacked to app.asar.unpacked
        if (ffmpegPath && ffmpegPath.includes('app.asar')) {
            ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
        }
        startupLog(`FFmpeg binary: ${ffmpegPath}`);
        return ffmpegPath;
    } catch (err) {
        console.warn('[Startup] FFmpeg not available - transcoding/remuxing disabled.');
        console.warn('[Startup] Install FFmpeg via your package manager or npm install ffmpeg-static');
        return null;
    }
}

function findFFprobe() {
    // Try system ffprobe first
    try {
        execSync('ffprobe -version', { stdio: 'ignore' });
        startupLog('FFprobe binary: ffprobe (system)');
        return 'ffprobe';
    } catch (e) {
        // Not found in system
    }

    // Try @ffprobe-installer/ffprobe package
    try {
        const ffprobePath = require('@ffprobe-installer/ffprobe').path;
        if (ffprobePath) {
            startupLog(`FFprobe binary: ${ffprobePath}`);
            return ffprobePath;
        }
    } catch (err) {
        // Package not available
    }

    console.warn('[Startup] FFprobe not available - auto transcode falls back to always transcode');
    return null;
}

app.locals.ffmpegPath = findFFmpeg();
app.locals.ffprobePath = findFFprobe();

// Dynamic services loader - collects exports from files in ./services
const services = {};
try {
    const servicesDir = path.join(__dirname, 'services');
    const serviceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
    for (const file of serviceFiles) {
        const name = file.replace(/\.js$/, '');
        try {
            services[name] = require(path.join(servicesDir, file));
        } catch (e) {
            console.warn(`Failed to load service ${file}:`, e.message);
        }
    }
} catch (e) {
    console.warn('No services directory found or failed to read services:', e.message);
}

// Freeze services object to prevent plugins from mutating shared state
Object.freeze(services);

// Plugin loader: loads any .js file inside server/plugins and calls the
// exported function with (app, services).
// Supports both function exports and object exports with lifecycle hooks.
const loadedPlugins = [];

async function loadPlugins() {
    try {
        const pluginsDir = path.join(__dirname, 'plugins');
        if (fs.existsSync(pluginsDir)) {
            // Sort plugin files alphabetically for deterministic load order
            const pluginFiles = fs.readdirSync(pluginsDir)
                .filter(f => f.endsWith('.js'))
                .sort();

            for (const file of pluginFiles) {
                const pluginPath = path.join(pluginsDir, file);
                try {
                    const plugin = require(pluginPath);

                    // Support both function exports and object exports with lifecycle hooks
                    if (typeof plugin === 'function') {
                        // Direct function export (sync or async)
                        await plugin(app, services);
                        loadedPlugins.push({ name: file, plugin: null });
                        console.log(`[Plugin] Loaded: ${file}`);
                    } else if (plugin && typeof plugin.init === 'function') {
                        // Object export with init/shutdown lifecycle
                        await plugin.init(app, services);
                        loadedPlugins.push({ name: file, plugin });
                        console.log(`[Plugin] Loaded: ${file} (lifecycle hooks)`);
                    } else {
                        console.warn(`[Plugin] ${file} does not export a function or object with init(); skipped.`);
                    }
                } catch (err) {
                    console.error(`[Plugin] Failed to load ${file}:`, err);
                }
            }
        }
    } catch (err) {
        console.warn('Plugin loader failed:', err.message);
    }
}

// Graceful shutdown handler for plugins with shutdown hooks
process.on('SIGTERM', async () => {
    console.log('[Startup] SIGTERM received, shutting down plugins...');
    for (const { name, plugin } of loadedPlugins) {
        if (plugin && typeof plugin.shutdown === 'function') {
            try {
                await plugin.shutdown();
                console.log(`[Plugin] Shutdown: ${name}`);
            } catch (err) {
                console.error(`[Plugin] Shutdown error for ${name}:`, err);
            }
        }
    }
    process.exit(0);
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/proxy', require('./routes/proxy'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/transcode', require('./routes/transcode'));
app.use('/api/remux', require('./routes/remux'));
app.use('/api/probe', require('./routes/probe'));
app.use('/api/subtitle', require('./routes/subtitle'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/history', require('./routes/history'));

// Version endpoint
app.get('/api/version', (req, res) => {
    const pkg = require('../package.json');
    res.json({ version: pkg.version });
});

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
    startupLog(`Server running on http://localhost:${PORT}`);
    startupLog(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Load plugins
    await loadPlugins().catch(err => {
        console.error('[Plugin] Initialization failed:', err);
    });

    // Trigger background sync with delay to allow server to settle
    setTimeout(async () => {
        await syncService.syncAll().catch(console.error);
        // Start the server-side sync timer after initial sync
        await syncService.startSyncTimer().catch(console.error);

        // Start Firebase media cache sync timer (24h) and do initial push after first sync
        firebaseCacheSync.startTimer();
        await firebaseCacheSync.syncNow('startup').catch(err => {
            console.warn('[FirebaseCache] Initial startup sync skipped:', err.message);
        });

        // Detect hardware acceleration capabilities
        try {
            const hwDetect = require('./services/hwDetect');
            const capabilities = await hwDetect.detect();
            const profileResult = await dbStore.settings.applyAutoProfileIfNeeded(capabilities);
            if (profileResult.applied) {
                startupLog(`Applied system auto-profile: ${profileResult.settings.autoProfileSummary}`);
            }
        } catch (err) {
            console.warn('Hardware detection failed:', err.message);
        }
    }, 5000);

    startupLog(`Startup completed in ${Date.now() - startupAt}ms`);
    startupDivider();
});
