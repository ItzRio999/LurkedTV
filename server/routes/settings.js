const express = require('express');
const router = express.Router();
const { settings, getDefaultSettings } = require('../db');
const syncService = require('../services/syncService');
const firebaseCacheSync = require('../services/firebaseCacheSync');

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

module.exports = router;

