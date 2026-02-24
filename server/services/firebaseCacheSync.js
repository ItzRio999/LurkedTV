const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/sqlite');
const { sources } = require('../db');

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_TYPES = ['live', 'movie', 'series'];

class FirebaseCacheSyncService {
    constructor() {
        this.firestore = null;
        this.initialized = false;
        this.enabled = false;
        this.lastSyncTime = null;
        this.lastError = null;
        this._syncing = false;
        this._timer = null;
        this._nextSyncTime = null;
    }

    init() {
        if (this.initialized) return this.enabled;
        this.initialized = true;

        const creds = this.resolveCredentials();
        const projectId = creds.projectId || process.env.FIREBASE_PROJECT_ID || 'lurkedtv-b8047';
        const clientEmail = creds.clientEmail;
        const privateKeyRaw = creds.privateKey;

        if (!clientEmail || !privateKeyRaw) {
            this.lastError = 'Set FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT_PATH';
            console.warn('[FirebaseCache] Disabled:', this.lastError);
            this.enabled = false;
            return false;
        }

        try {
            const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
            const app = admin.apps.length
                ? admin.app()
                : admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId,
                        clientEmail,
                        privateKey
                    })
                });

            this.firestore = app.firestore();
            this.enabled = true;
            console.log('[FirebaseCache] Firestore initialized');
            return true;
        } catch (err) {
            this.lastError = err.message;
            this.enabled = false;
            console.error('[FirebaseCache] Initialization failed:', err.message);
            return false;
        }
    }

    resolveCredentials() {
        const envClientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
        const envPrivateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').trim();
        const envProjectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();

        if (envClientEmail && envPrivateKey) {
            return {
                projectId: envProjectId,
                clientEmail: envClientEmail,
                privateKey: envPrivateKey
            };
        }

        const configuredPath = String(
            process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
            process.env.GOOGLE_APPLICATION_CREDENTIALS ||
            ''
        ).trim();

        const candidates = [];
        if (configuredPath) {
            candidates.push(path.resolve(configuredPath));
        }

        const repoRoot = path.resolve(__dirname, '..', '..');
        try {
            const files = fs.readdirSync(repoRoot);
            const match = files.find(name => /firebase-adminsdk.*\.json$/i.test(name));
            if (match) candidates.push(path.join(repoRoot, match));
        } catch (_) {
            // Ignore filesystem discovery errors and fall through.
        }

        for (const candidate of candidates) {
            try {
                if (!fs.existsSync(candidate)) continue;
                const raw = fs.readFileSync(candidate, 'utf8');
                const parsed = JSON.parse(raw);
                const projectId = String(parsed?.project_id || envProjectId || '').trim();
                const clientEmail = String(parsed?.client_email || '').trim();
                const privateKey = String(parsed?.private_key || '').trim();
                if (clientEmail && privateKey) {
                    console.log(`[FirebaseCache] Using service account file: ${candidate}`);
                    return { projectId, clientEmail, privateKey };
                }
            } catch (err) {
                this.lastError = `Invalid service account file (${candidate}): ${err.message}`;
            }
        }

        return {
            projectId: envProjectId,
            clientEmail: envClientEmail,
            privateKey: envPrivateKey
        };
    }

    startTimer() {
        if (!this.init()) return;

        if (this._timer) {
            clearInterval(this._timer);
        }

        this._nextSyncTime = new Date(Date.now() + SYNC_INTERVAL_MS);
        console.log(`[FirebaseCache] Auto-sync every 24h. Next sync: ${this._nextSyncTime.toISOString()}`);

        this._timer = setInterval(() => {
            this.syncNow('scheduled').catch(err => {
                console.error('[FirebaseCache] Scheduled sync failed:', err.message);
            });
        }, SYNC_INTERVAL_MS);
    }

    getStatus() {
        return {
            enabled: this.enabled,
            syncing: this._syncing,
            lastSyncTime: this.lastSyncTime ? this.lastSyncTime.toISOString() : null,
            nextSyncTime: this._nextSyncTime ? this._nextSyncTime.toISOString() : null,
            lastError: this.lastError
        };
    }

    async syncNow(trigger = 'manual') {
        if (!this.enabled) {
            throw new Error('Firebase cache sync is not configured');
        }

        if (this._syncing) {
            return { started: false, message: 'Sync already in progress' };
        }

        this._syncing = true;
        this.lastError = null;

        try {
            const db = getDb();
            const rows = db.prepare(`
                SELECT id, source_id, item_id, type, name, category_id, stream_icon, container_extension,
                       rating, year, added_at
                FROM playlist_items
                WHERE type IN ('live', 'movie', 'series')
                ORDER BY source_id, type, item_id
            `).all();

            const sourceList = await sources.getAll();
            const sourceMap = new Map(sourceList.map(s => [String(s.id), s.name]));

            const grouped = {
                live: [],
                movie: [],
                series: []
            };

            for (const row of rows) {
                const doc = {
                    id: row.id,
                    sourceId: row.source_id,
                    sourceName: sourceMap.get(String(row.source_id)) || `Source ${row.source_id}`,
                    itemId: row.item_id,
                    type: row.type,
                    name: row.name,
                    categoryId: row.category_id,
                    streamIcon: row.stream_icon || null,
                    containerExtension: row.container_extension || null,
                    rating: row.rating ?? null,
                    year: row.year ?? null,
                    addedAt: row.added_at || null,
                    syncedAt: new Date().toISOString()
                };

                grouped[row.type].push(doc);
            }

            await this.writeSnapshot(grouped, trigger);

            this.lastSyncTime = new Date();
            this._nextSyncTime = new Date(Date.now() + SYNC_INTERVAL_MS);

            const summary = {
                started: true,
                trigger,
                counts: {
                    live: grouped.live.length,
                    movie: grouped.movie.length,
                    series: grouped.series.length
                },
                syncedAt: this.lastSyncTime.toISOString()
            };

            console.log('[FirebaseCache] Sync complete:', summary);
            return summary;
        } catch (err) {
            this.lastError = err.message;
            throw err;
        } finally {
            this._syncing = false;
        }
    }

    async writeSnapshot(grouped, trigger) {
        const root = this.firestore.collection('nodecast_cache');

        for (const type of SUPPORTED_TYPES) {
            await this.replaceTypeCollection(root.doc('media').collection(type), grouped[type]);
        }

        await root.doc('meta').set({
            trigger,
            syncedAt: new Date().toISOString(),
            counts: {
                live: grouped.live.length,
                movie: grouped.movie.length,
                series: grouped.series.length
            }
        });
    }

    async replaceTypeCollection(collectionRef, docs) {
        const BATCH_LIMIT = 400;

        while (true) {
            const snapshot = await collectionRef.limit(BATCH_LIMIT).get();
            if (snapshot.empty) break;

            const batch = this.firestore.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
            const chunk = docs.slice(i, i + BATCH_LIMIT);
            const batch = this.firestore.batch();
            chunk.forEach(doc => {
                batch.set(collectionRef.doc(String(doc.id)), doc);
            });
            await batch.commit();
        }
    }
}

module.exports = new FirebaseCacheSyncService();
