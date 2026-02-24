const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const cacheDir = path.join(__dirname, '..', '..', 'data', 'cache');
const memoryCache = new Map();
const knownDirs = new Set();

function normalizeKey(type, sourceId, key) {
    return `${type}:${sourceId}:${String(key || 'default')}`;
}

function ensureCacheDir(type, sourceId) {
    const dir = path.join(cacheDir, type, String(sourceId));
    if (knownDirs.has(dir)) return dir;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    knownDirs.add(dir);
    return dir;
}

function getCachePath(type, sourceId, key) {
    const dir = ensureCacheDir(type, sourceId);
    const safeKey = String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(dir, `${safeKey}.json`);
}

/**
 * Get cached data if not expired
 * @param {string} type - Cache type (epg, m3u, xtream)
 * @param {number|string} sourceId - Source ID
 * @param {string} key - Cache key (e.g., action name)
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {any|null} - Cached data or null if expired/missing
 */
function get(type, sourceId, key, maxAgeMs) {
    try {
        const mapKey = normalizeKey(type, sourceId, key);
        const inMemory = memoryCache.get(mapKey);
        if (inMemory) {
            if (Date.now() - inMemory.timestamp <= maxAgeMs) {
                return inMemory.data;
            }
            memoryCache.delete(mapKey);
            return null;
        }

        const cachePath = getCachePath(type, sourceId, key);
        if (!fs.existsSync(cachePath)) {
            return null;
        }

        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        memoryCache.set(mapKey, cached);
        const age = Date.now() - cached.timestamp;

        if (age > maxAgeMs) {
            return null; // Expired
        }

        return cached.data;
    } catch (err) {
        console.warn(`Cache read error for ${type}/${sourceId}/${key}:`, err.message);
        return null;
    }
}

/**
 * Store data in cache
 * @param {string} type - Cache type
 * @param {number|string} sourceId - Source ID
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 */
function set(type, sourceId, key, data) {
    try {
        const mapKey = normalizeKey(type, sourceId, key);
        const now = Date.now();
        const cachePath = getCachePath(type, sourceId, key);
        const cached = {
            timestamp: now,
            data: data
        };
        memoryCache.set(mapKey, cached);
        fsp.writeFile(cachePath, JSON.stringify(cached), 'utf-8').catch(err => {
            console.error(`Cache write error for ${type}/${sourceId}/${key}:`, err.message);
        });
    } catch (err) {
        console.error(`Cache write error for ${type}/${sourceId}/${key}:`, err.message);
    }
}

/**
 * Clear specific cache entry
 */
function clear(type, sourceId, key) {
    try {
        memoryCache.delete(normalizeKey(type, sourceId, key));
        const cachePath = getCachePath(type, sourceId, key);
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
        }
    } catch (err) {
        console.warn(`Cache clear error:`, err.message);
    }
}

/**
 * Clear all cache for a source
 */
function clearSource(sourceId) {
    try {
        const suffix = `:${String(sourceId)}:`;
        for (const key of memoryCache.keys()) {
            if (key.includes(suffix)) {
                memoryCache.delete(key);
            }
        }

        const types = ['epg', 'm3u', 'xtream'];
        for (const type of types) {
            const dir = path.join(cacheDir, type, String(sourceId));
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true });
            }
        }
    } catch (err) {
        console.warn(`Cache clear source error:`, err.message);
    }
}

/**
 * Clear all cache
 */
function clearAll() {
    try {
        memoryCache.clear();
        knownDirs.clear();
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true });
        }
    } catch (err) {
        console.warn(`Cache clear all error:`, err.message);
    }
}

/**
 * Get cache info for debugging
 */
function getInfo(type, sourceId, key) {
    try {
        const cachePath = getCachePath(type, sourceId, key);
        if (!fs.existsSync(cachePath)) {
            return null;
        }
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const stats = fs.statSync(cachePath);
        return {
            timestamp: cached.timestamp,
            age: Date.now() - cached.timestamp,
            size: stats.size
        };
    } catch (err) {
        return null;
    }
}

module.exports = {
    get,
    set,
    clear,
    clearSource,
    clearAll,
    getInfo
};
