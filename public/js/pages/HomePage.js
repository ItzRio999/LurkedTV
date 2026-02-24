/**
 * Home Dashboard Page
 * Features "Continue Watching" and "Recently Added" content
 */
class HomePage {
    constructor(app) {
        this.app = app;
        this.container = null; // Will be set in renderLayout
        this.isLoading = false;
        this.clockInterval = null;
        this.use24HourClock = localStorage.getItem('homeClockUse24Hour') === 'true';
        this.clockTiltCleanup = null;
    }

    async init() {
        // Initialization if needed
    }

    async show() {
        this.renderLayout();
        this.initWelcomeClock();
        await Promise.allSettled([
            this.loadWelcomeSourceMeta(),
            this.loadDashboardData()
        ]);
    }

    hide() {
        // Cleanup if needed
        this.stopWelcomeClock();
        this.teardownClockTilt();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    renderLayout() {
        const pageHome = document.getElementById('page-home');
        if (!pageHome) return;

        pageHome.innerHTML = `
            <div class="dashboard-content" id="home-content">
                <section class="dashboard-welcome" id="dashboard-welcome">
                    <div class="dashboard-welcome-copy">
                        <p class="dashboard-welcome-kicker">Welcome back <span class="dashboard-version-tag">V5</span></p>
                        <h1 class="dashboard-welcome-title" id="home-welcome-message">Welcome to LurkedTV</h1>
                        <p class="dashboard-welcome-subtitle">Your stream lineup is ready.</p>
                        <div class="dashboard-welcome-meta" id="dashboard-welcome-meta">
                            <div class="dashboard-meta-item">
                                <span class="dashboard-meta-label">Playlist</span>
                                <span class="dashboard-meta-value" id="home-meta-playlist">Loading...</span>
                            </div>
                            <div class="dashboard-meta-item">
                                <span class="dashboard-meta-label">Expiry</span>
                                <span class="dashboard-meta-value" id="home-meta-expiry">Loading...</span>
                            </div>
                            <div class="dashboard-meta-item">
                                <span class="dashboard-meta-label">EPG Updated</span>
                                <span class="dashboard-meta-value" id="home-meta-epg-sync">Loading...</span>
                            </div>
                        </div>
                    </div>
                    <div class="dashboard-clock idle" data-home-clock-tilt aria-live="polite">
                        <div class="dashboard-clock-glare" aria-hidden="true"></div>
                        <div class="dashboard-clock-shine" aria-hidden="true"></div>
                        <div class="dashboard-clock-deco dashboard-clock-deco-1" data-clock-layer="4" aria-hidden="true"></div>
                        <div class="dashboard-clock-deco dashboard-clock-deco-2" data-clock-layer="2" aria-hidden="true"></div>
                        <div class="dashboard-clock-inner">
                            <div class="dashboard-clock-time" id="home-clock-time" data-clock-layer="16">--:--:--</div>
                            <div class="dashboard-clock-date" id="home-clock-date" data-clock-layer="10">Loading date...</div>
                            <button type="button" class="dashboard-clock-toggle" id="home-clock-toggle" data-clock-layer="6">
                                24-hour
                            </button>
                        </div>
                    </div>
                </section>

                <section class="dashboard-section" id="favorite-channels-section">
                    <div class="section-header">
                        <h2>Favorite Channels</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll channel-tiles" id="favorite-channels-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading favorites...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>

                <section class="dashboard-section" id="continue-watching-section">
                    <div class="section-header">
                        <h2>Continue Watching</h2>
                        <button type="button" class="continue-clear-btn" id="continue-watching-clear-btn">Clear</button>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll" id="continue-watching-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading history...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>

                <section class="dashboard-section">
                    <div class="section-header">
                        <h2>Recently Added Movies</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll" id="recent-movies-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading recently added...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>

                <section class="dashboard-section">
                    <div class="section-header">
                        <h2>Recently Added Series</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll" id="recent-series-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading recently added...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>
            </div>
        `;
        this.container = document.getElementById('home-content');

        // Attach scroll arrow handlers
        this.initScrollArrows();
        this.bindContinueWatchingActions();
        this.initClockTilt();
    }

    initClockTilt() {
        this.teardownClockTilt();

        const clockCard = document.querySelector('[data-home-clock-tilt]');
        if (!clockCard) return;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const glare  = clockCard.querySelector('.dashboard-clock-glare');
        const shine  = clockCard.querySelector('.dashboard-clock-shine');
        const layers = Array.from(clockCard.querySelectorAll('[data-clock-layer]'));

        // ── Tuning ──
        const MAX_TILT    = 22;    // max degrees of tilt across full viewport
        const LAYER_DEPTH = 0.9;   // px-per-unit parallax multiplier
        const GLARE_RANGE = 36;    // % movement for glare spotlight
        const LERP_SPEED  = 5.5;   // exponential smoothing speed (higher = snappier)

        // Normalised mouse coords (-1…+1), 0,0 = viewport centre
        let targetNx = 0, targetNy = 0;
        let curNx    = 0, curNy    = 0;
        let mouseInDoc = false;
        let idlePhase  = 0;
        let lastTs     = 0;
        let rafId      = 0;

        const lerp = (a, b, t) => a + (b - a) * t;

        // ── Single unified animation loop ──
        const frame = (ts) => {
            rafId = requestAnimationFrame(frame);

            const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0.016;
            lastTs = ts;

            // Exponential lerp — frame-rate independent
            const lf = 1 - Math.exp(-LERP_SPEED * dt);
            curNx = lerp(curNx, targetNx, lf);
            curNy = lerp(curNy, targetNy, lf);

            let rotX, rotY, scale;

            if (!mouseInDoc) {
                // ── Idle: gentle Lissajous float with lerp returning to centre ──
                idlePhase += dt;
                const oscX = Math.sin(idlePhase * 0.55) * 2.0;
                const oscY = Math.sin(idlePhase * 0.38 + 1.1) * 3.0;
                const bob  = Math.sin(idlePhase * 0.46) * 5;

                // Blend from lerp-residual into idle as we approach centre
                const dist  = Math.sqrt(curNx * curNx + curNy * curNy);
                const blend = Math.min(dist / 0.08, 1);

                rotX = lerp(oscX, -curNy * MAX_TILT, blend);
                rotY = lerp(oscY,  curNx * MAX_TILT, blend);
                scale = 1;

                clockCard.style.transform = `perspective(1100px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(${lerp(bob, 0, blend)}px)`;
                clockCard.style.boxShadow = '';
            } else {
                // ── Active: follow global mouse ──
                idlePhase = 0;
                rotX  = -curNy * MAX_TILT;
                rotY  =  curNx * MAX_TILT;
                scale = 1 + Math.sqrt(curNx * curNx + curNy * curNy) * 0.018;

                clockCard.style.transform = `perspective(1100px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale.toFixed(4)})`;

                // Shadow shifts opposite the tilt for real depth illusion
                const shX  = rotY * 2.2;
                const shY  = -rotX * 2.2;
                const mag  = Math.sqrt(curNx * curNx + curNy * curNy);
                const opa  = (0.28 + mag * 0.32).toFixed(3);
                const pOpa = (0.06 + mag * 0.14).toFixed(3);
                clockCard.style.boxShadow = [
                    `${shX}px ${shY}px 44px rgba(0,0,0,${opa})`,
                    `${shX * 0.35}px ${shY * 0.35}px 14px rgba(124,58,237,${pOpa})`,
                    `inset 0 1px 0 rgba(255,255,255,0.07)`
                ].join(', ');
            }

            // ── Layer parallax — each element at its own depth ──
            for (const layer of layers) {
                const depth = Number(layer.dataset.clockLayer) || 0;
                layer.style.transform = `translate3d(${curNx * -depth * LAYER_DEPTH}px, ${curNy * -depth * LAYER_DEPTH}px, 0)`;
            }

            // ── Glare spotlight follows cursor ──
            if (glare) {
                const gx  = curNx * GLARE_RANGE;
                const gy  = curNy * GLARE_RANGE;
                const mag = Math.sqrt(curNx * curNx + curNy * curNy);
                const go  = mouseInDoc
                    ? (0.12 + mag * 0.38).toFixed(3)
                    : (0.08 + Math.abs(Math.sin(idlePhase * 0.28)) * 0.10).toFixed(3);
                glare.style.transform = `translate(calc(-50% + ${gx}%), calc(-50% + ${gy}%))`;
                glare.style.opacity   = String(Math.min(Number(go), 0.55));
            }

            // ── Edge-shine highlight shifts with tilt ──
            if (shine) {
                const shineX = 50 + curNx * 25;
                shine.style.background = `linear-gradient(90deg, transparent, rgba(255,255,255,${(0.18 + Math.abs(curNx) * 0.22).toFixed(3)}) ${shineX}%, transparent)`;
            }
        };

        // ── Global mouse tracking across the entire viewport ──
        const onMouseMove = (e) => {
            targetNx = (e.clientX / window.innerWidth)  * 2 - 1;
            targetNy = (e.clientY / window.innerHeight) * 2 - 1;
            if (!mouseInDoc) {
                mouseInDoc = true;
                clockCard.classList.add('active');
                clockCard.classList.remove('idle');
            }
        };

        const onMouseLeave = () => {
            mouseInDoc = false;
            targetNx   = 0;
            targetNy   = 0;
            clockCard.classList.remove('active');
            clockCard.classList.add('idle');
        };

        // Attach global listeners
        // mousemove on document, mouseleave on documentElement (fires when cursor exits viewport)
        document.addEventListener('mousemove',              onMouseMove,  { passive: true });
        document.documentElement.addEventListener('mouseleave', onMouseLeave);
        window.addEventListener('blur',                     onMouseLeave);

        // Kick off the loop
        clockCard.classList.add('idle');
        rafId = requestAnimationFrame(frame);

        // ── Cleanup ──
        this.clockTiltCleanup = () => {
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            document.removeEventListener('mousemove',              onMouseMove);
            document.documentElement.removeEventListener('mouseleave', onMouseLeave);
            window.removeEventListener('blur',                     onMouseLeave);
            clockCard.classList.remove('active', 'idle');
            clockCard.style.transform  = '';
            clockCard.style.boxShadow  = '';
            if (glare) { glare.style.transform = ''; glare.style.opacity = ''; }
            if (shine) { shine.style.background = ''; }
            for (const layer of layers) layer.style.transform = '';
        };
    }

    teardownClockTilt() {
        if (!this.clockTiltCleanup) return;
        this.clockTiltCleanup();
        this.clockTiltCleanup = null;
    }

    bindContinueWatchingActions() {
        const clearBtn = document.getElementById('continue-watching-clear-btn');
        if (!clearBtn) return;

        clearBtn.addEventListener('click', async () => {
            const confirmed = window.confirm('Clear all items from Continue Watching?');
            if (!confirmed) return;

            const list = document.getElementById('continue-watching-list');
            const section = document.getElementById('continue-watching-section');
            clearBtn.disabled = true;

            try {
                await window.API.request('DELETE', '/history');
                if (list) {
                    list.innerHTML = '<div class="empty-state hint">No items in Continue Watching</div>';
                }
                section?.classList.add('hidden');
            } catch (err) {
                console.error('[Dashboard] Error clearing history:', err);
            } finally {
                clearBtn.disabled = false;
            }
        });
    }

    initWelcomeClock() {
        const messageEl = document.getElementById('home-welcome-message');
        const toggleEl = document.getElementById('home-clock-toggle');

        if (messageEl) {
            const username = this.app?.currentUser?.username;
            messageEl.textContent = username ? `Welcome back, ${username}` : 'Welcome to LurkedTV';
        }

        if (toggleEl) {
            toggleEl.textContent = this.use24HourClock ? '12-hour' : '24-hour';
            toggleEl.addEventListener('click', () => {
                this.use24HourClock = !this.use24HourClock;
                localStorage.setItem('homeClockUse24Hour', this.use24HourClock ? 'true' : 'false');
                toggleEl.textContent = this.use24HourClock ? '12-hour' : '24-hour';
                this.updateWelcomeClock();
            });
        }

        this.startWelcomeClock();
    }

    startWelcomeClock() {
        this.stopWelcomeClock();
        this.updateWelcomeClock();
        this.clockInterval = setInterval(() => this.updateWelcomeClock(), 1000);
    }

    stopWelcomeClock() {
        if (!this.clockInterval) return;
        clearInterval(this.clockInterval);
        this.clockInterval = null;
    }

    updateWelcomeClock() {
        const timeEl = document.getElementById('home-clock-time');
        const dateEl = document.getElementById('home-clock-date');
        if (!timeEl || !dateEl) return;

        const now = new Date();
        const timeFormatter = new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: !this.use24HourClock
        });
        const dateFormatter = new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        timeEl.textContent = timeFormatter.format(now);
        dateEl.textContent = dateFormatter.format(now);
    }

    getHomePrimarySource(sources) {
        const selectedValue = this.app?.channelList?.sourceSelect?.value || '';
        if (selectedValue.includes(':')) {
            const [selectedType, selectedId] = selectedValue.split(':');
            const selectedSource = sources.find(source =>
                String(source.id) === String(selectedId) && source.type === selectedType
            );
            if (selectedSource) return selectedSource;
        }

        return sources.find(source => source.type === 'xtream') || sources[0] || null;
    }

    formatDashboardDateTime(timestampMs) {
        const ts = Number(timestampMs);
        if (!Number.isFinite(ts) || ts <= 0) return 'Unknown';
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return 'Unknown';

        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    formatXtreamExpiry(expDateSecondsRaw) {
        const expDateSeconds = Number(expDateSecondsRaw);
        if (!Number.isFinite(expDateSeconds) || expDateSeconds <= 0) {
            return 'No expiry data';
        }

        const expiryMs = expDateSeconds * 1000;
        const expiryText = this.formatDashboardDateTime(expiryMs);
        const now = Date.now();

        if (expiryMs <= now) {
            return `Expired (${expiryText})`;
        }

        const daysLeft = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
        if (daysLeft <= 1) {
            return `${expiryText} (today)`;
        }

        return `${expiryText} (${daysLeft}d left)`;
    }

    getLastEpgSyncTimestamp(primarySource, allSources, statuses) {
        const statusRows = Array.isArray(statuses) ? statuses : [];
        const sourceStatuses = statusRows.filter(status =>
            String(status.source_id) === String(primarySource.id)
        );
        const sourceLastSync = sourceStatuses
            .map(status => Number(status.last_sync))
            .filter(Number.isFinite)
            .sort((a, b) => b - a)[0] || null;

        if (primarySource.type === 'xtream' && sourceLastSync) {
            return sourceLastSync;
        }

        const epgSourceIds = new Set(
            (allSources || [])
                .filter(source => source.enabled && source.type === 'epg')
                .map(source => String(source.id))
        );

        const epgLastSync = statusRows
            .filter(status => epgSourceIds.has(String(status.source_id)))
            .map(status => Number(status.last_sync))
            .filter(Number.isFinite)
            .sort((a, b) => b - a)[0] || null;

        return sourceLastSync || epgLastSync || null;
    }

    async loadWelcomeSourceMeta() {
        const playlistEl = document.getElementById('home-meta-playlist');
        const expiryEl = document.getElementById('home-meta-expiry');
        const epgSyncEl = document.getElementById('home-meta-epg-sync');
        if (!playlistEl || !expiryEl || !epgSyncEl) return;

        try {
            const [allSources, statuses] = await Promise.all([
                window.API.sources.getAll(),
                window.API.sources.getStatus().catch(() => [])
            ]);

            const enabledPlaylists = (allSources || []).filter(source =>
                source.enabled && (source.type === 'xtream' || source.type === 'm3u')
            );

            if (!enabledPlaylists.length) {
                playlistEl.textContent = 'No active playlist';
                expiryEl.textContent = 'N/A';
                epgSyncEl.textContent = 'Not synced yet';
                return;
            }

            const primarySource = this.getHomePrimarySource(enabledPlaylists);
            playlistEl.textContent = primarySource?.name || 'Unknown playlist';

            if (primarySource?.type === 'xtream') {
                try {
                    const authData = await window.API.proxy.xtream.auth(primarySource.id);
                    expiryEl.textContent = this.formatXtreamExpiry(authData?.user_info?.exp_date);
                } catch (err) {
                    console.warn('[Dashboard] Could not fetch Xtream expiry data:', err);
                    expiryEl.textContent = 'Unavailable';
                }
            } else {
                expiryEl.textContent = 'N/A (M3U)';
            }

            const epgSyncTimestamp = this.getLastEpgSyncTimestamp(primarySource, allSources, statuses);
            epgSyncEl.textContent = epgSyncTimestamp
                ? this.formatDashboardDateTime(epgSyncTimestamp)
                : 'Not synced yet';
        } catch (err) {
            console.error('[Dashboard] Error loading welcome source metadata:', err);
            playlistEl.textContent = 'Unavailable';
            expiryEl.textContent = 'Unavailable';
            epgSyncEl.textContent = 'Unavailable';
        }
    }

    initScrollArrows() {
        this.container.querySelectorAll('.scroll-wrapper').forEach(wrapper => {
            const scrollContainer = wrapper.querySelector('.horizontal-scroll');
            const leftBtn = wrapper.querySelector('.scroll-left');
            const rightBtn = wrapper.querySelector('.scroll-right');

            if (!scrollContainer || !leftBtn || !rightBtn) return;

            const scrollAmount = 300; // pixels to scroll per click

            leftBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
            });

            rightBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            });

            // Update arrow visibility based on scroll position
            const updateArrows = () => {
                const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
                leftBtn.classList.toggle('hidden', scrollLeft <= 0);
                rightBtn.classList.toggle('hidden', scrollLeft + clientWidth >= scrollWidth - 5);
            };

            // Store reference for later updates
            wrapper._updateArrows = updateArrows;

            scrollContainer.addEventListener('scroll', updateArrows);
            // Initial check after content loads
            setTimeout(updateArrows, 100);
        });
    }

    /**
     * Re-check scroll arrow visibility for all sections
     * Call this after dynamically loading content
     */
    updateScrollArrows() {
        this.container?.querySelectorAll('.scroll-wrapper').forEach(wrapper => {
            if (wrapper._updateArrows) {
                wrapper._updateArrows();
            }
        });
    }


    async loadDashboardData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            // Load dashboard sections in parallel to reduce total page wait time.
            await Promise.allSettled([
                this.renderFavoriteChannels(),
                this.loadAndRenderHistory(),
                this.renderRecentMovies(),
                this.renderRecentSeries()
            ]);

        } catch (err) {
            console.error('[Dashboard] Error loading data:', err);
        } finally {
            this.isLoading = false;
        }
    }

    async loadAndRenderHistory() {
        try {
            const history = await window.API.request('GET', '/history?limit=12');
            if (history && Array.isArray(history)) {
                this.renderHistory(history);
            }
        } catch (err) {
            console.error('[Dashboard] Error loading history:', err);
        }
    }

    async renderFavoriteChannels() {
        const list = document.getElementById('favorite-channels-list');
        const section = document.getElementById('favorite-channels-section');
        if (!list || !section) return;

        try {
            // Fetch favorite channels for current user
            const favorites = await window.API.request('GET', '/favorites?itemType=channel');

            if (!favorites || favorites.length === 0) {
                list.innerHTML = '<div class="empty-state hint">Add channels to favorites from Live TV</div>';
                return;
            }

            // De-duplicate favorites to prevent repeated tiles.
            const uniqueFavorites = [];
            const seenFavoriteKeys = new Set();
            for (const fav of favorites) {
                const key = `${fav.source_id}:${fav.item_id}`;
                if (seenFavoriteKeys.has(key)) continue;
                seenFavoriteKeys.add(key);
                uniqueFavorites.push(fav);
            }

            // Ensure channel list is loaded to resolve channel details
            const channelList = this.app.channelList;
            if (!channelList.channels || channelList.channels.length === 0) {
                await channelList.loadSources();
                await channelList.loadChannels();
            }

            // Match favorites to channel data
            const channels = [];
            for (const fav of uniqueFavorites) {
                // Find channel in loaded channel list
                const channel = channelList.channels.find(ch =>
                    String(ch.sourceId) === String(fav.source_id) &&
                    (String(ch.id) === String(fav.item_id) || String(ch.streamId) === String(fav.item_id))
                );
                if (channel) {
                    channels.push({ ...channel, favoriteId: fav.id });
                }
            }

            if (channels.length === 0) {
                list.innerHTML = '<div class="empty-state hint">Add channels to favorites from Live TV</div>';
                return;
            }

            // Render channel tiles
            list.innerHTML = channels.map(ch => this.createChannelTile(ch)).join('');

            // Attach click handlers
            list.querySelectorAll('.channel-tile').forEach(tile => {
                tile.addEventListener('click', () => {
                    const channelId = tile.dataset.channelId;
                    const sourceId = tile.dataset.sourceId;
                    this.playChannel(channelId, sourceId);
                });
            });

            // Update scroll arrows after content renders
            this.updateScrollArrows();

        } catch (err) {
            console.error('[Dashboard] Error loading favorite channels:', err);
            list.innerHTML = '<div class="empty-state hint">Error loading favorites</div>';
        }
    }

    createChannelTile(channel) {
        const logo = channel.tvgLogo || '/img/LurkedTV.png';
        const logoUrl = logo.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(logo)}` : logo;
        const name = channel.name || 'Unknown';

        return `
            <div class="channel-tile" data-channel-id="${channel.id}" data-source-id="${channel.sourceId}">
                <div class="tile-logo">
                    <img src="${logoUrl}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                </div>
                <div class="tile-name" title="${name}">${name}</div>
            </div>
        `;
    }

    playChannel(channelId, sourceId) {
        // Navigate to Live TV and select the channel
        this.app.navigateTo('live');

        // Small delay to ensure page is ready
        setTimeout(() => {
            const channelList = this.app.channelList;
            if (channelList) {
                // Find and select the channel
                const channel = channelList.channels.find(ch =>
                    String(ch.id) === String(channelId) && String(ch.sourceId) === String(sourceId)
                );
                if (channel) {
                    channelList.selectChannel({
                        channelId: channel.id,
                        sourceId: channel.sourceId,
                        sourceType: channel.sourceType,
                        streamId: channel.streamId || '',
                        url: channel.url || ''
                    });
                }
            }
        }, 100);
    }

    renderHistory(items) {
        const list = document.getElementById('continue-watching-list');
        const section = document.getElementById('continue-watching-section');

        if (!list || !section) return;

        const dedupedItems = this.dedupeHistoryItems(items || []);
        const activeItems = dedupedItems.filter(item => {
            const normalized = this.normalizeHistoryTiming(item);
            const progress = Number(normalized.progress || 0);
            const duration = Number(normalized.duration || 0);
            if (!Number.isFinite(duration) || duration <= 0) return false;
            if (!Number.isFinite(progress) || progress <= 0) return false;
            const remaining = duration - progress;
            const percent = progress / duration;
            return remaining > 15 && percent < 0.98;
        });

        if (activeItems.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        list.innerHTML = activeItems.map(item => this.createCard(item)).join('');

        // Attach click listeners
        list.querySelectorAll('.dashboard-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const sourceId = card.dataset.sourceId;
                const type = card.dataset.type;
                const item = activeItems.find(i =>
                    String(i.item_id) === String(id) &&
                    String(i.source_id || i?.data?.sourceId || '') === String(sourceId || '') &&
                    String(i.item_type || i.type || '') === String(type || '')
                );
                if (item) {
                    // Prioritize playing directly for resume tiles
                    this.playItem(item, true); // true for resume
                }
            });
        });

        // Update scroll arrows after content renders
        this.updateScrollArrows();
    }

    dedupeHistoryItems(items) {
        const seen = new Set();
        const unique = [];

        for (const item of items) {
            const sourceId = item.source_id ?? item?.data?.sourceId ?? 0;
            const itemType = item.item_type || item.type || '';
            const key = `${sourceId}:${itemType}:${item.item_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(item);
        }

        return unique;
    }

    navigateToSeries(item) {
        if (!this.app.pages.series) return;

        // Prepare the series object as expected by SeriesPage.showSeriesDetails
        const series = {
            series_id: item.item_id,
            sourceId: item.source_id,
            name: item.name || (item.data ? item.data.title : 'Series'),
            cover: item.stream_icon || (item.data ? item.data.poster : null),
            plot: item.data ? item.data.description : '',
            year: item.data ? item.data.year : ''
        };

        // Switch page
        this.app.navigateTo('series');

        // Show details (delay slightly to ensure page is visible)
        setTimeout(() => {
            this.app.pages.series.showSeriesDetails(series);
        }, 100);
    }

    async renderRecentMovies() {
        const list = document.getElementById('recent-movies-list');
        if (!list) return;

        try {
            const moviesRaw = await window.API.request('GET', '/channels/recent?type=movie&limit=24');
            const movies = this.dedupeRecentItems(moviesRaw).slice(0, 12);
            if (!movies || movies.length === 0) {
                list.innerHTML = '<div class="empty-state hint">No recently added movies found</div>';
                return;
            }

            list.innerHTML = movies.map(item => this.createRecentCard(item)).join('');

            // Attach listeners
            list.querySelectorAll('.dashboard-card').forEach(card => {
                card.addEventListener('click', () => {
                    const id = card.dataset.id;
                    const item = movies.find(m => m.item_id === id);
                    if (item) this.playItem(item);
                });
            });

            // Update scroll arrows after content renders
            this.updateScrollArrows();
        } catch (err) {
            console.error('[Dashboard] Error loading recent movies:', err);
        }
    }

    async renderRecentSeries() {
        const list = document.getElementById('recent-series-list');
        if (!list) return;

        try {
            const seriesRaw = await window.API.request('GET', '/channels/recent?type=series&limit=24');
            const series = this.dedupeRecentItems(seriesRaw).slice(0, 12);
            if (!series || series.length === 0) {
                list.innerHTML = '<div class="empty-state hint">No recently added series found</div>';
                return;
            }

            list.innerHTML = series.map(item => this.createRecentCard(item)).join('');

            // Attach listeners
            list.querySelectorAll('.dashboard-card').forEach(card => {
                card.addEventListener('click', () => {
                    const id = card.dataset.id;
                    const item = series.find(s => s.item_id === id);
                    if (item) this.navigateToSeries(item);
                });
            });

            // Update scroll arrows after content renders
            this.updateScrollArrows();
        } catch (err) {
            console.error('[Dashboard] Error loading recent series:', err);
        }
    }

    dedupeRecentItems(items) {
        if (!Array.isArray(items)) return [];

        const seen = new Set();
        const unique = [];

        for (const item of items) {
            const itemType = item.type || item.item_type || '';
            const normalizedTitle = this.normalizeCatalogTitle(item.name || item?.data?.title || '');
            const year = String(item.year || item?.data?.year || '').trim();
            const key = normalizedTitle
                ? `${item.source_id}:${itemType}:${normalizedTitle}:${year}`
                : `${item.source_id}:${item.item_id}:${itemType}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(item);
        }

        return unique;
    }

    normalizeCatalogTitle(rawTitle) {
        let title = String(rawTitle || '').trim();
        if (!title) return '';

        // Remove common release/source prefixes repeatedly (e.g. "EN 4K-AMZ AMZ - Movie Name").
        const prefixPattern = /^(?:\[[^\]]+\]\s*|\([^)]+\)\s*|(?:EN|ENG|MULTI|MULTI-SUB|SUB|DUB|4K|UHD|FHD|HD|SD|AMZ|NF|NETFLIX|DSNP|DSNP\+|HMAX|MAX|HULU|ATVP|APPLETV|WEB|WEB-DL|WEBRIP|BLURAY|BDRIP|HDRIP|DVDRIP|X264|X265|HEVC|AAC|DDP5\.1|DD5\.1|IMAX|EXTENDED|REMASTERED)(?:[\s._-]+))+/i;
        while (prefixPattern.test(title)) {
            title = title.replace(prefixPattern, '').trim();
        }

        // Drop leading separators left behind after prefix stripping.
        title = title.replace(/^[-:|._\s]+/, '').trim();

        // Normalize spacing/punctuation for stable comparison.
        return title
            .toLowerCase()
            .replace(/['"`]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    parseDurationToSeconds(value) {
        if (value === null || value === undefined) return 0;
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return value > 3600 * 12 ? Math.floor(value / 1000) : Math.floor(value);
        }

        const text = String(value).trim();
        if (!text) return 0;

        if (/^\d+(\.\d+)?$/.test(text)) {
            const n = Number(text);
            if (Number.isFinite(n) && n > 0) {
                return n > 3600 * 12 ? Math.floor(n / 1000) : Math.floor(n);
            }
        }

        const parts = text.split(':').map(s => Number(s));
        if (parts.length === 3 && parts.every(Number.isFinite)) {
            return Math.max(0, Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]));
        }
        if (parts.length === 2 && parts.every(Number.isFinite)) {
            return Math.max(0, Math.floor(parts[0] * 60 + parts[1]));
        }

        const h = text.match(/(\d+(?:\.\d+)?)\s*h/i);
        const m = text.match(/(\d+(?:\.\d+)?)\s*m/i);
        const s = text.match(/(\d+(?:\.\d+)?)\s*s/i);
        if (h || m || s) {
            const hh = h ? Number(h[1]) : 0;
            const mm = m ? Number(m[1]) : 0;
            const ss = s ? Number(s[1]) : 0;
            return Math.max(0, Math.floor(hh * 3600 + mm * 60 + ss));
        }

        return 0;
    }

    normalizeHistoryTiming(item) {
        const data = item?.data || {};
        let progress = Number(item?.progress || 0);
        let duration = Number(item?.duration || 0);
        if (!Number.isFinite(progress)) progress = 0;
        if (!Number.isFinite(duration)) duration = 0;

        const metadataDuration = this.parseDurationToSeconds(
            data.duration || data.runtime || data.totalDuration || 0
        );

        let factor = 1;
        if (duration > 432000) {
            factor = 1 / 1000;
        } else if (metadataDuration > 0 && duration > 0) {
            const ratio = metadataDuration / duration;
            if (ratio > 45 && ratio < 75) {
                factor = 60;
            } else if (ratio > 900 && ratio < 1100) {
                factor = 1 / 1000;
            }
        } else if (duration > 0 && duration < 400 && progress <= duration) {
            factor = 60;
        }

        const normalizedDuration = Math.max(0, Math.floor(duration * factor));
        const normalizedProgress = Math.max(0, Math.floor(progress * factor));
        const safeDuration = metadataDuration > 0
            ? Math.max(normalizedDuration, metadataDuration)
            : normalizedDuration;

        return {
            progress: Math.min(normalizedProgress, safeDuration || normalizedProgress),
            duration: safeDuration
        };
    }

    createCard(item) {
        const { data, item_id } = item;
        const type = item.item_type || item.type;

        // Proxy the poster if it's an external URL
        const safeData = data || {};
        const poster = safeData.poster || '/img/LurkedTV.png';
        const posterUrl = poster.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(poster)}` : poster;

        return `
            <div class="dashboard-card" data-id="${item_id}" data-source-id="${item.source_id || safeData.sourceId || ''}" data-type="${type}">
                <div class="card-image">
                    <img src="${posterUrl}" alt="${safeData.title || item.name}" loading="lazy" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                    <div class="play-icon-overlay">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${item.name || safeData.title}">${item.name || safeData.title || 'Unknown Title'}</div>
                    <div class="card-subtitle">${safeData.subtitle || (type === 'movie' ? 'Movie' : 'Series')}</div>
                </div>
            </div>
        `;
    }

    createRecentCard(item) {
        const { data, item_id } = item;
        const type = item.type || item.item_type;
        const poster = item.stream_icon || data.poster || '/img/LurkedTV.png';
        const posterUrl = poster.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(poster)}` : poster;

        return `
            <div class="dashboard-card" data-id="${item_id}" data-type="${type}">
                <div class="card-image">
                    <img src="${posterUrl}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                    <div class="play-icon-overlay">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${item.name || (data && data.title)}">${item.name || (data && data.title) || 'Unknown Title'}</div>
                    <div class="card-subtitle">${(data && data.subtitle) || (type === 'movie' ? 'Movie' : 'Series')}</div>
                </div>
            </div>
        `;
    }

    async playItem(item, isResume = false) {
        if (!this.app.pages.watch) return;

        try {
            const data = item.data || {};
            const normalized = this.normalizeHistoryTiming(item);
            const type = item.item_type || item.type;
            const streamType = type === 'movie' ? 'movie' : 'series';
            const sourceId = item.source_id || data.sourceId;
            const streamId = item.item_id;
            const container = item.container_extension || data.containerExtension || 'mp4';

            const result = await window.API.request('GET', `/proxy/xtream/${sourceId}/stream/${streamId}/${streamType}?container=${container}`);

            if (result && result.url) {
                const content = {
                    id: item.item_id,
                    type: type,
                    title: item.name || data.title,
                    subtitle: data.subtitle || (type === 'movie' ? 'Movie' : 'Series'),
                    poster: item.stream_icon || data.poster,
                    sourceId: sourceId,
                    resumeTime: isResume ? normalized.progress : 0,
                    duration: normalized.duration || data.duration || 0,
                    containerExtension: container
                };

                // For episodes, try to restore series data for next episode functionality
                if (type === 'episode') {
                    content.seriesId = data.seriesId || null;
                    content.currentSeason = data.currentSeason || null;
                    content.currentEpisode = data.currentEpisode || null;

                    // Fetch seriesInfo if we have a seriesId
                    if (content.seriesId && sourceId) {
                        try {
                            const seriesInfo = await window.API.request('GET', `/proxy/xtream/${sourceId}/series_info?series_id=${content.seriesId}`);
                            if (seriesInfo) {
                                content.seriesInfo = seriesInfo;
                            }
                        } catch (e) {
                            console.warn('[Dashboard] Could not fetch seriesInfo for next episode:', e);
                        }
                    }
                }

                // Switch to watch page
                this.app.navigateTo('watch');

                this.app.pages.watch.play(content, result.url);
            }
        } catch (err) {
            console.error('[Dashboard] Playback failed:', err);
        }
    }
}

window.HomePage = HomePage;