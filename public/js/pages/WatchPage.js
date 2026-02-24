/**
 * Watch Page Controller
 * Handles VOD (Movies/Series) playback with streaming service-style UI
 */

class WatchPage {
    constructor(app) {
        this.app = app;

        // Video elements
        this.video = document.getElementById('watch-video');
        this.overlay = document.getElementById('watch-overlay');

        // iOS: ensure inline playback (not fullscreen by default)
        if (this.video) {
            this.video.setAttribute('playsinline', '');
            this.video.setAttribute('webkit-playsinline', '');
        }

        // Top bar
        this.backBtn = document.getElementById('watch-back-btn');
        this.titleEl = document.getElementById('watch-title');
        this.subtitleEl = document.getElementById('watch-subtitle');

        // Controls
        this.centerPlayBtn = document.getElementById('watch-center-play');
        this.playPauseBtn = document.getElementById('watch-play-pause');
        this.skipBackBtn = document.getElementById('watch-skip-back');
        this.skipFwdBtn = document.getElementById('watch-skip-fwd');
        this.muteBtn = document.getElementById('watch-mute');
        this.volumeSlider = document.getElementById('watch-volume');
        this.fullscreenBtn = document.getElementById('watch-fullscreen');
        this.progressSlider = document.getElementById('watch-progress');
        this.seekPreviewEl = document.getElementById('watch-seek-preview');
        this.timeCurrent = document.getElementById('watch-time-current');
        this.timeTotal = document.getElementById('watch-time-total');
        this.timeRemaining = document.getElementById('watch-time-remaining');
        this.scrollHint = document.getElementById('watch-scroll-hint');
        this.loadingSpinner = document.getElementById('watch-loading');

        // Next episode
        this.nextEpisodePanel = document.getElementById('watch-next-episode');
        this.nextEpisodeTitle = document.getElementById('next-episode-title');
        this.nextCountdown = document.getElementById('next-countdown');
        this.nextPlayNowBtn = document.getElementById('next-play-now');
        this.nextCancelBtn = document.getElementById('next-cancel');

        // Details section
        this.posterEl = document.getElementById('watch-poster');
        this.contentTitleEl = document.getElementById('watch-content-title');
        this.yearEl = document.getElementById('watch-year');
        this.ratingEl = document.getElementById('watch-rating');
        this.durationEl = document.getElementById('watch-duration');
        this.descriptionEl = document.getElementById('watch-description');
        this.playBtn = document.getElementById('watch-play-btn');
        this.playBtnText = document.getElementById('watch-play-btn-text');
        this.restartBtn = document.getElementById('watch-restart-btn');
        this.favoriteBtn = document.getElementById('watch-favorite-btn');

        // Recommended / Episodes
        this.recommendedSection = document.getElementById('watch-recommended');
        this.recommendedGrid = document.getElementById('watch-recommended-grid');
        this.episodesSection = document.getElementById('watch-episodes');
        this.seasonsContainer = document.getElementById('watch-seasons');

        // Captions
        this.captionsBtn = document.getElementById('watch-captions-btn');
        this.captionsMenu = document.getElementById('watch-captions-menu');
        this.captionsList = document.getElementById('watch-captions-list');

        // Transcode Status
        this.transcodeStatusEx = document.getElementById('watch-transcode-status');
        this.qualityBadgeEl = document.getElementById('watch-quality-badge');

        // State
        this.hls = null;
        this.content = null;
        this.contentType = null; // 'movie' or 'series'
        this.seriesInfo = null;
        this.currentSeason = null;
        this.currentEpisode = null;
        this.isFavorite = false;
        this.returnPage = null;
        this.captionsMenuOpen = false;

        // Overlay timer
        this.overlayTimeout = null;
        this.overlayVisible = true;

        // Next episode
        this.nextEpisodeTimeout = null;
        this.nextEpisodeCountdown = 10;
        this.nextEpisodeInterval = null;
        this.nextEpisodeShowing = false;
        this.nextEpisodeDismissed = false;

        this.probeCache = new Map();

        // Smart anti-buffer state
        this.playbackHealthInterval = null;
        this.lastPlaybackTickAt = 0;
        this.lastPlaybackTime = 0;
        this.lastStallRecoverAt = 0;
        this.consecutiveStalls = 0;
        this.stallRecoveryTimeout = null;
        this.lastResolvedPlaybackUrl = null;
        this.suppressVideoErrorsUntil = 0;
        this.lastObservedMediaTime = 0;
        this.lastObservedWallTime = 0;
        this.intentionalSeekUntil = 0;
        this.systemSeekUntil = 0;
        this.maxUnexpectedJumpSeconds = 45;
        this.lastRateClampAt = 0;
        this.pendingUnexpectedSeekFrom = null;
        this.pendingUnexpectedSeekAt = 0;
        this.isScrubbing = false;
        this.wasPlayingBeforeScrub = false;
        this.transcodeBaseOffset = 0;
        this.knownDurationSeconds = 0;
        this.currentSessionOptions = null;
        this.sessionSeekInFlight = false;
        this.sessionRestartInFlight = false;
        this.lastSessionRestartAt = 0;
        this.hlsLoadToken = 0;
        this.historySaveInterval = null;
        this.lastHistorySavedProgress = 0;
        this.lastHistorySavedAt = 0;
        this.probeRefreshInFlight = false;

        this.init();
    }

    init() {
        // iOS Safari: detect and compensate for floating bottom toolbar
        const updateIosUiBottom = () => {
            let uiBottom = 0;
            if (window.visualViewport) {
                const vv = window.visualViewport;
                uiBottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
            }
            document.documentElement.style.setProperty('--ios-ui-bottom', uiBottom + 'px');
        };

        updateIosUiBottom();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateIosUiBottom);
            window.visualViewport.addEventListener('scroll', updateIosUiBottom);
        } else {
            window.addEventListener('resize', updateIosUiBottom);
        }

        // iOS: use custom --vh unit to avoid 100vh issues with dynamic toolbar
        const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
        const watchVideoSection = document.querySelector('.watch-video-section');
        if (isIOS && watchVideoSection) {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
            watchVideoSection.style.height = 'calc(var(--vh) * 100)';
        }

        // Apply safe area + iOS toolbar padding to overlay
        if (this.overlay) {
            this.overlay.style.paddingBottom = 'calc(env(safe-area-inset-bottom, 0px) + var(--ios-ui-bottom, 0px) + 12px)';
        }

        // Back button
        this.backBtn?.addEventListener('click', () => this.goBack());

        // Play/Pause
        this.centerPlayBtn?.addEventListener('click', () => this.togglePlay());
        this.playPauseBtn?.addEventListener('click', () => this.togglePlay());
        this.video?.addEventListener('click', () => this.togglePlay());

        // Skip buttons
        this.skipBackBtn?.addEventListener('click', () => this.skip(-10));
        this.skipFwdBtn?.addEventListener('click', () => this.skip(10));

        // Volume
        this.muteBtn?.addEventListener('click', () => this.toggleMute());
        this.volumeSlider?.addEventListener('input', (e) => this.setVolume(e.target.value));

        // Fullscreen
        this.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());

        // Picture-in-Picture
        const pipBtn = document.getElementById('watch-pip');
        pipBtn?.addEventListener('click', () => this.togglePictureInPicture());

        // Overflow Menu
        const overflowBtn = document.getElementById('watch-overflow');
        const overflowMenu = document.getElementById('watch-overflow-menu');

        overflowBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            overflowMenu?.classList.toggle('hidden');
        });

        // Copy Stream URL
        const copyUrlBtn = document.getElementById('watch-copy-url');
        copyUrlBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyStreamUrl();
            overflowMenu?.classList.add('hidden');
        });

        // Close overflow menu when clicking outside
        document.addEventListener('click', (e) => {
            if (overflowMenu && !overflowMenu.classList.contains('hidden') &&
                !overflowMenu.contains(e.target) && e.target !== overflowBtn) {
                overflowMenu.classList.add('hidden');
            }
        });

        // Progress bar
        this.progressSlider?.addEventListener('pointerdown', () => this.startScrub());
        this.progressSlider?.addEventListener('pointerup', () => this.commitScrubSeek());
        this.progressSlider?.addEventListener('pointercancel', () => this.cancelScrub());
        this.progressSlider?.addEventListener('input', (e) => this.onSeekInput(e.target.value));
        this.progressSlider?.addEventListener('change', () => this.commitScrubSeek());
        this.progressSlider?.addEventListener('blur', () => this.cancelScrub());
        document.addEventListener('pointerup', () => this.commitScrubSeek());

        // Video events
        this.video?.addEventListener('timeupdate', () => {
            this.guardUnexpectedTimeJump();
            this.updateProgress();
            this.markPlaybackHealthy();
        });
        this.video?.addEventListener('seeking', () => this.onVideoSeeking());
        this.video?.addEventListener('seeked', () => this.onVideoSeeked());
        this.video?.addEventListener('ratechange', () => this.enforceNormalPlaybackRate());
        this.video?.addEventListener('loadedmetadata', () => this.onMetadataLoaded());
        this.video?.addEventListener('play', () => this.onPlay());
        this.video?.addEventListener('playing', () => this.markPlaybackHealthy());
        this.video?.addEventListener('pause', () => this.onPause());
        this.video?.addEventListener('ended', () => this.onEnded());
        this.video?.addEventListener('error', (e) => this.onError(e));
        this.video?.addEventListener('waiting', () => {
            this.showLoading();
            this.handlePlaybackStall('video_waiting');
        });
        this.video?.addEventListener('stalled', () => this.handlePlaybackStall('video_stalled'));
        this.video?.addEventListener('canplay', () => {
            this.hideLoading();
            this.markPlaybackHealthy();
        });

        // Overlay auto-hide + click to toggle play
        const watchSection = document.querySelector('.watch-video-section');
        watchSection?.addEventListener('mousemove', () => this.showOverlay());
        watchSection?.addEventListener('touchstart', () => this.showOverlay());
        watchSection?.addEventListener('click', (e) => {
            this.showOverlay();
            // Only toggle play if clicking on video area (not controls)
            if (e.target === this.video || e.target === watchSection ||
                e.target.classList.contains('watch-overlay') || e.target === this.overlay) {
                this.togglePlay();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Details section buttons
        this.playBtn?.addEventListener('click', () => this.handlePlayAction());
        this.restartBtn?.addEventListener('click', () => this.restartFromBeginning());
        this.favoriteBtn?.addEventListener('click', () => this.toggleFavorite());

        // Next episode buttons
        this.nextPlayNowBtn?.addEventListener('click', () => this.playNextEpisode());
        this.nextCancelBtn?.addEventListener('click', () => this.cancelNextEpisode());

        // Captions toggle
        this.captionsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCaptionsMenu();
        });

        // Close captions menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.captionsMenuOpen && !this.captionsMenu?.contains(e.target) && e.target !== this.captionsBtn) {
                this.closeCaptionsMenu();
            }
        });

        // Hide scroll hint after scrolling
        const watchPage = document.getElementById('page-watch');
        watchPage?.addEventListener('scroll', () => {
            if (watchPage.scrollTop > 50) {
                this.scrollHint?.classList.add('hidden');
            } else {
                this.scrollHint?.classList.remove('hidden');
            }
        });
    }

    /**
     * Main entry point - play content
     * @param {Object} content - Movie or episode info
     * @param {string} streamUrl - Stream URL
     */
    async play(content, streamUrl) {
        // Save and teardown any currently playing item before switching context.
        this.stop();

        this.content = content;
        this.contentType = content.type;
        this.seriesInfo = content.seriesInfo || null;
        this.currentSeason = content.currentSeason || null;
        this.currentEpisode = content.currentEpisode || null;
        this.containerExtension = content.containerExtension || 'mp4';
        this.returnPage = content.type === 'movie' ? 'movies' : 'series';
        this.knownDurationSeconds = this.parseDurationToSeconds(
            content.duration || content.runtime || content.totalDuration || 0
        );

        // Stop any Live TV playback before starting movie/series
        this.app?.player?.stop?.();

        // Reset state
        this.cancelNextEpisode();
        this.nextEpisodeDismissed = false;

        // Navigate to watch page
        this.app.navigateTo('watch', true);

        // Scroll to top
        document.getElementById('page-watch')?.scrollTo(0, 0);

        // Update title bar
        this.titleEl.textContent = content.title || '';
        this.subtitleEl.textContent = content.subtitle || '';

        // Load video
        await this.loadVideo(streamUrl, { skipStop: true });

        // Show Now Playing indicator in navbar
        this.showNowPlaying(content.title);

        // Populate details section
        this.renderDetails();

        // Load recommended (movies) or episodes (series)
        if (content.type === 'movie') {
            this.episodesSection?.classList.add('hidden');
            this.recommendedSection?.classList.remove('hidden');
            await this.loadRecommended(content.sourceId, content.categoryId);
        } else {
            this.recommendedSection?.classList.add('hidden');
            this.episodesSection?.classList.remove('hidden');
            this.renderEpisodes();
        }

        // Check favorite status
        await this.checkFavorite();
        // Show overlay initially
        this.showOverlay();

    }

    /**
     * Show Now Playing indicator in player header
     */
    showNowPlaying(title) {
        const indicator = document.getElementById('watch-now-playing-indicator');
        const textEl = document.getElementById('watch-now-playing-text');
        if (indicator && textEl) {
            textEl.textContent = title || 'Now Playing';
            indicator.classList.remove('hidden');
        }
    }

    /**
     * Hide Now Playing indicator in player header
     */
    hideNowPlaying() {
        const indicator = document.getElementById('watch-now-playing-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
        }
    }

    /**
     * Start a HLS transcode session
     */
    async startTranscodeSession(url, options = {}) {
        try {
            console.log('[WatchPage] Starting HLS transcode session...', options);
            const res = await fetch('/api/transcode/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    seekOffset: 0,
                    ...options
                })
            });
            if (!res.ok) {
                let details = '';
                try {
                    const bodyText = await res.text();
                    details = bodyText ? ` - ${bodyText.slice(0, 280)}` : '';
                } catch (_) { }
                throw new Error(`Failed to start session (${res.status})${details}`);
            }
            const session = await res.json();
            this.currentSessionId = session.sessionId;
            this.currentSessionOptions = { ...options };
            this.transcodeBaseOffset = Math.max(0, Number(options.seekOffset || 0));
            return session.playlistUrl;
        } catch (err) {
            console.error('[WatchPage] Session start failed:', err);
            // Fallback to direct transcode if session fails
            return window.API?.resolveMediaUrl?.(url) || url;
        }
    }

    /**
     * Stop and cleanup current transcode session
     */
    async stopTranscodeSession() {
        if (this.currentSessionId) {
            console.log('[WatchPage] Stopping transcode session:', this.currentSessionId);
            try {
                await fetch(`/api/transcode/${this.currentSessionId}`, { method: 'DELETE' });
            } catch (err) {
                console.error('Failed to stop session:', err);
            }
            this.currentSessionId = null;
        }
        this.currentSessionOptions = null;
        this.transcodeBaseOffset = 0;
    }

    extractSessionIdFromPlaylistUrl(url = '') {
        const match = String(url || '').match(/\/api\/transcode\/([^/]+)\/stream\.m3u8(?:\?|$)/);
        return match?.[1] || null;
    }

    isTranscodePlaylistUrl(url = '') {
        return !!this.extractSessionIdFromPlaylistUrl(url);
    }

    async restartCurrentTranscodeSession(reason = 'recovery') {
        if (this.sessionRestartInFlight) return false;
        if (!this.currentUrl || !this.currentSessionOptions) return false;

        const now = Date.now();
        if (now - this.lastSessionRestartAt < 1500) return false;

        this.sessionRestartInFlight = true;
        this.lastSessionRestartAt = now;

        const restartOptions = {
            ...this.currentSessionOptions,
            seekOffset: Math.max(0, Math.floor(this.getAbsoluteCurrentTime()))
        };

        try {
            console.warn(`[WatchPage] Restarting transcode session (${reason})...`);
            await this.stopTranscodeSession();
            const playlistUrl = await this.startTranscodeSession(this.currentUrl, restartOptions);
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
            return true;
        } catch (err) {
            console.warn(`[WatchPage] Transcode restart failed (${reason}):`, err?.message || err);
            return false;
        } finally {
            this.sessionRestartInFlight = false;
        }
    }

    async updateTranscodeStatus(mode, text) {
        if (!this.transcodeStatusEx) return;

        this.transcodeStatusEx.className = 'transcode-status'; // Reset classes

        if (mode === 'hidden') {
            this.transcodeStatusEx.classList.add('hidden');
            return;
        }

        this.transcodeStatusEx.textContent = text || mode;
        this.transcodeStatusEx.classList.add(mode);

        // Ensure it's visible
        this.transcodeStatusEx.classList.remove('hidden');
    }

    /**
     * Get quality label from video height
     */
    getQualityLabel(height) {
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height > 0) return `${height}p`;
        return null;
    }

    /**
     * Update quality badge display
     */
    updateQualityBadge() {
        if (!this.qualityBadgeEl) return;

        if (this.currentStreamInfo?.height > 0) {
            this.qualityBadgeEl.textContent = this.getQualityLabel(this.currentStreamInfo.height);
            this.qualityBadgeEl.classList.remove('hidden');
        } else {
            this.qualityBadgeEl.classList.add('hidden');
        }
    }

    getCachedSettings() {
        // Reuse already loaded player settings when possible to avoid a network round-trip
        if (this.app?.player?.settings && typeof this.app.player.settings === 'object') {
            return { ...this.app.player.settings };
        }
        return {};
    }

    async fetchProbeWithTimeout(url, ua = '', timeoutMs = 2500, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const fresh = options?.forceRefresh ? '&fresh=1' : '';

        try {
            const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua || '')}${fresh}`, {
                signal: controller.signal
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            if (err?.name === 'AbortError') {
                console.warn(`[WatchPage] Probe timed out after ${timeoutMs}ms, continuing fast path`);
                return null;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    async getProbeInfo(url, settings, timeoutMs = 2500, options = {}) {
        const ua = settings.userAgentPreset === 'custom' ? settings.userAgentCustom : settings.userAgentPreset;
        const cacheKey = `${url}|${ua || ''}`;
        const shouldForceRefresh = !!options?.forceRefresh;
        const cached = this.probeCache.get(cacheKey);
        if (!shouldForceRefresh && cached && (Date.now() - cached.at < 10 * 60 * 1000)) {
            return cached.data;
        }

        const info = await this.fetchProbeWithTimeout(url, ua || '', timeoutMs, { forceRefresh: shouldForceRefresh });
        if (info) {
            this.probeCache.set(cacheKey, { data: info, at: Date.now() });
        }
        return info;
    }

    async refreshPlaybackMetadataFromProbe() {
        if (this.probeRefreshInFlight) return;
        if (!this.currentUrl || !this.canSaveHistory()) return;

        this.probeRefreshInFlight = true;
        try {
            const settings = this.getCachedSettings();
            const info = await this.getProbeInfo(this.currentUrl, settings, 4000, { forceRefresh: true });
            if (!info) return;

            this.currentStreamInfo = {
                ...this.currentStreamInfo,
                ...info
            };
            this.applyProbeDuration(info);
            this.updateQualityBadge();
        } catch (err) {
            console.warn('[WatchPage] Periodic probe refresh failed:', err?.message || err);
        } finally {
            this.probeRefreshInFlight = false;
        }
    }

    applyProbeDuration(info) {
        const probeDuration = Number(info?.duration || 0);
        if (!Number.isFinite(probeDuration) || probeDuration <= 0) return;

        const rounded = Math.floor(probeDuration);
        if (rounded <= 0) return;

        // Prefer ffprobe duration as authoritative runtime when available.
        this.knownDurationSeconds = rounded;
        const current = this.getAbsoluteCurrentTime();
        this.updateTimeLabels(current, this.getSeekableDuration());
    }

    async loadVideo(url, options = {}) {
        // Store the URL for copy functionality
        this.currentUrl = url;
        this.resetAntiBufferState();

        if (!options.skipStop) {
            // Stop any existing playback
            this.stop();
        }

        // Show loading spinner
        this.showLoading();

        // Get settings for proxy/transcode
        let settings = this.getCachedSettings();
        try {
            if (Object.keys(settings).length === 0) {
                settings = await API.settings.get();
            }
        } catch (e) {
            console.warn('Could not load settings');
        }

        // Detect stream type
        const looksLikeHls = url.includes('.m3u8') || url.includes('m3u8');
        const isRawTs = url.includes('.ts') && !url.includes('.m3u8');
        const isDirectVideo = url.includes('.mp4') || url.includes('.mkv') || url.includes('.avi');

        // Priority 0: Auto Transcode (Smart) - probe first, then decide
        if (settings.autoTranscode) {
            console.log('[WatchPage] Auto Transcode enabled. Probing stream...');
            try {
                const info = await this.getProbeInfo(url, settings, 2500);
                if (!info) {
                    console.log('[WatchPage] Auto probe unavailable, using fast direct path');
                    throw new Error('Probe unavailable');
                }
                console.log(`[WatchPage] Probe result: video=${info.video}, audio=${info.audio}, ${info.width}x${info.height}, compatible=${info.compatible}`);

                // Store early probe info for quality display
                this.currentStreamInfo = info;
                this.applyProbeDuration(info);
                this.updateQualityBadge();

                if (info.needsTranscode || settings.upscaleEnabled) {
                    console.log(`[WatchPage] Auto: Using HLS transcode session (${settings.upscaleEnabled ? 'Upscaling' : 'Incompatible audio/video'})`);

                    // Heuristic: If video is h264/compat, copy video. Usage: Audio fix. 
                    // BUT: If upscaling is enabled, we MUST encode.
                    const videoMode = (info.video && info.video.includes('h264') && !settings.upscaleEnabled) ? 'copy' : 'encode';
                    const statusText = videoMode === 'copy' ? 'Transcoding (Audio)' : (settings.upscaleEnabled ? 'Upscaling' : 'Transcoding (Video)');
                    const statusMode = settings.upscaleEnabled ? 'upscaling' : 'transcoding';

                    this.updateTranscodeStatus(statusMode, statusText);
                    const playlistUrl = await this.startTranscodeSession(url, {
                        videoMode,
                        seekOffset: 0,
                        videoCodec: info.video,
                        audioCodec: info.audio,
                        audioChannels: info.audioChannels
                    });
                    this.playHls(playlistUrl);
                    this.setVolumeFromStorage();
                    return;
                } else if (info.needsRemux) {
                    // Remux (container swap) currently doesn't use session logic, uses direct stream
                    // TODO: Move remux to session logic if seeking is needed for TS files
                    console.log('[WatchPage] Auto: Using remux (.ts container)');
                    this.updateTranscodeStatus('remuxing', 'Remux (Auto)');
                    const finalUrl = window.API?.resolveMediaUrl?.(url) || url;
                    this.video.src = finalUrl;
                    this.video.play().catch(e => {
                        if (e.name !== 'AbortError') console.error('[WatchPage] Autoplay error:', e);
                    });
                    this.setVolumeFromStorage();
                    return;
                }
                // Compatible - fall through to normal playback
                console.log('[WatchPage] Auto: Using normal playback (compatible)');
            } catch (err) {
                console.warn('[WatchPage] Probe failed, using normal playback:', err.message);
                // Continue with normal playback on probe failure
            }
        }

        // Priority 1: Force Video Transcode (Full) or Upscaling
        if (settings.forceVideoTranscode || settings.upscaleEnabled) {
            const statusText = settings.upscaleEnabled ? 'Upscaling' : 'Transcoding (Video)';
            const statusMode = settings.upscaleEnabled ? 'upscaling' : 'transcoding';
            console.log(`[WatchPage] ${statusText} enabled. Starting session (encode)...`);
            this.updateTranscodeStatus(statusMode, statusText);
            const playlistUrl = await this.startTranscodeSession(url, {
                videoMode: 'encode',
                seekOffset: 0
            });
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
            return;
        }

        if (settings.forceTranscode) {
            console.log('[WatchPage] Force Audio Transcode enabled. Starting session (copy)...');
            this.updateTranscodeStatus('transcoding', 'Transcoding (Audio)');

            // Probe to get video codec for HEVC tag handling
            let videoCodec = 'unknown';
            try {
                const info = await this.getProbeInfo(url, settings, 1500);
                if (info?.video) videoCodec = info.video;
                this.applyProbeDuration(info);
            } catch (e) { console.warn('Probe failed for force audio, assuming h264'); }

            const playlistUrl = await this.startTranscodeSession(url, {
                videoMode: 'copy',
                videoCodec,
                seekOffset: 0
            });
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
            return;
        }

        // Priority 2: Force Remux for raw TS streams
        if (settings.forceRemux && isRawTs) {
            console.log('[WatchPage] Force Remux enabled');
            this.updateTranscodeStatus('remuxing', 'Remux (Force)');
            const finalUrl = window.API?.resolveMediaUrl?.(url) || url;
            this.video.src = finalUrl;
            this.video.play().catch(e => {
                if (e.name !== 'AbortError') console.error('[WatchPage] Autoplay error:', e);
            });
            this.setVolumeFromStorage();
            return;
        }

        // Determine if proxy is needed
        const proxyRequiredDomains = ['pluto.tv'];
        const needsProxy = settings.forceProxy || proxyRequiredDomains.some(domain => url.includes(domain));
        const finalUrl = needsProxy ? (window.API?.resolveMediaUrl?.(url) || url) : url;

        console.log('[WatchPage] Playing:', { url, needsProxy, looksLikeHls });

        // Use HLS.js for HLS streams
        if (looksLikeHls && Hls.isSupported()) {
            this.updateTranscodeStatus('direct', 'Direct HLS');
            this.playHls(finalUrl);
        } else {
            // Direct playback for mp4/mkv/avi
            this.updateTranscodeStatus('direct', 'Direct Play');
            this.video.src = finalUrl;
            this.video.play().catch(e => {
                if (e.name !== 'AbortError') console.error('[WatchPage] Autoplay error:', e);
            });
        }

        this.setVolumeFromStorage();
    }

    /**
     * Play HLS stream using Hls.js
     */
    playHls(url) {
        this.lastResolvedPlaybackUrl = url;
        const loadToken = ++this.hlsLoadToken;

        if (this.hls) {
            this.hls.destroy();
        }

        this.hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferHole: 1.0,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
            lowLatencyMode: false,
            nudgeOffset: 0.2,
            nudgeMaxRetry: 6,
            startLevel: -1,
            enableWorker: true,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        // Listen for subtitle track updates
        this.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
            if (loadToken !== this.hlsLoadToken) return;
            console.log('[WatchPage] Subtitle tracks updated:', data.subtitleTracks);
            // Wait a moment for native text tracks to populate
            setTimeout(() => this.updateCaptionsTracks(), 100);
        });

        this.hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (event, data) => {
            if (loadToken !== this.hlsLoadToken) return;
            console.log('[WatchPage] Subtitle track switched:', data);
        });

        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (loadToken !== this.hlsLoadToken) return;
            this.video.play().catch(e => {
                if (e.name !== 'AbortError') console.error('[WatchPage] Autoplay error:', e);
            });

            this.startPlaybackHealthMonitor();
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (loadToken !== this.hlsLoadToken) return;
            if (!data?.fatal) {
                if (data?.details === 'bufferStalledError') {
                    this.handlePlaybackStall('hls_buffer_stalled');
                }
                return;
            }

            if (data.fatal) {
                console.error('[WatchPage] HLS fatal error:', data);

                const statusCode = Number(
                    data?.response?.code ??
                    data?.networkDetails?.status ??
                    data?.loader?.stats?.responseCode ??
                    0
                );
                const failedUrl = String(data?.url || '');
                const failedSessionId = this.extractSessionIdFromPlaylistUrl(failedUrl);
                const isTranscodeManifestError = this.isTranscodePlaylistUrl(failedUrl) ||
                    this.isTranscodePlaylistUrl(url);
                const detail = String(data?.details || '').toLowerCase();
                const isManifestOrLevelLoadError = detail.includes('manifestloaderror') || detail.includes('levelloaderror');
                const hasCurrentSession = !!this.currentSessionId;
                const staleSession = !!(failedSessionId && this.currentSessionId && failedSessionId !== this.currentSessionId);
                const currentSessionFailed = !!(failedSessionId && this.currentSessionId && failedSessionId === this.currentSessionId);

                // hls.js does not consistently expose HTTP status on level/manifest load failures,
                // so session mismatch or explicit 404/410 should immediately trigger a fresh session.
                if (isTranscodeManifestError && staleSession) {
                    this.restartCurrentTranscodeSession('manifest_stale_session');
                    return;
                }

                if (isTranscodeManifestError && (statusCode === 404 || statusCode === 410) && (currentSessionFailed || hasCurrentSession)) {
                    this.restartCurrentTranscodeSession(`manifest_${statusCode}`);
                    return;
                }

                if (isTranscodeManifestError && isManifestOrLevelLoadError && hasCurrentSession && statusCode === 0) {
                    this.restartCurrentTranscodeSession(`manifest_or_level_${detail || 'unknown'}`);
                    return;
                }
                // Try proxy on CORS error (only if not already proxied/transcoded)
                // Note: Transcoded streams are local, so no CORS issues usually
                if (!url.startsWith('/api/') && (data.type === Hls.ErrorTypes.NETWORK_ERROR)) {
                    console.log('[WatchPage] Retrying via proxy...');
                    this.playHls(window.API?.resolveMediaUrl?.(this.currentUrl) || this.currentUrl);
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    this.handlePlaybackStall('hls_media_error');
                    this.hls.recoverMediaError();
                } else {
                    this.handlePlaybackStall('hls_fatal');
                }
            }
        });

        this.hls.on(Hls.Events.BUFFER_STALLED_ERROR, () => {
            if (loadToken !== this.hlsLoadToken) return;
            this.handlePlaybackStall('hls_buffer_stalled_event');
        });

        this.hls.on(Hls.Events.FRAG_LOADED, () => {
            if (loadToken !== this.hlsLoadToken) return;
            this.markPlaybackHealthy();
        });
    }

    setVolumeFromStorage() {
        const savedVolume = localStorage.getItem('nodecast-volume') || '80';
        this.video.volume = parseInt(savedVolume) / 100;
        if (this.volumeSlider) this.volumeSlider.value = savedVolume;
    }

    stop() {
        this.stopPlaybackHealthMonitor();
        this.stopHistorySaveLoop();
        this.saveWatchProgress('stop', { force: true }).catch(() => {});

        // Cleanup transcode session if exists
        this.stopTranscodeSession();
        this.updateTranscodeStatus('hidden');

        // Hide quality badge
        this.currentStreamInfo = null;
        if (this.qualityBadgeEl) {
            this.qualityBadgeEl.classList.add('hidden');
        }

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.hlsLoadToken += 1;

        if (this.stallRecoveryTimeout) {
            clearTimeout(this.stallRecoveryTimeout);
            this.stallRecoveryTimeout = null;
        }

        if (this.video) {
            this.suppressVideoErrorsUntil = Date.now() + 1500;
            this.video.playbackRate = 1;
            this.video.defaultPlaybackRate = 1;
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
        }

        this.hideNowPlaying();
    }

    // === Playback Controls ===

    togglePlay() {
        if (this.video.paused) {
            this.video.play().catch(console.error);
        } else {
            this.video.pause();
        }
    }

    skip(seconds) {
        if (this.video) {
            const targetAbsolute = this.getAbsoluteCurrentTime() + Number(seconds || 0);
            const duration = this.getSeekableDuration();
            const clamped = Math.max(0, Math.min(targetAbsolute, duration > 0 ? duration : targetAbsolute));
            this.seekToAbsolute(clamped);
        }
    }

    seek(percent) {
        const duration = this.getSeekableDuration();
        if (this.video && duration > 0) {
            const targetAbsolute = (Number(percent) / 100) * duration;
            this.seekToAbsolute(targetAbsolute);
        }
    }

    startScrub() {
        if (!this.video || this.getSeekableDuration() <= 0) return;
        this.isScrubbing = true;
        this.wasPlayingBeforeScrub = !this.video.paused;
        this.progressSlider?.parentElement?.classList.add('scrubbing');
        this.seekPreviewEl?.classList.remove('hidden');
        this.showOverlay();
    }

    onSeekInput(percent) {
        const value = Number(percent);
        const duration = this.getSeekableDuration();
        if (!this.video || duration <= 0 || !Number.isFinite(value)) return;

        const clamped = Math.max(0, Math.min(100, value));
        this.updateSeekVisual(clamped);
        const previewSeconds = (clamped / 100) * duration;
        this.updateTimeLabels(previewSeconds, duration);
        if (this.seekPreviewEl) {
            this.seekPreviewEl.textContent = this.formatTime(previewSeconds);
        }

        if (!this.isScrubbing) {
            this.seek(clamped);
        }
    }

    commitScrubSeek() {
        if (!this.isScrubbing) return;
        const duration = this.getSeekableDuration();
        if (!this.video || duration <= 0) {
            this.cancelScrub();
            return;
        }

        const value = Number(this.progressSlider?.value || 0);
        const clamped = Math.max(0, Math.min(100, value));
        this.seek(clamped);

        this.isScrubbing = false;
        this.progressSlider?.parentElement?.classList.remove('scrubbing');
        this.seekPreviewEl?.classList.add('hidden');
        this.updateProgress();
    }

    cancelScrub() {
        if (!this.isScrubbing) return;
        this.isScrubbing = false;
        this.progressSlider?.parentElement?.classList.remove('scrubbing');
        this.seekPreviewEl?.classList.add('hidden');
        this.updateProgress();
    }

    toggleMute() {
        if (this.video) {
            this.video.muted = !this.video.muted;
            this.updateVolumeUI();
        }
    }

    setVolume(value) {
        if (this.video) {
            this.video.volume = value / 100;
            this.video.muted = false;
            localStorage.setItem('nodecast-volume', value);
            this.updateVolumeUI();
        }
    }

    toggleFullscreen() {
        const container = document.querySelector('.watch-video-section');
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

        if (isFullscreen) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else {
            if (container?.requestFullscreen) {
                container.requestFullscreen();
            } else if (container?.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (this.video?.webkitEnterFullscreen) {
                // iOS Safari: use native video fullscreen
                this.video.webkitEnterFullscreen();
            }
        }
    }

    async togglePictureInPicture() {
        try {
            // Standard PiP API (Chrome, Edge, Firefox)
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled && this.video.readyState >= 2) {
                await this.video.requestPictureInPicture();
            }
            // Safari fallback using webkitPresentationMode
            else if (typeof this.video.webkitSetPresentationMode === 'function') {
                const mode = this.video.webkitPresentationMode;
                this.video.webkitSetPresentationMode(mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
            }
        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                console.error('Picture-in-Picture error:', err);
            }
        }
    }

    /**
     * Copy current stream URL to clipboard
     */
    copyStreamUrl() {
        if (!this.currentUrl) {
            console.warn('[WatchPage] No stream URL to copy');
            return;
        }

        let streamUrl = this.currentUrl;

        // If it's a relative URL, make it absolute
        if (streamUrl.startsWith('/')) {
            streamUrl = window.location.origin + streamUrl;
        }

        const showPromptFallback = () => {
            prompt('Copy this URL:', streamUrl);
        };

        // navigator.clipboard is only available in secure contexts (HTTPS/localhost)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(streamUrl).then(() => {
                // Show brief feedback
                const btn = document.getElementById('watch-copy-url');
                if (btn) {
                    btn.textContent = '✓ Copied!';
                    setTimeout(() => {
                        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Copy Stream URL`;
                    }, 1500);
                }
                console.log('[WatchPage] Stream URL copied:', streamUrl);
            }).catch(() => {
                showPromptFallback();
            });
        } else {
            // Fallback for insecure contexts (HTTP)
            showPromptFallback();
        }
    }

    // === UI Updates ===

    updateProgress() {
        if (!this.video) return;

        if (this.isScrubbing) return;

        const duration = this.getSeekableDuration();
        if (duration <= 0) return;

        const currentAbsolute = this.getAbsoluteCurrentTime();
        const percent = (currentAbsolute / duration) * 100;
        this.progressSlider.value = percent;
        this.updateSeekVisual(percent);
        this.updateTimeLabels(currentAbsolute, duration);

        // Show "Up Next" panel early for series (like streaming services do during credits)
        // Only show if auto-play next episode is enabled
        const autoPlayEnabled = this.app?.player?.settings?.autoPlayNextEpisode;
        if (autoPlayEnabled && this.contentType === 'series' && this.seriesInfo && !this.nextEpisodeShowing && !this.nextEpisodeDismissed) {
            const currentTime = currentAbsolute;

            // Only proceed if we have reliable duration data
            if (isFinite(duration) && duration >= 180 && currentTime >= 120) {
                const timeRemaining = duration - currentTime;
                const creditsThreshold = 10; // seconds before end to show "Up Next"

                if (timeRemaining <= creditsThreshold && timeRemaining > 0) {
                    const nextEp = this.getNextEpisode();
                    if (nextEp) {
                        this.nextEpisodeShowing = true;
                        this.showNextEpisodePanel(nextEp);
                    }
                }
            }
        }
    }

    onMetadataLoaded() {
        this.enforceNormalPlaybackRate(true);
        this.lastObservedMediaTime = this.video?.currentTime || 0;
        this.lastObservedWallTime = Date.now();
        this.updateSeekVisual(0);
        const total = this.getSeekableDuration();
        if (total > 0) this.updateTimeLabels(this.getAbsoluteCurrentTime(), total);

        // Detect resolution
        if (this.video && this.video.videoHeight > 0) {
            this.currentStreamInfo = {
                width: this.video.videoWidth,
                height: this.video.videoHeight
            };
            this.updateQualityBadge();
        }

    }

    onPlay() {
        this.enforceNormalPlaybackRate(true);

        // Update play/pause button icons
        this.playPauseBtn?.querySelector('.icon-play')?.classList.add('hidden');
        this.playPauseBtn?.querySelector('.icon-pause')?.classList.remove('hidden');
        this.centerPlayBtn?.classList.remove('show');

        // Start overlay auto-hide
        this.startOverlayTimer();
        if (!this.isScrubbing) {
            this.seekPreviewEl?.classList.add('hidden');
        }

        this.startHistorySaveLoop();
        this.saveWatchProgress('play', { force: true }).catch(() => {});
    }

    onPause() {
        this.playPauseBtn?.querySelector('.icon-play')?.classList.remove('hidden');
        this.playPauseBtn?.querySelector('.icon-pause')?.classList.add('hidden');
        this.centerPlayBtn?.classList.add('show');

        // Keep overlay visible when paused
        this.showOverlay();
        clearTimeout(this.overlayTimeout);

        this.stopHistorySaveLoop();
        this.saveWatchProgress('pause', { force: true }).catch(() => {});
    }

    onEnded() {
        this.stopHistorySaveLoop();
        this.saveWatchProgress('ended', { force: true, completed: true }).catch(() => {});

        // For series, show next episode panel if not already showing and auto-play is enabled
        const autoPlayEnabled = this.app?.player?.settings?.autoPlayNextEpisode;
        if (autoPlayEnabled && this.contentType === 'series' && this.seriesInfo && !this.nextEpisodeShowing) {
            const nextEp = this.getNextEpisode();
            if (nextEp) {
                this.nextEpisodeShowing = true;
                this.showNextEpisodePanel(nextEp);
            }
        }
    }

    onError(e) {
        // Ignore teardown noise (e.g. clearing src while stopping player)
        if (Date.now() < this.suppressVideoErrorsUntil) {
            return;
        }

        const srcAttr = this.video?.getAttribute('src');
        const hasNoSource = !srcAttr && !this.video?.currentSrc;

        // Ignore benign "Empty src attribute" errors after source cleanup.
        if (this.video?.error?.code === 4 && hasNoSource) {
            return;
        }

        // Log actual playback errors
        const error = this.video?.error;
        if (error && error.code) {
            console.error('[WatchPage] Video error:', error.code, error.message);
        }
    }

    canSaveHistory() {
        const hasContent = !!this.content;
        const sourceId = Number(this.content?.sourceId);
        const itemId = this.content?.id;
        if (!hasContent || !itemId) return false;
        if (!Number.isFinite(sourceId) || sourceId <= 0) return false;
        return this.contentType === 'movie' || this.contentType === 'series';
    }

    getHistoryDurationSeconds() {
        const seekable = Number(this.getSeekableDuration() || 0);
        if (Number.isFinite(seekable) && seekable > 0) return Math.floor(seekable);
        const known = Number(this.knownDurationSeconds || 0);
        if (Number.isFinite(known) && known > 0) return Math.floor(known);
        return 0;
    }

    getHistoryPayload(reason = 'tick', completed = false) {
        const progress = Math.max(0, Math.floor(Number(this.getAbsoluteCurrentTime() || 0)));
        const duration = this.getHistoryDurationSeconds();
        const type = this.contentType === 'movie' ? 'movie' : 'episode';

        return {
            id: String(this.content.id),
            type,
            parentId: type === 'episode' ? (this.content.seriesId ? String(this.content.seriesId) : null) : null,
            progress,
            duration,
            sourceId: Number(this.content.sourceId),
            completed: !!completed,
            data: {
                reason: String(reason || 'tick'),
                title: this.content.title || '',
                subtitle: this.content.subtitle || '',
                description: this.content.description || '',
                poster: this.content.poster || '',
                year: this.content.year || '',
                rating: this.content.rating || '',
                sourceId: Number(this.content.sourceId),
                containerExtension: this.containerExtension || 'mp4',
                streamVideoCodec: this.currentStreamInfo?.video || '',
                streamAudioCodec: this.currentStreamInfo?.audio || '',
                streamContainer: this.currentStreamInfo?.container || '',
                streamWidth: Number(this.currentStreamInfo?.width || 0),
                streamHeight: Number(this.currentStreamInfo?.height || 0),
                seriesId: this.content.seriesId || null,
                currentSeason: this.content.currentSeason || null,
                currentEpisode: this.content.currentEpisode || null,
                duration
            }
        };
    }

    async saveWatchProgress(reason = 'tick', options = {}) {
        const { force = false, completed = false } = options;
        if (!this.canSaveHistory()) return;

        const payload = this.getHistoryPayload(reason, completed);
        const allowZeroDurationStartLog = reason === 'play';
        // Some series streams do not expose duration immediately.
        // Still persist early progress so "currently watching" (Discord/status UI) stays accurate.
        if (!payload.duration && !completed && !allowZeroDurationStartLog && payload.progress <= 0) return;

        const now = Date.now();
        const progressDelta = Math.abs(payload.progress - this.lastHistorySavedProgress);
        const shouldSkip = !force && !completed && progressDelta < 5 && (now - this.lastHistorySavedAt) < 10000;
        if (shouldSkip) return;

        try {
            await window.API.request('POST', '/history', payload);
            this.lastHistorySavedProgress = payload.progress;
            this.lastHistorySavedAt = now;
        } catch (err) {
            console.warn(`[WatchPage] Failed to save watch progress (${reason}):`, err?.message || err);
        }
    }

    startHistorySaveLoop() {
        this.stopHistorySaveLoop();
        this.historySaveInterval = setInterval(async () => {
            await this.refreshPlaybackMetadataFromProbe();
            this.saveWatchProgress('interval', { force: true }).catch(() => {});
        }, 10000);
    }

    stopHistorySaveLoop() {
        if (this.historySaveInterval) {
            clearInterval(this.historySaveInterval);
            this.historySaveInterval = null;
        }
    }

    updateVolumeUI() {
        const isMuted = this.video?.muted || this.video?.volume === 0;
        this.muteBtn?.querySelector('.icon-vol')?.classList.toggle('hidden', isMuted);
        this.muteBtn?.querySelector('.icon-muted')?.classList.toggle('hidden', !isMuted);
    }

    updateSeekVisual(percent) {
        if (!this.progressSlider) return;
        const safe = Math.max(0, Math.min(100, Number(percent) || 0));
        const pct = `${safe}%`;
        const container = this.progressSlider.parentElement;
        if (container) {
            container.style.setProperty('--seek-progress', pct);
        }
    }

    updateTimeLabels(currentSeconds, totalSeconds) {
        if (this.timeCurrent) {
            this.timeCurrent.textContent = this.formatTime(currentSeconds);
        }
        if (this.timeTotal) {
            this.timeTotal.textContent = this.formatTime(totalSeconds);
        }
        if (this.timeRemaining) {
            const remaining = Math.max(0, Number(totalSeconds || 0) - Number(currentSeconds || 0));
            this.timeRemaining.textContent = `-${this.formatTime(remaining)}`;
        }
    }

    getAbsoluteCurrentTime() {
        const localTime = Number(this.video?.currentTime || 0);
        return Math.max(0, this.transcodeBaseOffset + localTime);
    }

    getSeekableDuration() {
        const mediaDuration = Number(this.video?.duration || 0);
        if (this.knownDurationSeconds > 0) {
            return Math.max(this.knownDurationSeconds, this.transcodeBaseOffset + Math.max(0, mediaDuration));
        }
        if (mediaDuration > 0) {
            return Math.max(mediaDuration, this.transcodeBaseOffset + mediaDuration);
        }
        return 0;
    }

    isBufferedAtAbsoluteTime(targetSeconds, padding = 1.5) {
        if (!this.video || !this.video.buffered || this.video.buffered.length === 0) return false;
        const localTarget = Math.max(0, Number(targetSeconds || 0) - this.transcodeBaseOffset);
        for (let i = 0; i < this.video.buffered.length; i++) {
            const start = this.video.buffered.start(i) - padding;
            const end = this.video.buffered.end(i) + padding;
            if (localTarget >= start && localTarget <= end) return true;
        }
        return false;
    }

    async seekToAbsolute(targetSeconds) {
        if (!this.video) return;

        const duration = this.getSeekableDuration();
        const clampedTarget = Math.max(0, Math.min(Number(targetSeconds || 0), duration > 0 ? duration : Number(targetSeconds || 0)));
        const localTarget = Math.max(0, clampedTarget - this.transcodeBaseOffset);

        this.markIntentionalSeek(3000);

        const canSeekLocally = !this.currentSessionId ||
            Math.abs(localTarget - (this.video.currentTime || 0)) <= 20 ||
            this.isBufferedAtAbsoluteTime(clampedTarget);

        if (canSeekLocally) {
            const localDuration = Number(this.video.duration || 0);
            this.video.currentTime = Math.max(0, Math.min(localTarget, localDuration > 0 ? localDuration : localTarget));
            return;
        }

        if (this.sessionSeekInFlight || !this.currentSessionOptions) return;

        this.sessionSeekInFlight = true;
        this.showLoading();
        this.markSystemSeek(6000);
        try {
            const sessionOptions = { ...this.currentSessionOptions, seekOffset: Math.floor(clampedTarget) };
            await this.stopTranscodeSession();
            const playlistUrl = await this.startTranscodeSession(this.currentUrl, sessionOptions);
            this.playHls(playlistUrl);
            this.setVolumeFromStorage();
        } catch (err) {
            console.warn('[WatchPage] Session seek failed, falling back to local seek:', err.message);
            this.video.currentTime = Math.max(0, localTarget);
        } finally {
            this.sessionSeekInFlight = false;
        }
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
            if (Number.isFinite(n) && n > 0) return Math.floor(n);
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

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // === Loading Spinner ===

    showLoading() {
        this.loadingSpinner?.classList.add('show');
        this.centerPlayBtn?.classList.remove('show');
    }

    hideLoading() {
        this.loadingSpinner?.classList.remove('show');
    }

    resetAntiBufferState() {
        this.consecutiveStalls = 0;
        this.lastPlaybackTime = 0;
        this.lastPlaybackTickAt = Date.now();
        this.lastStallRecoverAt = 0;
        this.lastResolvedPlaybackUrl = null;
        this.lastObservedMediaTime = 0;
        this.lastObservedWallTime = 0;
        this.intentionalSeekUntil = 0;
        this.systemSeekUntil = 0;
        this.pendingUnexpectedSeekFrom = null;
        this.pendingUnexpectedSeekAt = 0;
    }

    markIntentionalSeek(windowMs = 2500) {
        this.intentionalSeekUntil = Date.now() + Math.max(500, windowMs);
    }

    markSystemSeek(windowMs = 2500) {
        this.systemSeekUntil = Date.now() + Math.max(500, windowMs);
    }

    isSeekExpected() {
        const now = Date.now();
        return now <= this.intentionalSeekUntil || now <= this.systemSeekUntil;
    }

    onVideoSeeking() {
        if (!this.video) return;

        if (this.isSeekExpected()) {
            this.pendingUnexpectedSeekFrom = null;
            this.pendingUnexpectedSeekAt = 0;
        } else {
            // Capture where the player was before an unexpected seek so we can validate the final jump.
            this.pendingUnexpectedSeekFrom = Number(this.lastObservedMediaTime || 0);
            this.pendingUnexpectedSeekAt = Date.now();
        }

        this.lastObservedMediaTime = this.video.currentTime || 0;
        this.lastObservedWallTime = Date.now();
    }

    onVideoSeeked() {
        if (!this.video) return;

        // Stall recovery and HLS media recovery can trigger legitimate internal seeks.
        // Give those a short grace window to avoid fighting the player.
        const now = Date.now();
        if (now - this.lastStallRecoverAt < 4500) {
            this.markSystemSeek(2500);
            this.pendingUnexpectedSeekFrom = null;
            this.pendingUnexpectedSeekAt = 0;
            this.lastObservedMediaTime = Number(this.video.currentTime || 0);
            this.lastObservedWallTime = now;
            return;
        }

        if (this.isSeekExpected()) {
            this.pendingUnexpectedSeekFrom = null;
            this.pendingUnexpectedSeekAt = 0;
            this.lastObservedMediaTime = Number(this.video.currentTime || 0);
            this.lastObservedWallTime = now;
            return;
        }

        if (!Number.isFinite(this.pendingUnexpectedSeekFrom)) {
            this.lastObservedMediaTime = Number(this.video.currentTime || 0);
            this.lastObservedWallTime = Date.now();
            return;
        }

        const from = Number(this.pendingUnexpectedSeekFrom || 0);
        const to = Number(this.video.currentTime || 0);
        const delta = to - from;
        const jumpedForward = delta > Math.max(12, this.maxUnexpectedJumpSeconds);
        const jumpedBack = delta < -12;

        this.pendingUnexpectedSeekFrom = null;
        this.pendingUnexpectedSeekAt = 0;

        if (!(jumpedForward || jumpedBack)) {
            this.lastObservedMediaTime = to;
            this.lastObservedWallTime = now;
            return;
        }

        const duration = Number(this.video.duration || 0);
        const safeTarget = Math.max(0, Math.min(
            from + 1,
            Number.isFinite(duration) && duration > 0 ? duration - 0.5 : from + 1
        ));

        console.warn(`[WatchPage] Reverting unexpected seek completion (${delta.toFixed(2)}s) to ${safeTarget.toFixed(2)}s`);
        this.markSystemSeek(1800);
        try {
            this.video.currentTime = safeTarget;
        } catch (err) {
            console.warn('[WatchPage] Failed to revert unexpected seek completion:', err.message);
        }
        this.lastObservedMediaTime = safeTarget;
        this.lastObservedWallTime = now;
    }

    enforceNormalPlaybackRate(force = false) {
        if (!this.video) return;

        const rate = Number(this.video.playbackRate);
        if (!Number.isFinite(rate)) return;
        if (Math.abs(rate - 1) < 0.001) return;

        const now = Date.now();
        if (!force && now - this.lastRateClampAt < 400) return;

        this.lastRateClampAt = now;
        console.warn(`[WatchPage] Correcting unexpected playbackRate ${rate} -> 1`);
        this.video.playbackRate = 1;
        this.video.defaultPlaybackRate = 1;
    }

    guardUnexpectedTimeJump() {
        if (!this.video || this.video.seeking || this.video.paused) return;

        const now = Date.now();
        const currentTime = Number(this.video.currentTime || 0);

        if (!this.lastObservedWallTime) {
            this.lastObservedWallTime = now;
            this.lastObservedMediaTime = currentTime;
            return;
        }

        const elapsedWall = Math.max(0.001, (now - this.lastObservedWallTime) / 1000);
        const deltaMedia = currentTime - this.lastObservedMediaTime;
        const expectedMaxForward = Math.max(6, elapsedWall * 4 + 2);
        const jumpedForward = deltaMedia > Math.max(expectedMaxForward, this.maxUnexpectedJumpSeconds);
        const jumpedBack = deltaMedia < -12;

        if (!this.isSeekExpected() && (jumpedForward || jumpedBack)) {
            const safeTarget = Math.max(0, this.lastObservedMediaTime + Math.min(2, elapsedWall * 1.5));
            console.warn(`[WatchPage] Reverting unexpected time jump (${deltaMedia.toFixed(2)}s) to ${safeTarget.toFixed(2)}s`);
            this.markSystemSeek(1800);
            try {
                this.video.currentTime = safeTarget;
            } catch (err) {
                console.warn('[WatchPage] Failed to revert unexpected jump:', err.message);
            }
            this.lastObservedMediaTime = safeTarget;
            this.lastObservedWallTime = now;
            return;
        }

        this.lastObservedMediaTime = currentTime;
        this.lastObservedWallTime = now;
    }

    startPlaybackHealthMonitor() {
        this.stopPlaybackHealthMonitor();
        this.lastPlaybackTickAt = Date.now();
        this.lastPlaybackTime = this.video?.currentTime || 0;

        this.playbackHealthInterval = setInterval(() => {
            if (!this.video || this.video.paused || this.video.ended || this.video.seeking) return;

            const now = Date.now();
            const currentTime = this.video.currentTime || 0;
            const moved = Math.abs(currentTime - this.lastPlaybackTime) >= 0.1;
            const frozenTooLong = !moved && now - this.lastPlaybackTickAt > 3500;
            const lowReadyState = this.video.readyState <= 2;

            if (lowReadyState || frozenTooLong) {
                this.handlePlaybackStall(lowReadyState ? 'health_low_ready_state' : 'health_frozen_playhead');
                return;
            }

            this.markPlaybackHealthy();
        }, 1500);
    }

    stopPlaybackHealthMonitor() {
        if (this.playbackHealthInterval) {
            clearInterval(this.playbackHealthInterval);
            this.playbackHealthInterval = null;
        }
    }

    markPlaybackHealthy() {
        if (!this.video || this.video.paused || this.video.seeking) return;

        const now = Date.now();
        const currentTime = this.video.currentTime || 0;

        if (Math.abs(currentTime - this.lastPlaybackTime) >= 0.1) {
            this.lastPlaybackTime = currentTime;
            this.lastPlaybackTickAt = now;
            if (this.consecutiveStalls > 0 && (now - this.lastStallRecoverAt > 1500)) {
                this.consecutiveStalls -= 1;
            }
        }
    }

    getBufferedAhead() {
        if (!this.video || !this.video.buffered || this.video.buffered.length === 0) return 0;

        const t = this.video.currentTime;
        for (let i = 0; i < this.video.buffered.length; i++) {
            const start = this.video.buffered.start(i);
            const end = this.video.buffered.end(i);
            if (t >= start && t <= end) {
                return Math.max(0, end - t);
            }
        }

        return 0;
    }

    handlePlaybackStall(reason) {
        if (!this.video || this.video.paused || this.video.seeking) return;

        const now = Date.now();
        if (now - this.lastStallRecoverAt < 1000) return;

        this.lastStallRecoverAt = now;
        this.consecutiveStalls = Math.min(this.consecutiveStalls + 1, 8);
        console.warn(`[WatchPage] Stall detected (${reason}), attempt ${this.consecutiveStalls}`);

        if (this.stallRecoveryTimeout) {
            clearTimeout(this.stallRecoveryTimeout);
        }

        this.stallRecoveryTimeout = setTimeout(() => this.runStallRecovery(), 200);
    }

    runStallRecovery() {
        if (!this.video || this.video.paused || this.video.seeking) return;

        const bufferedAhead = this.getBufferedAhead();
        if (bufferedAhead > 0.75) {
            const nudge = Math.min(0.35, bufferedAhead - 0.25);
            if (nudge > 0.05) {
                try {
                    this.markSystemSeek(2000);
                    this.video.currentTime += nudge;
                } catch (e) {
                    console.warn('[WatchPage] Stall nudge failed:', e.message);
                }
            }
        }

        if (!this.hls) return;

        if (this.consecutiveStalls >= 2 && this.hls.autoLevelEnabled) {
            const currentLevel = this.hls.nextAutoLevel >= 0 ? this.hls.nextAutoLevel : this.hls.currentLevel;
            if (currentLevel > 0) {
                this.hls.nextLevel = currentLevel - 1;
                console.log(`[WatchPage] Lowering quality to level ${currentLevel - 1} to reduce buffering`);
            }
        }

        if (this.consecutiveStalls >= 3) {
            this.markSystemSeek(3000);
            this.hls.recoverMediaError();
        }

        const reloadFrom = Math.max((this.video.currentTime || 0) - 1, 0);
        this.markSystemSeek(4000);
        this.hls.startLoad(reloadFrom);

        if (this.consecutiveStalls >= 5 && this.lastResolvedPlaybackUrl) {
            console.warn('[WatchPage] Reinitializing HLS player after repeated stalls');
            const isSessionPlayback = this.isTranscodePlaylistUrl(this.lastResolvedPlaybackUrl);
            if (isSessionPlayback && this.currentSessionId && this.currentSessionOptions) {
                this.restartCurrentTranscodeSession('repeated_stalls');
            } else {
                this.playHls(this.lastResolvedPlaybackUrl);
            }
        }
    }

    // === Captions ===

    toggleCaptionsMenu() {
        if (this.captionsMenuOpen) {
            this.closeCaptionsMenu();
        } else {
            this.updateCaptionsTracks();
            this.captionsMenu?.classList.remove('hidden');
            this.captionsMenuOpen = true;
        }
    }

    closeCaptionsMenu() {
        this.captionsMenu?.classList.add('hidden');
        this.captionsMenuOpen = false;
    }

    updateCaptionsTracks() {
        if (!this.captionsList || !this.video) return;

        // Build list of available text tracks
        const tracks = this.video.textTracks;
        let html = '<button class="captions-option" data-index="-1">Off</button>';

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                const label = track.label || track.language || `Track ${i + 1}`;
                const isActive = track.mode === 'showing';
                html += `<button class="captions-option ${isActive ? 'active' : ''}" data-index="${i}">${label}</button>`;
            }
        }

        // Check if any track is active, if not mark "Off" as active
        let anyActive = false;
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].mode === 'showing') anyActive = true;
        }
        if (!anyActive) {
            html = html.replace('class="captions-option"', 'class="captions-option active"');
        }

        this.captionsList.innerHTML = html;

        // Add click handlers
        this.captionsList.querySelectorAll('.captions-option').forEach(btn => {
            btn.addEventListener('click', () => this.selectCaptionTrack(parseInt(btn.dataset.index)));
        });
    }

    selectCaptionTrack(index) {
        if (!this.video) return;

        const tracks = this.video.textTracks;

        // Disable all tracks
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'hidden';
        }

        // Enable selected track
        if (index >= 0 && index < tracks.length) {
            tracks[index].mode = 'showing';
        }

        // Update UI
        this.updateCaptionsTracks();
        this.closeCaptionsMenu();
    }

    // === Overlay Auto-Hide ===

    showOverlay() {
        this.overlay?.classList.remove('hidden');
        this.overlayVisible = true;
        this.startOverlayTimer();
    }

    hideOverlay() {
        if (!this.video?.paused) {
            this.overlay?.classList.add('hidden');
            this.overlayVisible = false;
        }
    }

    startOverlayTimer() {
        clearTimeout(this.overlayTimeout);
        this.overlayTimeout = setTimeout(() => this.hideOverlay(), 3000);
    }

    // === Keyboard Shortcuts ===

    handleKeyboard(e) {
        // Only handle when watch page is active
        const watchPage = document.getElementById('page-watch');
        if (!watchPage?.classList.contains('active')) return;

        // Don't handle if typing in input
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                this.togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (e.repeat) break;
                this.skip(-10);
                this.showOverlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (e.repeat) break;
                this.skip(10);
                this.showOverlay();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.setVolume(Math.min(100, parseInt(this.volumeSlider.value) + 10));
                this.volumeSlider.value = Math.min(100, parseInt(this.volumeSlider.value) + 10);
                this.showOverlay();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.setVolume(Math.max(0, parseInt(this.volumeSlider.value) - 10));
                this.volumeSlider.value = Math.max(0, parseInt(this.volumeSlider.value) - 10);
                this.showOverlay();
                break;
            case 'f':
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case 'm':
                e.preventDefault();
                this.toggleMute();
                this.showOverlay();
                break;
            case 'Escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    this.goBack();
                }
                break;
        }
    }

    // === Details Section ===

    renderDetails() {
        if (!this.content) return;

        const isChannel = this.content.type === 'channel' || !this.content.type; // Default to channel if unknown
        const fallback = isChannel ? '/img/LurkedTV.png' : '/img/LurkedTV.png';

        this.posterEl.onerror = () => {
            this.posterEl.onerror = null;
            this.posterEl.src = fallback;
        };
        this.posterEl.src = this.content.poster || fallback;
        this.posterEl.alt = this.content.title || '';
        this.contentTitleEl.textContent = this.content.title || '';
        this.yearEl.textContent = this.content.year || '';
        this.ratingEl.textContent = this.content.rating ? `★ ${this.content.rating}` : '';
        this.descriptionEl.textContent = this.content.description || '';

        if (this.playBtnText) this.playBtnText.textContent = 'Play';
        this.restartBtn?.classList.add('hidden');
    }

    async checkFavorite() {
        if (!this.content) return;

        try {
            const itemId = this.contentType === 'movie' ? this.content.id : this.content.seriesId;
            const itemType = this.contentType === 'movie' ? 'movie' : 'series';
            const result = await API.favorites.check(this.content.sourceId, itemId, itemType);
            this.isFavorite = result?.isFavorite || false;
            this.updateFavoriteUI();
        } catch (e) {
            console.warn('Could not check favorite status');
        }
    }

    async toggleFavorite() {
        if (!this.content) return;

        const itemId = this.contentType === 'movie' ? this.content.id : this.content.seriesId;
        const itemType = this.contentType === 'movie' ? 'movie' : 'series';

        try {
            if (this.isFavorite) {
                await API.favorites.remove(this.content.sourceId, itemId, itemType);
                this.isFavorite = false;
            } else {
                await API.favorites.add(this.content.sourceId, itemId, itemType);
                this.isFavorite = true;
            }
            this.updateFavoriteUI();
        } catch (e) {
            console.error('Error toggling favorite:', e);
        }
    }

    updateFavoriteUI() {
        const outlineIcon = this.favoriteBtn?.querySelector('.icon-fav-outline');
        const filledIcon = this.favoriteBtn?.querySelector('.icon-fav-filled');

        outlineIcon?.classList.toggle('hidden', this.isFavorite);
        filledIcon?.classList.toggle('hidden', !this.isFavorite);
    }

    scrollToVideo() {
        document.getElementById('page-watch')?.scrollTo({ top: 0, behavior: 'smooth' });
        if (this.video?.paused) {
            this.video.play().catch(console.error);
        }
    }

    handlePlayAction() {
        this.scrollToVideo();
    }

    restartFromBeginning() {
        this.scrollToVideo();

        if (this.video) {
            this.markIntentionalSeek(3000);
            this.video.currentTime = 0;
            this.video.play().catch(console.error);
        }

        if (this.playBtnText) {
            this.playBtnText.textContent = 'Play';
        }
        this.restartBtn?.classList.add('hidden');
    }

    // === Recommended Movies ===

    async loadRecommended(sourceId, categoryId) {
        if (!sourceId || !categoryId) {
            this.recommendedSection?.classList.add('hidden');
            return;
        }

        try {
            const movies = await API.proxy.xtream.vodStreams(sourceId, categoryId);
            if (!movies || movies.length === 0) {
                this.recommendedSection?.classList.add('hidden');
                return;
            }

            // Filter out current movie, take first 12
            const filtered = movies
                .filter(m => m.stream_id !== this.content?.id)
                .slice(0, 12);

            this.renderRecommendedGrid(filtered, sourceId);
        } catch (e) {
            console.error('Error loading recommended:', e);
            this.recommendedSection?.classList.add('hidden');
        }
    }

    renderRecommendedGrid(movies, sourceId) {
        if (!this.recommendedGrid) return;

        this.recommendedGrid.innerHTML = movies.map(movie => `
            <div class="watch-recommended-card" data-id="${movie.stream_id}" data-source="${sourceId}">
                <img src="${movie.stream_icon || movie.cover || '/img/LurkedTV.png'}" 
                     alt="${movie.name}" 
                     onerror="this.onerror=null;this.src='/img/LurkedTV.png'" loading="lazy">
                <p>${movie.name}</p>
            </div>
        `).join('');

        // Click handlers
        this.recommendedGrid.querySelectorAll('.watch-recommended-card').forEach(card => {
            card.addEventListener('click', () => this.playRecommendedMovie(card.dataset.id, parseInt(card.dataset.source)));
        });
    }

    async playRecommendedMovie(streamId, sourceId) {
        try {
            // Fetch movie details
            const movies = await API.proxy.xtream.vodStreams(sourceId);
            const movie = movies?.find(m => m.stream_id == streamId);

            if (!movie) return;

            const container = movie.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(sourceId, streamId, 'movie', container);

            if (result?.url) {
                this.play({
                    type: 'movie',
                    id: movie.stream_id,
                    title: movie.name,
                    poster: movie.stream_icon || movie.cover,
                    description: movie.plot || '',
                    year: movie.year,
                    rating: movie.rating,
                    duration: movie.duration || movie.runtime || '',
                    sourceId: sourceId,
                    categoryId: movie.category_id
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing recommended movie:', e);
        }
    }

    // === Series Episodes ===

    renderEpisodes() {
        if (!this.seriesInfo?.episodes || !this.seasonsContainer) return;

        const seasons = Object.keys(this.seriesInfo.episodes).sort((a, b) => parseInt(a) - parseInt(b));

        this.seasonsContainer.innerHTML = seasons.map(seasonNum => {
            const episodes = this.seriesInfo.episodes[seasonNum];
            const isCurrentSeason = parseInt(seasonNum) === parseInt(this.currentSeason);

            return `
                <div class="watch-season-group">
                    <div class="watch-season-header ${isCurrentSeason ? '' : 'collapsed'}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                        </svg>
                        <span class="watch-season-name">Season ${seasonNum}</span>
                        <span class="watch-season-count">${episodes.length} episodes</span>
                    </div>
                    <div class="watch-episode-list">
                        ${episodes.map(ep => {
                const isActive = parseInt(seasonNum) === parseInt(this.currentSeason) &&
                    parseInt(ep.episode_num) === parseInt(this.currentEpisode);
                return `
                                <div class="watch-episode-item ${isActive ? 'active' : ''}" 
                                     data-episode-id="${ep.id}" 
                                     data-season="${seasonNum}"
                                     data-episode="${ep.episode_num}"
                                     data-container="${ep.container_extension || 'mp4'}">
                                    <span class="watch-episode-num">E${ep.episode_num}</span>
                                    <span class="watch-episode-title">${ep.title || `Episode ${ep.episode_num}`}</span>
                                    <span class="watch-episode-duration">${ep.duration || ''}</span>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        }).join('');

        // Season header toggle
        this.seasonsContainer.querySelectorAll('.watch-season-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
            });
        });

        // Episode click handlers
        this.seasonsContainer.querySelectorAll('.watch-episode-item').forEach(ep => {
            ep.addEventListener('click', () => this.playEpisodeFromList(ep));
        });
    }

    async playEpisodeFromList(episodeEl) {
        const episodeId = episodeEl.dataset.episodeId;
        const seasonNum = episodeEl.dataset.season;
        const episodeNum = episodeEl.dataset.episode;
        const container = episodeEl.dataset.container || 'mp4';

        try {
            const result = await API.proxy.xtream.getStreamUrl(this.content.sourceId, episodeId, 'series', container);

            if (result?.url) {
                const episodeTitle = episodeEl.querySelector('.watch-episode-title')?.textContent || `Episode ${episodeNum}`;

                this.play({
                    type: 'series',
                    id: episodeId,
                    title: this.content.title,
                    subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                    poster: this.content.poster,
                    description: this.content.description,
                    year: this.content.year,
                    rating: this.content.rating,
                    duration: episodeEl.querySelector('.watch-episode-duration')?.textContent?.trim() || '',
                    sourceId: this.content.sourceId,
                    seriesId: this.content.seriesId,
                    seriesInfo: this.seriesInfo,
                    currentSeason: seasonNum,
                    currentEpisode: episodeNum
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing episode:', e);
        }
    }

    // === Next Episode ===

    getNextEpisode() {
        if (!this.seriesInfo?.episodes || !this.currentSeason || !this.currentEpisode) return null;

        const seasons = Object.keys(this.seriesInfo.episodes).sort((a, b) => parseInt(a) - parseInt(b));
        const currentSeasonEpisodes = this.seriesInfo.episodes[this.currentSeason] || [];

        // Find next episode in current season
        const currentEpIndex = currentSeasonEpisodes.findIndex(ep =>
            parseInt(ep.episode_num) === parseInt(this.currentEpisode)
        );

        if (currentEpIndex >= 0 && currentEpIndex < currentSeasonEpisodes.length - 1) {
            return {
                ...currentSeasonEpisodes[currentEpIndex + 1],
                seasonNum: this.currentSeason
            };
        }

        // Try next season
        const currentSeasonIndex = seasons.indexOf(String(this.currentSeason));
        if (currentSeasonIndex >= 0 && currentSeasonIndex < seasons.length - 1) {
            const nextSeason = seasons[currentSeasonIndex + 1];
            const nextSeasonEpisodes = this.seriesInfo.episodes[nextSeason];
            if (nextSeasonEpisodes?.length > 0) {
                return {
                    ...nextSeasonEpisodes[0],
                    seasonNum: nextSeason
                };
            }
        }

        return null;
    }

    showNextEpisodePanel(nextEp) {
        if (!this.nextEpisodePanel) return;

        this.nextEpisodeTitle.textContent = `S${nextEp.seasonNum} E${nextEp.episode_num} - ${nextEp.title || `Episode ${nextEp.episode_num}`}`;
        this.nextEpisodePanel.classList.remove('hidden');
        this.nextEpisodePanel.nextEpisodeData = nextEp;

        // Start countdown
        this.nextEpisodeCountdown = 10;
        this.nextCountdown.textContent = this.nextEpisodeCountdown;

        this.nextEpisodeInterval = setInterval(() => {
            this.nextEpisodeCountdown--;
            this.nextCountdown.textContent = this.nextEpisodeCountdown;

            if (this.nextEpisodeCountdown <= 0) {
                this.playNextEpisode();
            }
        }, 1000);
    }

    async playNextEpisode() {
        // Save next episode data BEFORE canceling (cancel clears the data)
        const nextEp = this.nextEpisodePanel?.nextEpisodeData;

        this.cancelNextEpisode();

        if (!nextEp) return;

        try {
            const container = nextEp.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(this.content.sourceId, nextEp.id, 'series', container);

            if (result?.url) {
                this.play({
                    type: 'series',
                    id: nextEp.id,
                    title: this.content.title,
                    subtitle: `S${nextEp.seasonNum} E${nextEp.episode_num} - ${nextEp.title || `Episode ${nextEp.episode_num}`}`,
                    poster: this.content.poster,
                    description: this.content.description,
                    year: this.content.year,
                    rating: this.content.rating,
                    duration: nextEp.duration || '',
                    sourceId: this.content.sourceId,
                    seriesId: this.content.seriesId,
                    seriesInfo: this.seriesInfo,
                    currentSeason: nextEp.seasonNum,
                    currentEpisode: nextEp.episode_num
                }, result.url);
            }
        } catch (e) {
            console.error('Error playing next episode:', e);
        }
    }

    cancelNextEpisode() {
        clearInterval(this.nextEpisodeInterval);
        this.nextEpisodePanel?.classList.add('hidden');
        this.nextEpisodeShowing = false;
        this.nextEpisodeDismissed = true; // Prevent re-triggering
        if (this.nextEpisodePanel) {
            this.nextEpisodePanel.nextEpisodeData = null;
        }
    }

    // === Navigation ===

    goBack() {
        this.stop();
        this.cancelNextEpisode();

        // Navigate to the page we came from (stored in returnPage)
        // We don't use history.back() because we used replaceHistory when navigating here
        this.app.navigateTo(this.returnPage || 'movies');
    }

    show() {
        // Called when page becomes visible
    }

    hide() {
        // Called when page becomes hidden
        // Don't stop playback here - allow background playback
        this.cancelNextEpisode();
    }
}

window.WatchPage = WatchPage;

