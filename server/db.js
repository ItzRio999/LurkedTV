const fs = require('fs/promises');
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'db.json');
const tmpPath = `${dbPath}.tmp`;

let dbState = null;
let initPromise = null;
let writeQueue = Promise.resolve();

function createEmptyDb() {
  return {
    sources: [],
    hiddenItems: [],
    favorites: [],
    settings: getDefaultSettings(),
    users: [],
    nextId: 1
  };
}

function normalizeDb(data) {
  const base = createEmptyDb();
  if (!data || typeof data !== 'object') return base;
  return {
    sources: Array.isArray(data.sources) ? data.sources : base.sources,
    hiddenItems: Array.isArray(data.hiddenItems) ? data.hiddenItems : base.hiddenItems,
    favorites: Array.isArray(data.favorites) ? data.favorites : base.favorites,
    settings: data.settings && typeof data.settings === 'object' ? data.settings : base.settings,
    users: Array.isArray(data.users) ? data.users : base.users,
    nextId: Number.isInteger(data.nextId) && data.nextId > 0 ? data.nextId : base.nextId
  };
}

async function initializeDbState() {
  if (dbState) return dbState;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const fileContent = await fs.readFile(dbPath, 'utf-8');
      dbState = normalizeDb(JSON.parse(fileContent));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading database:', error);
      }
      dbState = createEmptyDb();
    }
    return dbState;
  })();

  return initPromise;
}

async function loadDb() {
  return initializeDbState();
}

// Default settings
function getDefaultSettings() {
  return {
    arrowKeysChangeChannel: true,
    overlayDuration: 5,
    defaultVolume: 80,
    rememberVolume: true,
    lastVolume: 80,
    autoPlayNextEpisode: false,
    forceProxy: false,
    hagsEnabled: false,          // User-provided hint: OS HAGS is enabled
    forceTranscode: false, // Force Audio Transcode
    forceVideoTranscode: false, // Force Video Transcode
    forceRemux: false,
    autoTranscode: true,
    streamFormat: 'm3u8',
    epgRefreshInterval: '24',
    // User-Agent settings
    userAgentPreset: 'chrome',    // chrome | vlc | tivimate | custom
    userAgentCustom: '',          // Custom UA string when preset is 'custom'
    // Transcoding settings
    hwEncoder: 'auto',            // auto | nvenc | amf | qsv | vaapi | software
    maxResolution: '1080p',       // 4k | 1080p | 720p | 480p
    quality: 'medium',            // high | medium | low
    audioMixPreset: 'auto',       // auto | itu | night | cinematic | passthrough
    // Probe cache settings  
    probeCacheTTL: 300,           // 5 minutes for URL probe cache
    seriesProbeCacheDays: 7,       // 7 days for series episode probe cache
    // Upscaling settings
    upscaleEnabled: false,
    upscaleMethod: 'hardware',    // hardware | software
    upscaleTarget: '1080p',       // 1080p | 4k | 720p
    // Auto profile metadata
    autoProfileVersion: 0,
    autoProfileAppliedAt: null,
    autoProfileSummary: '',
    // Discord bot configuration
    discordBotPrefix: '.',
    discordGuildId: '1356477545964372048',
    discordAdminRoleId: '1356477545989799990',
    discordLogChannelId: '',
    discordActiveWindowMs: 300000,
    discordCommandDedupeWindowMs: 15000
  };
}

function computeAutoProfileFromHardware(hw) {
  const cpu = hw?.cpu || {};
  const recommended = hw?.recommended || 'software';
  const hagsEnabled = hw?.hags?.enabled === true;
  const logicalThreads = cpu.logicalThreads || 4;
  const memoryGb = cpu.totalMemoryGb || 8;
  const hasGpu = recommended !== 'software';
  const veryLowEnd = !hasGpu && logicalThreads <= 4;
  const strongCpu = logicalThreads >= 12;
  const highMemory = memoryGb >= 16;
  const strongGpu = hasGpu && strongCpu && highMemory;

  let maxResolution = '1080p';
  let quality = 'medium';
  let upscaleEnabled = false;
  let upscaleTarget = '1080p';

  if (veryLowEnd) {
    maxResolution = '720p';
    quality = 'low';
  } else if (strongGpu) {
    maxResolution = '4k';
    quality = 'high';
    upscaleEnabled = true;
    upscaleTarget = '1080p';
  } else if (hasGpu) {
    maxResolution = highMemory ? '1080p' : '720p';
    quality = strongCpu ? 'high' : 'medium';
  } else {
    maxResolution = logicalThreads >= 8 ? '1080p' : '720p';
    quality = logicalThreads >= 8 ? 'medium' : 'low';
  }

  return {
    hwEncoder: hasGpu ? 'auto' : 'software',
    maxResolution,
    quality,
    ...(hagsEnabled ? { hagsEnabled: true } : {}),
    autoTranscode: true,
    forceTranscode: false,
    forceVideoTranscode: false,
    forceRemux: false,
    forceProxy: false,
    streamFormat: 'm3u8',
    audioMixPreset: 'auto',
    upscaleEnabled,
    upscaleMethod: hasGpu ? 'hardware' : 'software',
    upscaleTarget,
    probeCacheTTL: hasGpu ? 600 : 300,
    seriesProbeCacheDays: 7,
    autoProfileSummary: `${hasGpu ? 'GPU+CPU' : 'CPU-only'} profile (${recommended}, ${logicalThreads} threads, ${memoryGb}GB RAM${hagsEnabled ? ', HAGS on' : ''})`
  };
}

// User-Agent presets
const USER_AGENT_PRESETS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  vlc: 'VLC/3.0.20 LibVLC/3.0.20',
  tivimate: 'TiviMate/4.7.0',
};

function getUserAgent(settings) {
  if (settings.userAgentPreset === 'custom' && settings.userAgentCustom) {
    return settings.userAgentCustom;
  }
  return USER_AGENT_PRESETS[settings.userAgentPreset] || USER_AGENT_PRESETS.chrome;
}

async function saveDb(data) {
  if (!dbState) {
    await initializeDbState();
  }
  if (data && data !== dbState) {
    dbState = normalizeDb(data);
  }

  writeQueue = writeQueue.then(async () => {
    try {
      const snapshot = JSON.stringify(dbState);
      await fs.writeFile(tmpPath, snapshot, 'utf-8');
      await fs.rename(tmpPath, dbPath);
    } catch (err) {
      console.error('Error writing database:', err);
      try { await fs.unlink(tmpPath); } catch {}
      throw err;
    }
  }).catch(err => {
    console.error('Database write failed:', err);
  });

  return writeQueue;
}

// Source CRUD operations
const sources = {
  async getAll() {
    const db = await loadDb();
    return db.sources;
  },

  async getById(id) {
    const db = await loadDb();
    return db.sources.find(s => s.id === parseInt(id));
  },

  async getByType(type) {
    const db = await loadDb();
    return db.sources.filter(s => s.type === type && s.enabled);
  },

  async create(source) {
    const db = await loadDb();
    const newSource = {
      id: db.nextId++,
      ...source,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.sources.push(newSource);
    await saveDb(db);
    return newSource;
  },

  async update(id, updates) {
    const db = await loadDb();
    const index = db.sources.findIndex(s => s.id === parseInt(id));
    if (index === -1) return null;

    db.sources[index] = {
      ...db.sources[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    await saveDb(db);
    return db.sources[index];
  },

  async delete(id) {
    const db = await loadDb();
    db.sources = db.sources.filter(s => s.id !== parseInt(id));
    // Also delete related hidden items and favorites
    db.hiddenItems = db.hiddenItems.filter(h => h.source_id !== parseInt(id));
    db.favorites = db.favorites.filter(f => f.source_id !== parseInt(id));
    await saveDb(db);
  },

  async toggleEnabled(id) {
    const db = await loadDb();
    const source = db.sources.find(s => s.id === parseInt(id));
    if (source) {
      source.enabled = !source.enabled;
      source.updated_at = new Date().toISOString();
      await saveDb(db);
    }
    return source;
  }
};

// Hidden items operations
const hiddenItems = {
  async getAll(sourceId = null) {
    const db = await loadDb();
    if (sourceId) {
      return db.hiddenItems.filter(h => h.source_id === parseInt(sourceId));
    }
    return db.hiddenItems;
  },

  async hide(sourceId, itemType, itemId) {
    const db = await loadDb();
    // Check if already hidden
    const exists = db.hiddenItems.find(
      h => h.source_id === parseInt(sourceId) && h.item_type === itemType && h.item_id === itemId
    );
    if (!exists) {
      db.hiddenItems.push({
        id: db.nextId++,
        source_id: parseInt(sourceId),
        item_type: itemType,
        item_id: itemId
      });
      await saveDb(db);
    }
  },

  async show(sourceId, itemType, itemId) {
    const db = await loadDb();
    db.hiddenItems = db.hiddenItems.filter(
      h => !(h.source_id === parseInt(sourceId) && h.item_type === itemType && h.item_id === itemId)
    );
    await saveDb(db);
  },

  async isHidden(sourceId, itemType, itemId) {
    const db = await loadDb();
    return db.hiddenItems.some(
      h => h.source_id === parseInt(sourceId) && h.item_type === itemType && h.item_id === itemId
    );
  },

  async bulkHide(items) {
    const db = await loadDb();
    let modified = false;

    items.forEach(item => {
      const { sourceId, itemType, itemId } = item;
      const exists = db.hiddenItems.find(
        h => h.source_id === parseInt(sourceId) && h.item_type === itemType && h.item_id === itemId
      );

      if (!exists) {
        db.hiddenItems.push({
          id: db.nextId++,
          source_id: parseInt(sourceId),
          item_type: itemType,
          item_id: itemId
        });
        modified = true;
      }
    });

    if (modified) {
      await saveDb(db);
    }
    return true;
  },

  async bulkShow(items) {
    const db = await loadDb();
    const initialLength = db.hiddenItems.length;

    // Create a set of "signatures" for O(1) lookup of items to remove
    const toRemove = new Set(items.map(i => `${i.sourceId}:${i.itemType}:${i.itemId}`));

    db.hiddenItems = db.hiddenItems.filter(h =>
      !toRemove.has(`${h.source_id}:${h.item_type}:${h.item_id}`)
    );

    if (db.hiddenItems.length !== initialLength) {
      await saveDb(db);
    }
    return true;
  }
};

// Favorites operations
const favorites = {
  async getAll(sourceId = null, itemType = null) {
    const db = await loadDb();
    let results = db.favorites;
    if (sourceId) {
      results = results.filter(f => f.source_id === parseInt(sourceId));
    }
    if (itemType) {
      results = results.filter(f => f.item_type === itemType);
    }
    return results;
  },

  async add(sourceId, itemId, itemType = 'channel') {
    const db = await loadDb();
    // Check if already favorited
    const exists = db.favorites.find(
      f => f.source_id === parseInt(sourceId) && f.item_id === String(itemId) && f.item_type === itemType
    );
    if (!exists) {
      db.favorites.push({
        id: db.nextId++,
        source_id: parseInt(sourceId),
        item_id: String(itemId),
        item_type: itemType, // 'channel', 'movie', 'series'
        created_at: new Date().toISOString()
      });
      await saveDb(db);
    }
    return true;
  },

  async remove(sourceId, itemId, itemType = 'channel') {
    const db = await loadDb();
    db.favorites = db.favorites.filter(
      f => !(f.source_id === parseInt(sourceId) && f.item_id === String(itemId) && f.item_type === itemType)
    );
    await saveDb(db);
    return true;
  },

  async isFavorite(sourceId, itemId, itemType = 'channel') {
    const db = await loadDb();
    return db.favorites.some(
      f => f.source_id === parseInt(sourceId) && f.item_id === String(itemId) && f.item_type === itemType
    );
  }
};

// Settings operations
const settings = {
  async get() {
    const db = await loadDb();
    return { ...getDefaultSettings(), ...db.settings };
  },

  async update(newSettings) {
    const db = await loadDb();
    db.settings = { ...db.settings, ...newSettings };
    await saveDb(db);
    return db.settings;
  },

  async reset() {
    const db = await loadDb();
    db.settings = getDefaultSettings();
    await saveDb(db);
    return db.settings;
  },

  async applyAutoProfileIfNeeded(hwCapabilities, options = {}) {
    const { force = false } = options;
    const PROFILE_VERSION = 1;
    const db = await loadDb();
    const current = { ...getDefaultSettings(), ...db.settings };

    if (!force && current.autoProfileVersion >= PROFILE_VERSION) {
      return { applied: false, settings: current };
    }

    const profile = computeAutoProfileFromHardware(hwCapabilities || {});

    db.settings = {
      ...db.settings,
      ...profile,
      autoProfileVersion: PROFILE_VERSION,
      autoProfileAppliedAt: new Date().toISOString()
    };

    await saveDb(db);
    return { applied: true, settings: { ...getDefaultSettings(), ...db.settings } };
  }
};

// User operations
const users = {
  async getAll() {
    const db = await loadDb();
    return db.users || [];
  },

  async getById(id) {
    const db = await loadDb();
    return db.users?.find(u => u.id === parseInt(id));
  },

  async getByUsername(username) {
    const db = await loadDb();
    return db.users?.find(u => u.username === username);
  },

  async getByOidcId(oidcId) {
    const db = await loadDb();
    return db.users?.find(u => u.oidcId === oidcId);
  },

  async getByEmail(email) {
    const db = await loadDb();
    return db.users?.find(u => u.email === email);
  },

  async getByFirebaseUid(firebaseUid) {
    const db = await loadDb();
    return db.users?.find(u => u.firebaseUid === firebaseUid);
  },

  async getByDiscordId(discordId) {
    const db = await loadDb();
    return db.users?.find(u => String(u.discordId || '') === String(discordId || ''));
  },

  async create(userData) {
    const db = await loadDb();
    if (!db.users) {
      db.users = [];
    }

    // Check if username already exists
    if (db.users.some(u => u.username === userData.username)) {
      throw new Error('Username already exists');
    }

    const newUser = {
      id: db.nextId++,
      username: userData.username,
      // For OIDC users, passwordHash is optional
      passwordHash: userData.passwordHash || null,
      role: userData.role || 'viewer',
      oidcId: userData.oidcId || null,
      firebaseUid: userData.firebaseUid || null,
      discordId: userData.discordId || null,
      email: userData.email || null,
      defaultLanguage: userData.defaultLanguage || '',
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    await saveDb(db);

    // Return user without password hash
    const { passwordHash, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  },

  async update(id, updates) {
    const db = await loadDb();
    const userIndex = db.users?.findIndex(u => u.id === parseInt(id));

    if (userIndex === -1 || userIndex === undefined) {
      throw new Error('User not found');
    }

    // Check if username is being changed and if it already exists
    if (updates.username && updates.username !== db.users[userIndex].username) {
      if (db.users.some(u => u.username === updates.username)) {
        throw new Error('Username already exists');
      }
    }

    db.users[userIndex] = {
      ...db.users[userIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await saveDb(db);

    // Return user without password hash
    const { passwordHash, ...userWithoutPassword } = db.users[userIndex];
    return userWithoutPassword;
  },

  async delete(id) {
    const db = await loadDb();
    const userIndex = db.users?.findIndex(u => u.id === parseInt(id));

    if (userIndex === -1 || userIndex === undefined) {
      throw new Error('User not found');
    }

    // Prevent deleting the last admin
    const user = db.users[userIndex];
    if (user.role === 'admin') {
      const adminCount = db.users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('Cannot delete the last admin user');
      }
    }

    db.users.splice(userIndex, 1);
    await saveDb(db);
    return true;
  },

  async count() {
    const db = await loadDb();
    return db.users?.length || 0;
  }
};

module.exports = { loadDb, saveDb, sources, hiddenItems, favorites, settings, users, getDefaultSettings, getUserAgent, USER_AGENT_PRESETS };
