
(function () {
  function resolveStaticMode() {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('staticMode') === '1') return true;
      if (qs.get('staticMode') === '0') return false;
    } catch {}

    // Opt-in local override for demo/testing without backend API.
    const persisted = localStorage.getItem('nodecast_static_mode');
    if (persisted === '1' || persisted === 'true') return true;
    if (persisted === '0' || persisted === 'false') return false;

    // Default to real backend API mode.
    return false;
  }

  const STATIC_MODE = resolveStaticMode();
  const KEY = 'nodecast_static_state_v1';
  const DEFAULT_SETTINGS = {
    arrowKeysChangeChannel: true,
    overlayDuration: 5,
    defaultVolume: 80,
    rememberVolume: true,
    lastVolume: 80,
    autoPlayNextEpisode: false,
    forceProxy: false,
    hagsEnabled: false,
    forceTranscode: false,
    forceRemux: false,
    autoTranscode: false,
    streamFormat: 'm3u8',
    epgRefreshInterval: '24',
    userAgentPreset: 'chrome',
    userAgentCustom: '',
    defaultLanguage: ''
  };
  const mem = { m3u: new Map(), sync: new Map(), epg: new Map(), recent: new Map() };

  function now() { return new Date().toISOString(); }
  function nowMs() { return Date.now(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function decodeBase64UrlJson(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4;
      if (pad) b64 += '='.repeat(4 - pad);
      const text = atob(b64);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {
        sources: [], favorites: [], hidden: [], history: [],
        users: [{ id: 1, username: 'Local User', email: 'local@lurked.tv', role: 'admin', createdAt: now() }],
        account: { id: 1, username: 'Local User', email: 'local@lurked.tv', role: 'admin', emailVerified: true, discordLinked: false, discordAdmin: true, defaultLanguage: '' },
        settings: { ...DEFAULT_SETTINGS },
        meta: { sid: 1, fid: 1, hid: 1, uid: 2, lastEpgSyncMs: 0, firebaseLastSyncMs: 0 }
      };
      const s = JSON.parse(raw);
      return {
        sources: Array.isArray(s.sources) ? s.sources : [],
        favorites: Array.isArray(s.favorites) ? s.favorites : [],
        hidden: Array.isArray(s.hidden) ? s.hidden : [],
        history: Array.isArray(s.history) ? s.history : [],
        users: Array.isArray(s.users) && s.users.length ? s.users : [{ id: 1, username: 'Local User', email: 'local@lurked.tv', role: 'admin', createdAt: now() }],
        account: { id: 1, username: 'Local User', email: 'local@lurked.tv', role: 'admin', emailVerified: true, discordLinked: false, discordAdmin: true, defaultLanguage: '', ...(s.account || {}) },
        settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
        meta: {
          sid: Number(s?.meta?.sid || 1),
          fid: Number(s?.meta?.fid || 1),
          hid: Number(s?.meta?.hid || 1),
          uid: Number(s?.meta?.uid || 2),
          lastEpgSyncMs: Number(s?.meta?.lastEpgSyncMs || 0),
          firebaseLastSyncMs: Number(s?.meta?.firebaseLastSyncMs || 0)
        }
      };
    } catch {
      localStorage.removeItem(KEY);
      return load();
    }
  }

  let state = load();
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function src(id) { return state.sources.find(s => Number(s.id) === Number(id)); }
  function normBase(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/player_api\.php$/i, '').replace(/\/get\.php$/i, '');
  }
  function xtreamUrl(source, action, extra = {}) {
    const p = new URLSearchParams({ username: source.username || '', password: source.password || '' });
    if (action) p.set('action', action);
    Object.keys(extra).forEach(k => { if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') p.set(k, String(extra[k])); });
    return `${normBase(source.url)}/player_api.php?${p.toString()}`;
  }
  async function fetchJson(url, options = {}) {
    const r = await nativeFetch(url, options);
    const t = await r.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    if (!r.ok) throw new Error((d && d.error) || t || `Request failed (${r.status})`);
    return d;
  }

  function parseM3uAttrs(s) {
    const a = {};
    const re = /([a-zA-Z0-9-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(s))) a[m[1]] = m[2];
    return a;
  }
  function parseM3u(text, sourceId) {
    const lines = String(text || '').split(/\r?\n/);
    const groups = new Map();
    const streams = [];
    const idMap = new Map();
    let meta = null;
    let i = 1;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        const c = line.indexOf(',');
        const hdr = c >= 0 ? line.slice(0, c) : line;
        const name = c >= 0 ? line.slice(c + 1).trim() : `Channel ${i}`;
        const attrs = parseM3uAttrs(hdr.replace(/^#EXTINF:[^ ]*\s*/, ''));
        const g = attrs['group-title'] || 'Uncategorized';
        if (!groups.has(g)) groups.set(g, String(groups.size + 1));
        meta = {
          stream_id: String(i++), name,
          tvg_id: attrs['tvg-id'] || '', tvg_name: attrs['tvg-name'] || name,
          stream_icon: attrs['tvg-logo'] || '', category_id: groups.get(g), sourceId, sourceType: 'm3u'
        };
        continue;
      }
      if (line.startsWith('#')) continue;
      if (meta) {
        streams.push({ ...meta, url: line });
        idMap.set(String(meta.stream_id), line);
        meta = null;
      }
    }
    const categories = [...groups.entries()].map(([name, id]) => ({ category_id: id, category_name: name }));
    return { categories, streams, idMap, count: streams.length };
  }
  async function m3u(source) {
    const k = String(source.id);
    const c = mem.m3u.get(k);
    if (c && c.url === source.url) return c.data;
    const r = await nativeFetch(source.url);
    if (!r.ok) throw new Error(`Could not fetch M3U (${r.status})`);
    const d = parseM3u(await r.text(), source.id);
    mem.m3u.set(k, { url: source.url, data: d });
    return d;
  }

  function parseXmltvDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4}|Z)?$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
      const hh = Number(m[4]), mm = Number(m[5]), ss = Number(m[6]);
      const tz = m[7] || '+0000';
      const ts = Date.UTC(y, mo, d, hh, mm, ss);
      if (tz === 'Z' || tz === '+0000') return ts;
      const sign = tz.startsWith('-') ? -1 : 1;
      const tzh = Number(tz.slice(1, 3));
      const tzm = Number(tz.slice(3, 5));
      const offsetMs = sign * ((tzh * 60 + tzm) * 60 * 1000);
      return ts - offsetMs;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseXmltv(xmlText, sourceId) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'text/xml');
    const channels = [];
    const programmes = [];
    const channelMap = new Map();

    xml.querySelectorAll('channel').forEach((node) => {
      const id = node.getAttribute('id') || '';
      if (!id) return;
      const name = node.querySelector('display-name')?.textContent?.trim() || id;
      const icon = node.querySelector('icon')?.getAttribute('src') || '';
      const item = { id, name, icon, sourceId };
      channelMap.set(id, item);
      channels.push(item);
    });

    xml.querySelectorAll('programme').forEach((node) => {
      const channelId = node.getAttribute('channel') || '';
      const startMs = parseXmltvDate(node.getAttribute('start'));
      const stopMs = parseXmltvDate(node.getAttribute('stop'));
      if (!channelId || !Number.isFinite(startMs) || !Number.isFinite(stopMs)) return;
      const title = node.querySelector('title')?.textContent?.trim() || 'Untitled';
      const description = node.querySelector('desc')?.textContent?.trim() || '';
      programmes.push({
        channelId,
        start: new Date(startMs).toISOString(),
        stop: new Date(stopMs).toISOString(),
        title,
        description
      });
      if (!channelMap.has(channelId)) {
        const fallback = { id: channelId, name: channelId, icon: '', sourceId };
        channelMap.set(channelId, fallback);
        channels.push(fallback);
      }
    });

    return { channels, programmes };
  }

  function getEpgUrl(source) {
    if (!source) return '';
    if (source.type === 'epg') return String(source.url || '').trim();
    if (source.type === 'xtream') {
      const base = normBase(source.url);
      const p = new URLSearchParams({ username: source.username || '', password: source.password || '' });
      return `${base}/xmltv.php?${p.toString()}`;
    }
    return '';
  }

  async function epgForSource(source, { forceRefresh = false, maxAgeHours = 24 } = {}) {
    const key = String(source.id);
    const cached = mem.epg.get(key);
    const ttlMs = Math.max(1, Number(maxAgeHours || 24)) * 60 * 60 * 1000;
    if (!forceRefresh && cached && (nowMs() - cached.at) < ttlMs) {
      return cached.data;
    }

    const epgUrl = getEpgUrl(source);
    if (!epgUrl) return { channels: [], programmes: [] };

    const response = await nativeFetch(epgUrl);
    if (!response.ok) throw new Error(`EPG fetch failed (${response.status})`);
    const xmlText = await response.text();
    const data = parseXmltv(xmlText, source.id);

    const syncedAt = nowMs();
    mem.epg.set(key, { data, at: syncedAt });
    mem.sync.set(key, { status: 'success', last_sync: syncedAt, error: null });
    state.meta.lastEpgSyncMs = Math.max(Number(state.meta.lastEpgSyncMs || 0), syncedAt);
    state.meta.firebaseLastSyncMs = Math.max(Number(state.meta.firebaseLastSyncMs || 0), syncedAt);
    save();

    return data;
  }

  async function xtreamRecent(type, limit) {
    const enabledXtream = state.sources.filter(s => s.enabled && s.type === 'xtream');
    if (!enabledXtream.length) return [];

    const perSourceCap = Math.max(50, Math.min(300, limit * 5));
    const all = [];

    for (const source of enabledXtream) {
      const cacheKey = `${source.id}:${type}`;
      const cached = mem.recent.get(cacheKey);
      if (cached && (nowMs() - cached.at) < 5 * 60 * 1000) {
        all.push(...cached.items);
        continue;
      }

      let action = 'get_vod_streams';
      if (type === 'series') action = 'get_series';
      const rows = await fetchJson(xtreamUrl(source, action)) || [];
      const mapped = rows.slice(0, perSourceCap).map((row, idx) => {
        const itemId = type === 'series' ? row.series_id : row.stream_id;
        const addedRaw = row.added || row.releaseDate || row.release_date || row.year || '';
        const addedMs = Number.isFinite(Number(addedRaw)) ? Number(addedRaw) * (String(addedRaw).length <= 10 ? 1000 : 1) : (Date.parse(String(addedRaw)) || 0);
        return {
          source_id: source.id,
          item_id: String(itemId || `${source.id}-${idx}`),
          type,
          item_type: type,
          name: row.name || row.title || `${type} ${idx + 1}`,
          stream_icon: row.stream_icon || row.cover || '',
          year: row.year || '',
          added: addedMs || 0,
          data: {
            title: row.name || row.title || '',
            poster: row.stream_icon || row.cover || '',
            year: row.year || '',
            sourceId: source.id
          }
        };
      });

      mem.recent.set(cacheKey, { at: nowMs(), items: mapped });
      all.push(...mapped);
    }

    return all.sort((a, b) => Number(b.added || 0) - Number(a.added || 0)).slice(0, limit);
  }

  const nativeFetch = window.fetch.bind(window);

  async function route(method, path, u, body) {
    const p = path.replace(/^\/api/, '') || '/';

    if (method === 'GET' && p === '/version') return { s: 200, d: { version: '6.0.0', mode: 'static' } };

    if (p === '/auth/me' && method === 'GET') return { s: 200, d: { ...state.account } };
    if (p === '/auth/logout' && method === 'POST') return { s: 200, d: { success: true } };
    if (p === '/auth/firebase' && method === 'POST') {
      const idToken = String(body?.idToken || '');
      const parts = idToken.split('.');
      const payload = parts.length >= 2 ? decodeBase64UrlJson(parts[1]) : null;

      const email = payload?.email || state.account.email || '';
      const username = payload?.name || payload?.displayName || (email.includes('@') ? email.split('@')[0] : state.account.username || 'User');
      state.account = {
        ...state.account,
        email: email || state.account.email || 'unknown@user.local',
        username,
        emailVerified: payload?.email_verified !== false
      };
      save();

      const token = payload?.sub ? `firebase:${payload.sub}` : `firebase:${Date.now()}`;
      return { s: 200, d: { token } };
    }

    if (p === '/auth/users' && method === 'GET') return { s: 200, d: clone(state.users) };
    if (p === '/auth/users' && method === 'POST') {
      const user = { id: state.meta.uid++, username: body?.username || `user${state.meta.uid}`, email: body?.email || '', role: body?.role || 'viewer', createdAt: now() };
      state.users.push(user); save(); return { s: 200, d: user };
    }
    let m = p.match(/^\/auth\/users\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === 'PUT') {
        const user = state.users.find(x => Number(x.id) === id);
        if (!user) return { s: 404, d: { error: 'User not found' } };
        Object.assign(user, { username: body?.username ?? user.username, role: body?.role ?? user.role, email: body?.email ?? user.email });
        save(); return { s: 200, d: user };
      }
      if (method === 'DELETE') {
        state.users = state.users.filter(x => Number(x.id) !== id); save(); return { s: 200, d: { success: true } };
      }
    }

    if (p === '/account/me' && method === 'GET') return { s: 200, d: { ...state.account } };
    if (p === '/auth/me/preferences' && method === 'PATCH') {
      state.account.defaultLanguage = body?.defaultLanguage || '';
      state.settings.defaultLanguage = state.account.defaultLanguage;
      save(); return { s: 200, d: { ...state.account } };
    }
    if (p === '/auth/me/change-password' && method === 'POST') return { s: 200, d: { success: true } };
    if (p === '/auth/discord/link/start' && method === 'POST') return { s: 200, d: { url: window.location.href } };
    if (p === '/auth/discord/link' && method === 'DELETE') return { s: 200, d: { success: true } };
    if (p === '/auth/discord/admin-status' && method === 'GET') return { s: 200, d: { isAdmin: true } };

    if (p === '/settings' && method === 'GET') return { s: 200, d: { ...DEFAULT_SETTINGS, ...state.settings } };
    if (p === '/settings' && method === 'PUT') { state.settings = { ...state.settings, ...(body || {}) }; save(); return { s: 200, d: state.settings }; }
    if (p === '/settings' && method === 'DELETE') { state.settings = { ...DEFAULT_SETTINGS }; save(); return { s: 200, d: { success: true } }; }
    if (p === '/settings/defaults' && method === 'GET') return { s: 200, d: { ...DEFAULT_SETTINGS } };
    if (p === '/settings/sync-status' && method === 'GET') {
      const syncRows = state.sources.map(s => mem.sync.get(String(s.id))?.last_sync || 0);
      const lastSyncMs = Math.max(Number(state.meta.lastEpgSyncMs || 0), ...syncRows);
      const firebaseLastMs = Number(state.meta.firebaseLastSyncMs || lastSyncMs || 0);
      return {
        s: 200,
        d: {
          lastSyncTime: lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null,
          firebaseCache: {
            enabled: true,
            syncing: false,
            lastSyncTime: firebaseLastMs > 0 ? new Date(firebaseLastMs).toISOString() : null,
            nextSyncTime: null,
            lastError: null
          }
        }
      };
    }
    if (p === '/settings/firebase-cache/sync' && method === 'POST') {
      state.meta.firebaseLastSyncMs = nowMs();
      save();
      return { s: 200, d: { started: true, message: 'Static sync completed.' } };
    }
    if (p === '/settings/auto-profile/apply' && method === 'POST') return { s: 200, d: { success: true } };
    if (p === '/settings/discord-bot/status' && method === 'GET') return { s: 200, d: { config: { prefix: '!', guildId: '', adminRoleId: '', logChannelId: '' }, monitor: { heartbeat: { online: false, ageMs: 0 }, botIdentity: { ok: false }, guildStatus: { ok: false }, roleStatus: { ok: false } } } };
    if (p === '/settings/discord-bot/config' && method === 'PUT') return { s: 200, d: { success: true } };
    if (p === '/settings/hw-info' && method === 'GET') return { s: 200, d: { cpu: { available: true, model: navigator.platform || 'CPU', physicalCores: navigator.hardwareConcurrency || 4, logicalThreads: navigator.hardwareConcurrency || 4, recommendedThreads: Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)) }, nvidia: { available: false }, amf: { available: false }, qsv: { available: false }, vaapi: { available: false }, hags: { supported: /^Win/i.test(navigator.platform || ''), enabled: null, reason: 'Static mode cannot detect OS HAGS state' }, recommended: 'software', recommendedPipeline: 'software' } };

    if (p === '/sources' && method === 'GET') return { s: 200, d: clone(state.sources) };
    if (p === '/sources' && method === 'POST') {
      const t = String(body?.type || '').toLowerCase();
      if (!['xtream', 'm3u', 'epg'].includes(t)) return { s: 400, d: { error: 'Invalid source type' } };
      const source = { id: state.meta.sid++, type: t, name: body?.name || `${t.toUpperCase()} Source`, url: body?.url || '', username: body?.username || '', password: body?.password || '', enabled: body?.enabled !== false, created_at: now(), updated_at: now() };
      state.sources.push(source); save(); return { s: 200, d: source };
    }
    if (p === '/sources/status' && method === 'GET') {
      const data = state.sources.map(s => {
        const x = mem.sync.get(String(s.id));
        const fallbackMs = Date.parse(s.updated_at || s.created_at || '') || 0;
        return { source_id: s.id, type: 'all', status: x?.status || 'success', last_sync: Number(x?.last_sync || fallbackMs || 0), error: x?.error || null };
      });
      return { s: 200, d: data };
    }
    if (p === '/sources/estimate' && method === 'POST') {
      const r = await nativeFetch(String(body?.url || ''));
      if (!r.ok) return { s: 400, d: { error: `Estimate failed (${r.status})` } };
      const text = await r.text();
      const count = (text.match(/#EXTINF:/g) || []).length;
      return { s: 200, d: { count, needsWarning: count >= 5000 } };
    }

    m = p.match(/^\/sources\/type\/([a-z0-9_-]+)$/i);
    if (m && method === 'GET') return { s: 200, d: state.sources.filter(s => s.type === m[1]) };

    m = p.match(/^\/sources\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      const s = src(id);
      if (!s) return { s: 404, d: { error: 'Source not found' } };
      if (method === 'GET') return { s: 200, d: clone(s) };
      if (method === 'PUT') {
        Object.assign(s, { name: body?.name ?? s.name, url: body?.url ?? s.url, username: body?.username ?? s.username, password: body?.password || s.password, enabled: body?.enabled ?? s.enabled, updated_at: now() });
        mem.m3u.delete(String(s.id)); save(); return { s: 200, d: clone(s) };
      }
      if (method === 'DELETE') {
        state.sources = state.sources.filter(x => Number(x.id) !== id);
        state.hidden = state.hidden.filter(x => Number(x.source_id) !== id);
        state.favorites = state.favorites.filter(x => Number(x.source_id) !== id);
        mem.m3u.delete(String(id)); save(); return { s: 200, d: { success: true } };
      }
    }

    m = p.match(/^\/sources\/(\d+)\/(toggle|test|sync|estimate)$/);
    if (m) {
      const id = Number(m[1]);
      const action = m[2];
      const s = src(id);
      if (!s) return { s: 404, d: { error: 'Source not found' } };
      if (action === 'toggle' && method === 'POST') { s.enabled = !s.enabled; s.updated_at = now(); save(); return { s: 200, d: { enabled: s.enabled } }; }
      if (action === 'sync' && method === 'POST') {
        s.updated_at = now();
        const syncMs = nowMs();
        mem.sync.set(String(id), { status: 'success', last_sync: syncMs });
        if (s.type === 'm3u') mem.m3u.delete(String(id));
        if (s.type === 'epg' || s.type === 'xtream') {
          try { await epgForSource(s, { forceRefresh: true, maxAgeHours: 24 }); } catch {}
        }
        save();
        return { s: 200, d: { success: true } };
      }
      if (action === 'estimate' && method === 'GET') {
        if (s.type !== 'm3u') return { s: 200, d: { count: 0, needsWarning: false } };
        const r = await nativeFetch(s.url);
        if (!r.ok) return { s: 400, d: { error: `Estimate failed (${r.status})` } };
        const text = await r.text();
        const count = (text.match(/#EXTINF:/g) || []).length;
        return { s: 200, d: { count, needsWarning: count >= 5000 } };
      }
      if (action === 'test' && method === 'POST') {
        try {
          if (s.type === 'xtream') {
            const d = await fetchJson(xtreamUrl(s, null));
            return { s: 200, d: { success: !!d?.user_info, details: d } };
          }
          const r = await nativeFetch(s.url, { method: 'HEAD' });
          return { s: 200, d: { success: r.ok, status: r.status } };
        } catch (e) {
          return { s: 200, d: { success: false, error: e.message } };
        }
      }
    }

    if (p === '/favorites' && method === 'GET') {
      const sid = u.searchParams.get('sourceId');
      const type = u.searchParams.get('itemType');
      let list = [...state.favorites];
      if (sid) list = list.filter(f => Number(f.source_id) === Number(sid));
      if (type) list = list.filter(f => String(f.item_type) === String(type));
      return { s: 200, d: list };
    }
    if (p === '/favorites' && method === 'POST') {
      const candidate = { source_id: Number(body?.sourceId), item_id: String(body?.itemId), item_type: String(body?.itemType || 'channel') };
      const exists = state.favorites.find(f => Number(f.source_id) === candidate.source_id && String(f.item_id) === candidate.item_id && String(f.item_type) === candidate.item_type);
      if (!exists) state.favorites.push({ id: state.meta.fid++, ...candidate, created_at: now() });
      save(); return { s: 200, d: { success: true } };
    }
    if (p === '/favorites' && method === 'DELETE') {
      state.favorites = state.favorites.filter(f => !(Number(f.source_id) === Number(body?.sourceId) && String(f.item_id) === String(body?.itemId) && String(f.item_type) === String(body?.itemType || 'channel')));
      save(); return { s: 200, d: { success: true } };
    }
    if (p === '/favorites/check' && method === 'GET') {
      const hit = state.favorites.find(f => Number(f.source_id) === Number(u.searchParams.get('sourceId')) && String(f.item_id) === String(u.searchParams.get('itemId')) && String(f.item_type) === String(u.searchParams.get('itemType') || 'channel'));
      return { s: 200, d: { isFavorite: !!hit } };
    }

    if (p === '/channels/hidden/check' && method === 'GET') {
      const hit = state.hidden.find(h => Number(h.source_id) === Number(u.searchParams.get('sourceId')) && String(h.item_type) === String(u.searchParams.get('itemType')) && String(h.item_id) === String(u.searchParams.get('itemId')));
      return { s: 200, d: { hidden: !!hit } };
    }
    if (p === '/channels/hidden' && method === 'GET') {
      const sid = u.searchParams.get('sourceId');
      let list = [...state.hidden];
      if (sid) list = list.filter(h => Number(h.source_id) === Number(sid));
      return { s: 200, d: list };
    }
    if (p === '/channels/hide' && method === 'POST') {
      const key = `${Number(body?.sourceId)}:${String(body?.itemType)}:${String(body?.itemId)}`;
      if (!state.hidden.find(h => `${Number(h.source_id)}:${String(h.item_type)}:${String(h.item_id)}` === key)) state.hidden.push({ id: state.meta.hid++, source_id: Number(body?.sourceId), item_type: String(body?.itemType), item_id: String(body?.itemId), created_at: now() });
      save(); return { s: 200, d: { success: true } };
    }
    if (p === '/channels/show' && method === 'POST') {
      state.hidden = state.hidden.filter(h => !(Number(h.source_id) === Number(body?.sourceId) && String(h.item_type) === String(body?.itemType) && String(h.item_id) === String(body?.itemId)));
      save(); return { s: 200, d: { success: true } };
    }
    if (p === '/channels/hide/bulk' && method === 'POST') { (body?.items || []).forEach(it => route('POST', '/api/channels/hide', u, { sourceId: it.sourceId, itemType: it.itemType, itemId: it.itemId })); return { s: 200, d: { success: true } }; }
    if (p === '/channels/show/bulk' && method === 'POST') { (body?.items || []).forEach(it => route('POST', '/api/channels/show', u, { sourceId: it.sourceId, itemType: it.itemType, itemId: it.itemId })); return { s: 200, d: { success: true } }; }
    if ((p === '/channels/show/all' || p === '/channels/hide/all') && method === 'POST') return { s: 200, d: { success: true } };
    if (p === '/channels/recent' && method === 'GET') {
      const type = String(u.searchParams.get('type') || 'movie').toLowerCase();
      const limit = Math.max(1, Math.min(200, Number(u.searchParams.get('limit') || 24)));
      if (!['movie', 'series'].includes(type)) return { s: 200, d: [] };
      try {
        const items = await xtreamRecent(type, limit);
        return { s: 200, d: items };
      } catch (e) {
        return { s: 200, d: [] };
      }
    }

    if (p === '/history' && method === 'GET') {
      const limit = Number(u.searchParams.get('limit') || 50);
      const rows = [...state.history].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      return { s: 200, d: rows.slice(0, Math.max(limit, 1)) };
    }
    if (p === '/history' && method === 'POST') {
      const source_id = Number(body?.sourceId || body?.source_id || 0);
      const item_id = String(body?.itemId || body?.item_id || '');
      const item_type = String(body?.itemType || body?.item_type || body?.type || 'movie');
      const hit = state.history.find(h => Number(h.source_id) === source_id && String(h.item_id) === item_id && String(h.item_type) === item_type);
      const rec = {
        id: hit?.id || Date.now(), source_id, item_id, item_type,
        name: body?.name || body?.title || hit?.name || '',
        duration: Number(body?.duration || hit?.duration || 0),
        progress: Number(body?.progress || hit?.progress || 0),
        stream_icon: body?.poster || body?.stream_icon || hit?.stream_icon || '',
        container_extension: body?.containerExtension || body?.container_extension || hit?.container_extension || 'mp4',
        data: body?.data || hit?.data || { title: body?.title || body?.name || '', poster: body?.poster || '', sourceId: source_id },
        created_at: hit?.created_at || now(),
        updated_at: now()
      };
      if (hit) Object.assign(hit, rec); else state.history.push(rec);
      save(); return { s: 200, d: { success: true, id: rec.id } };
    }
    if (p === '/history' && method === 'DELETE') { state.history = []; save(); return { s: 200, d: { success: true } }; }

    if (p === '/metadata/enrich' && method === 'POST') {
      const type = String(body?.type || '').toLowerCase();
      if (!['movie', 'series'].includes(type)) return { s: 400, d: { error: 'type must be movie or series' } };
      const items = Array.isArray(body?.items) ? body.items : [];
      const out = {};
      items.slice(0, 120).forEach((item) => {
        const id = String(item?.id || '').trim();
        if (!id) return;
        const localRating = Number(item?.localRating || 0);
        const localVotes = Number(item?.localVotes || 0);
        const year = Number(item?.year || 0);
        const ratingNorm = Math.max(0, Math.min(1, (localRating <= 5 ? localRating * 2 : localRating) / 10));
        const votesNorm = Math.max(0, Math.min(1, Math.log10(Math.max(0, localVotes) + 1) / 6));
        const recencyNorm = year > 0 ? Math.max(0, Math.min(1, 1 - ((new Date().getUTCFullYear() - year) / 30))) : 0.3;
        const score = (ratingNorm * 0.5) + (votesNorm * 0.34) + (recencyNorm * 0.16);
        out[id] = {
          smart: {
            score,
            rating10: localRating,
            ratingPercent: Math.max(0, Math.min(100, Math.round(localRating * 10))),
            votes: localVotes,
            year,
            providers: { local: localRating > 0 || localVotes > 0, tmdb: false, omdb: false }
          },
          tmdb: null,
          omdb: null,
          merged: {}
        };
      });
      return { s: 200, d: { providerStatus: { tmdbEnabled: false, omdbEnabled: false }, items: out } };
    }

    if (p === '/proxy/cache' && method === 'DELETE') { mem.m3u.clear(); return { s: 200, d: { success: true } }; }
    m = p.match(/^\/proxy\/cache\/(\d+)$/); if (m && method === 'DELETE') { mem.m3u.delete(String(m[1])); return { s: 200, d: { success: true } }; }

    m = p.match(/^\/proxy\/xtream\/(\d+)\/stream\/([^/]+)\/([^/]+)$/);
    if (m && method === 'GET') {
      const source = src(Number(m[1]));
      if (!source) return { s: 404, d: { error: 'Source not found' } };
      const streamId = m[2], streamType = m[3], container = u.searchParams.get('container') || 'm3u8';
      if (source.type === 'm3u') { const parsed = await m3u(source); return { s: 200, d: { url: parsed.idMap.get(String(streamId)) || '' } }; }
      const folder = { live: 'live', movie: 'movie', series: 'series' }[streamType] || 'live';
      return { s: 200, d: { url: `${normBase(source.url)}/${folder}/${encodeURIComponent(source.username || '')}/${encodeURIComponent(source.password || '')}/${encodeURIComponent(streamId)}.${encodeURIComponent(container)}` } };
    }

    m = p.match(/^\/proxy\/xtream\/(\d+)\/([^/]+)$/);
    if (m && method === 'GET') {
      const source = src(Number(m[1]));
      if (!source) return { s: 404, d: { error: 'Source not found' } };
      const action = m[2];
      if (source.type === 'm3u') {
        const parsed = await m3u(source);
        if (action === 'live_categories') return { s: 200, d: parsed.categories };
        if (action === 'live_streams') { const c = u.searchParams.get('category_id'); return { s: 200, d: c ? parsed.streams.filter(x => String(x.category_id) === String(c)) : parsed.streams }; }
        if (['vod_categories', 'vod_streams', 'series_categories', 'series', 'short_epg'].includes(action)) return { s: 200, d: [] };
        if (action === 'auth') return { s: 200, d: { user_info: { username: 'm3u', status: 'Active' }, server_info: {} } };
        return { s: 404, d: { error: 'Unsupported for M3U source' } };
      }
      const map = {
        auth: [null, {}],
        live_categories: ['get_live_categories', {}],
        live_streams: ['get_live_streams', { category_id: u.searchParams.get('category_id') }],
        vod_categories: ['get_vod_categories', {}],
        vod_streams: ['get_vod_streams', { category_id: u.searchParams.get('category_id') }],
        vod_info: ['get_vod_info', { vod_id: u.searchParams.get('vod_id') }],
        series_categories: ['get_series_categories', {}],
        series: ['get_series', { category_id: u.searchParams.get('category_id') }],
        series_info: ['get_series_info', { series_id: u.searchParams.get('series_id') }],
        short_epg: ['get_short_epg', { stream_id: u.searchParams.get('stream_id'), limit: 12 }]
      };
      if (!map[action]) return { s: 404, d: { error: 'Unsupported Xtream action' } };
      try { return { s: 200, d: await fetchJson(xtreamUrl(source, map[action][0], map[action][1])) || [] }; }
      catch (e) { return { s: 502, d: { error: `Xtream request failed: ${e.message}` } }; }
    }

    m = p.match(/^\/proxy\/epg\/(\d+)$/);
    if (m && method === 'GET') {
      const source = src(Number(m[1]));
      if (!source) return { s: 404, d: { error: 'Source not found' } };
      const forceRefresh = u.searchParams.get('refresh') === '1' || u.searchParams.get('refresh') === 'true';
      const maxAge = Number(u.searchParams.get('maxAge') || 24);
      try {
        const epg = await epgForSource(source, { forceRefresh, maxAgeHours: maxAge });
        return { s: 200, d: epg };
      } catch (e) {
        return { s: 200, d: { channels: [], programmes: [] } };
      }
    }
    m = p.match(/^\/proxy\/epg\/(\d+)\/channels$/);
    if (m && method === 'POST') {
      const source = src(Number(m[1]));
      if (!source) return { s: 404, d: { error: 'Source not found' } };
      const ids = new Set((body?.channelIds || []).map(x => String(x)));
      try {
        const epg = await epgForSource(source, { forceRefresh: false, maxAgeHours: 24 });
        if (!ids.size) return { s: 200, d: epg };
        const channels = epg.channels.filter(ch => ids.has(String(ch.id)));
        const allowed = new Set(channels.map(ch => String(ch.id)));
        const programmes = epg.programmes.filter(pr => allowed.has(String(pr.channelId)));
        return { s: 200, d: { channels, programmes } };
      } catch (e) {
        return { s: 200, d: { channels: [], programmes: [] } };
      }
    }

    if (p === '/probe' && method === 'GET') {
      const target = u.searchParams.get('url') || '';
      const hls = /\.m3u8($|\?)/i.test(target) || /m3u8/i.test(target);
      const ts = /\.ts($|\?)/i.test(target) && !hls;
      return { s: 200, d: { url: target, compatible: true, looksLikeHls: hls, isRawTs: ts, video: 'h264', audio: 'aac', width: 0, height: 0, duration: 0, audioChannels: 2, subtitles: [] } };
    }

    if (p === '/transcode/session' && method === 'POST') return { s: 200, d: { sessionId: `static-${Date.now()}`, playlistUrl: body?.url || '' } };
    m = p.match(/^\/transcode\/([^/]+)$/); if (m && method === 'DELETE') return { s: 200, d: { success: true } };

    if (['/transcode', '/remux', '/proxy/stream', '/proxy/image', '/subtitle'].includes(p)) return { s: 200, d: { url: u.searchParams.get('url') || '' } };

    return { s: 404, d: { error: `Unsupported endpoint: ${p}` } };
  }

  function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async function handleApiFetch(input, init) {
    const reqUrl = typeof input === 'string' ? input : input.url;
    const u = new URL(reqUrl, window.location.origin);
    const method = (init?.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
    let raw = init?.body;
    if (!raw && typeof input !== 'string' && input.bodyUsed === false) { try { raw = await input.clone().text(); } catch { raw = null; } }
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
    try { const out = await route(method, u.pathname, u, body); return jsonResponse(out.s, out.d); }
    catch (e) { return jsonResponse(500, { error: e.message || 'Static API error' }); }
  }

  window.fetch = async function patchedFetch(input, init) {
    const reqUrl = typeof input === 'string' ? input : input.url;
    const isApi = reqUrl.startsWith('/api/') || reqUrl.startsWith(`${window.location.origin}/api/`);
    // Auth routes must reach the real server for proper Firebase token verification
    const isAuthApi = /\/api\/auth(\/|$)/.test(reqUrl);
    if (STATIC_MODE && isApi && !isAuthApi) return handleApiFetch(input, init);
    return nativeFetch(input, init);
  };

  const API = {
    isStaticMode: STATIC_MODE,
    resolveImageUrl: (url) => String(url || '').trim() || '/img/LurkedTV.png',
    resolveMediaUrl: (url) => String(url || '').trim(),
    async request(method, endpoint, data = null) {
      const options = { method, headers: { 'Content-Type': 'application/json' } };
      const token = localStorage.getItem('authToken');
      if (token) options.headers['Authorization'] = `Bearer ${token}`;
      if (data) options.body = JSON.stringify(data);
      const r = await fetch(`/api${endpoint}`, options);
      const isJson = (r.headers.get('content-type') || '').includes('application/json');
      const out = isJson ? await r.json() : { error: await r.text() };
      if (!r.ok) throw new Error(out.error || `Server responded with ${r.status}`);
      return out;
    }
  };

  API.sources = { getAll: () => API.request('GET', '/sources'), getByType: (t) => API.request('GET', `/sources/type/${t}`), getById: (id) => API.request('GET', `/sources/${id}`), create: (d) => API.request('POST', '/sources', d), update: (id, d) => API.request('PUT', `/sources/${id}`, d), delete: (id) => API.request('DELETE', `/sources/${id}`), toggle: (id) => API.request('POST', `/sources/${id}/toggle`), test: (id) => API.request('POST', `/sources/${id}/test`), sync: (id) => API.request('POST', `/sources/${id}/sync`), getStatus: () => API.request('GET', '/sources/status'), estimate: (id) => API.request('GET', `/sources/${id}/estimate`), estimateByUrl: (url, type) => API.request('POST', '/sources/estimate', { url, type }) };
  API.channels = { getHidden: (sourceId = null) => API.request('GET', `/channels/hidden${sourceId ? `?sourceId=${sourceId}` : ''}`), hide: (sourceId, itemType, itemId) => API.request('POST', '/channels/hide', { sourceId, itemType, itemId }), show: (sourceId, itemType, itemId) => API.request('POST', '/channels/show', { sourceId, itemType, itemId }), isHidden: (sourceId, itemType, itemId) => API.request('GET', `/channels/hidden/check?sourceId=${sourceId}&itemType=${itemType}&itemId=${itemId}`), bulkHide: (items) => API.request('POST', '/channels/hide/bulk', { items }), bulkShow: (items) => API.request('POST', '/channels/show/bulk', { items }), showAll: (sourceId, contentType) => API.request('POST', '/channels/show/all', { sourceId, contentType }), hideAll: (sourceId, contentType) => API.request('POST', '/channels/hide/all', { sourceId, contentType }) };
  API.favorites = { getAll: (sourceId = null, itemType = null) => { let url = '/favorites'; const p = []; if (sourceId) p.push(`sourceId=${sourceId}`); if (itemType) p.push(`itemType=${itemType}`); if (p.length) url += '?' + p.join('&'); return API.request('GET', url); }, add: (sourceId, itemId, itemType = 'channel') => API.request('POST', '/favorites', { sourceId, itemId, itemType }), remove: (sourceId, itemId, itemType = 'channel') => API.request('DELETE', '/favorites', { sourceId, itemId, itemType }), check: (sourceId, itemId, itemType = 'channel') => API.request('GET', `/favorites/check?sourceId=${sourceId}&itemId=${itemId}&itemType=${itemType}`) };
  API.proxy = { xtream: { auth: (id) => API.request('GET', `/proxy/xtream/${id}/auth`), liveCategories: (id, o = {}) => API.request('GET', `/proxy/xtream/${id}/live_categories${o.includeHidden ? '?includeHidden=true' : ''}`), liveStreams: (id, cid = null, o = {}) => { const p = []; if (cid) p.push(`category_id=${cid}`); if (o.includeHidden) p.push('includeHidden=true'); return API.request('GET', `/proxy/xtream/${id}/live_streams${p.length ? `?${p.join('&')}` : ''}`); }, vodCategories: (id, o = {}) => API.request('GET', `/proxy/xtream/${id}/vod_categories${o.includeHidden ? '?includeHidden=true' : ''}`), vodStreams: (id, cid = null, o = {}) => { const p = []; if (cid) p.push(`category_id=${cid}`); if (o.includeHidden) p.push('includeHidden=true'); return API.request('GET', `/proxy/xtream/${id}/vod_streams${p.length ? `?${p.join('&')}` : ''}`); }, vodInfo: (id, vodId) => API.request('GET', `/proxy/xtream/${id}/vod_info?vod_id=${vodId}`), seriesCategories: (id, o = {}) => API.request('GET', `/proxy/xtream/${id}/series_categories${o.includeHidden ? '?includeHidden=true' : ''}`), series: (id, cid = null, o = {}) => { const p = []; if (cid) p.push(`category_id=${cid}`); if (o.includeHidden) p.push('includeHidden=true'); return API.request('GET', `/proxy/xtream/${id}/series${p.length ? `?${p.join('&')}` : ''}`); }, seriesInfo: (id, sid) => API.request('GET', `/proxy/xtream/${id}/series_info?series_id=${sid}`), shortEpg: (id, sid) => API.request('GET', `/proxy/xtream/${id}/short_epg?stream_id=${sid}`), getStreamUrl: (id, sid, type = 'live', c = 'm3u8') => API.request('GET', `/proxy/xtream/${id}/stream/${sid}/${type}?container=${c}`) }, epg: { get: (id) => API.request('GET', `/proxy/epg/${id}`), getForChannels: (id, channelIds) => API.request('POST', `/proxy/epg/${id}/channels`, { channelIds }) }, cache: { clear: (id) => API.request('DELETE', `/proxy/cache/${id}`) } };
  API.metadata = { enrichBatch: (type, items) => API.request('POST', '/metadata/enrich', { type, items }) };
  API.settings = { get: () => API.request('GET', '/settings'), update: (d) => API.request('PUT', '/settings', d), reset: () => API.request('DELETE', '/settings'), getDefaults: () => API.request('GET', '/settings/defaults'), getSyncStatus: () => API.request('GET', '/settings/sync-status'), syncFirebaseCache: () => API.request('POST', '/settings/firebase-cache/sync'), applyAutoProfile: (d = {}) => API.request('POST', '/settings/auto-profile/apply', d), getDiscordBotStatus: () => API.request('GET', '/settings/discord-bot/status'), updateDiscordBotConfig: (d) => API.request('PUT', '/settings/discord-bot/config', d) };
  API.users = { getAll: () => API.request('GET', '/auth/users'), create: (d) => API.request('POST', '/auth/users', d), update: (id, d) => API.request('PUT', `/auth/users/${id}`, d), delete: (id) => API.request('DELETE', `/auth/users/${id}`) };
  API.account = { getMe: () => API.request('GET', '/auth/me'), updatePreferences: (d) => API.request('PATCH', '/auth/me/preferences', d), changeUsername: (d) => API.request('POST', '/auth/me/change-username', d), changePassword: (d) => API.request('POST', '/auth/me/change-password', d), startDiscordLink: () => API.request('POST', '/auth/discord/link/start'), unlinkDiscord: () => API.request('DELETE', '/auth/discord/link'), getDiscordAdminStatus: () => API.request('GET', '/auth/discord/admin-status') };

  window.API = API;
})();
