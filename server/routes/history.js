const express = require('express');
const router = express.Router();
const { getDb } = require('../db/sqlite');
const { requireAuth } = require('../auth');

// Middleware to ensure authentication
router.use(requireAuth);
const stmtCache = new Map();

function getStmt(key, sql) {
    if (!stmtCache.has(key)) {
        stmtCache.set(key, getDb().prepare(sql));
    }
    return stmtCache.get(key);
}

function parseJsonSafe(raw) {
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * GET /api/history
 * Returns the watch history for the authenticated user
 */
router.get('/', (req, res) => {
    try {
        const userId = req.user.id;
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 20;

        const rows = getStmt('history.list', `
            WITH ranked AS (
                SELECT
                    *,
                    ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(source_id, 0), COALESCE(item_type, ''), item_id
                        ORDER BY updated_at DESC
                    ) AS rn
                FROM watch_history
                WHERE user_id = ?
            )
            SELECT * FROM ranked
            WHERE rn = 1
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit);

        const history = rows.map(row => ({
            ...row,
            data: parseJsonSafe(row.data)
        }));

        res.json(history);
    } catch (err) {
        console.error('[History] Error fetching history:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

/**
 * GET /api/history/item/:itemId
 * Returns a single history row for a specific item/source/type
 */
router.get('/item/:itemId', (req, res) => {
    try {
        const userId = req.user.id;
        const itemId = req.params.itemId;
        const sourceId = req.query.sourceId !== undefined ? Number(req.query.sourceId) : null;
        const type = req.query.type ? String(req.query.type) : null;

        let row;
        if (sourceId !== null && Number.isFinite(sourceId) && type) {
            row = getStmt('history.item.bySourceType', `
                SELECT * FROM watch_history
                WHERE user_id = ? AND item_id = ? AND source_id = ? AND item_type = ?
                ORDER BY updated_at DESC
                LIMIT 1
            `).get(userId, itemId, sourceId, type);
        } else if (sourceId !== null && Number.isFinite(sourceId)) {
            row = getStmt('history.item.bySource', `
                SELECT * FROM watch_history
                WHERE user_id = ? AND item_id = ? AND source_id = ?
                ORDER BY updated_at DESC
                LIMIT 1
            `).get(userId, itemId, sourceId);
        } else if (type) {
            row = getStmt('history.item.byType', `
                SELECT * FROM watch_history
                WHERE user_id = ? AND item_id = ? AND item_type = ?
                ORDER BY updated_at DESC
                LIMIT 1
            `).get(userId, itemId, type);
        } else {
            row = getStmt('history.item.byItem', `
                SELECT * FROM watch_history
                WHERE user_id = ? AND item_id = ?
                ORDER BY updated_at DESC
                LIMIT 1
            `).get(userId, itemId);
        }

        if (!row) {
            return res.status(404).json({ error: 'Item not found in history' });
        }

        res.json({
            ...row,
            data: parseJsonSafe(row.data)
        });
    } catch (err) {
        console.error('[History] Error fetching single history item:', err);
        res.status(500).json({ error: 'Failed to fetch history item' });
    }
});

/**
 * POST /api/history
 * Saves/updates watch progress for an item
 */
router.post('/', (req, res) => {
    try {
        const userId = req.user.id;
        const { id, type, parentId, progress, duration, data, sourceId, completed } = req.body;

        if (!id || !type) {
            return res.status(400).json({ error: 'Missing required fields (id, type)' });
        }

        const normalizedType = type === 'movie' ? 'movie' : 'episode';
        const normalizedSourceId = sourceId !== undefined && sourceId !== null && Number.isFinite(Number(sourceId))
            ? Number(sourceId)
            : 0;
        const compositeId = `${userId}:${normalizedSourceId}:${normalizedType}:${id}`;
        const timestamp = Date.now();
        const numericDuration = Math.max(0, Number(duration) || 0);
        const numericProgress = Math.max(0, Number(progress) || 0);

        const isCompleted = !!completed || (
            numericDuration > 0 && (
                numericProgress >= numericDuration ||
                (numericDuration - numericProgress) <= 15 ||
                (numericProgress / numericDuration) >= 0.98
            )
        );

        if (isCompleted) {
            const deleteStmt = getStmt('history.delete.completed', `
                DELETE FROM watch_history
                WHERE user_id = ? AND item_id = ? AND source_id = ? AND item_type = ?
            `);
            deleteStmt.run(userId, id.toString(), normalizedSourceId, normalizedType);
            return res.json({ success: true, removed: true, timestamp });
        }

        const stmt = getStmt('history.upsert', `
            INSERT INTO watch_history (id, user_id, source_id, item_type, item_id, parent_id, progress, duration, updated_at, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id,
                progress = excluded.progress,
                duration = excluded.duration,
                updated_at = excluded.updated_at,
                data = excluded.data
        `);

        stmt.run(
            compositeId,
            userId,
            normalizedSourceId,
            normalizedType,
            id.toString(),
            parentId ? parentId.toString() : null,
            numericProgress,
            numericDuration,
            timestamp,
            JSON.stringify(data || {})
        );

        const reason = String(data?.reason || '').toLowerCase();
        if (normalizedType === 'movie' && reason === 'play') {
            console.log('[DiscordBotPlayback] movie_started', JSON.stringify({
                userId,
                sourceId: normalizedSourceId,
                itemId: String(id),
                title: String(data?.title || ''),
                subtitle: String(data?.subtitle || ''),
                poster: String(data?.poster || ''),
                containerExtension: String(data?.containerExtension || 'mp4'),
                progress: numericProgress,
                duration: numericDuration,
                updatedAt: timestamp
            }));
        }

        res.json({ success: true, timestamp });
    } catch (err) {
        console.error('[History] Error saving progress:', err);
        res.status(500).json({ error: 'Failed to save progress' });
    }
});

/**
 * DELETE /api/history
 * Clears all watch history rows for authenticated user
 */
router.delete('/', (req, res) => {
    try {
        const userId = req.user.id;
        const stmt = getStmt('history.delete.all', 'DELETE FROM watch_history WHERE user_id = ?');
        const result = stmt.run(userId);
        res.json({ success: true, removed: result.changes || 0 });
    } catch (err) {
        console.error('[History] Error clearing history:', err);
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

/**
 * DELETE /api/history/:itemId
 * Removes an item from the user's watch history
 */
router.delete('/:itemId', (req, res) => {
    try {
        const userId = req.user.id;
        const itemId = req.params.itemId;
        const sourceId = req.query.sourceId !== undefined ? Number(req.query.sourceId) : null;
        const type = req.query.type ? String(req.query.type) : null;

        let result;
        if (sourceId !== null && Number.isFinite(sourceId) && type) {
            const stmt = getStmt('history.delete.bySourceType', `
                DELETE FROM watch_history
                WHERE user_id = ? AND item_id = ? AND source_id = ? AND item_type = ?
            `);
            result = stmt.run(userId, itemId, sourceId, type);
        } else if (sourceId !== null && Number.isFinite(sourceId)) {
            const stmt = getStmt('history.delete.bySource', `
                DELETE FROM watch_history
                WHERE user_id = ? AND item_id = ? AND source_id = ?
            `);
            result = stmt.run(userId, itemId, sourceId);
        } else if (type) {
            const stmt = getStmt('history.delete.byType', `
                DELETE FROM watch_history
                WHERE user_id = ? AND item_id = ? AND item_type = ?
            `);
            result = stmt.run(userId, itemId, type);
        } else {
            const stmt = getStmt('history.delete.byItem', 'DELETE FROM watch_history WHERE user_id = ? AND item_id = ?');
            result = stmt.run(userId, itemId);
        }

        res.json({ success: true, removed: result.changes > 0 });
    } catch (err) {
        console.error('[History] Error deleting history item:', err);
        res.status(500).json({ error: 'Failed to delete history item' });
    }
});

module.exports = router;
