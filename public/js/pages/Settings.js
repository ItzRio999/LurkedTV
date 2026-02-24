/**
 * Settings Page Controller
 */

class SettingsPage {
    constructor(app) {
        this.app = app;
        this.tabs = document.querySelectorAll('.tabs .tab');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.discordBotStatusTimer = null;
        this.discordBotConfigLoaded = false;

        this.init();
    }

    init() {
        // Tab switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Player settings
        this.initPlayerSettings();

        // Transcoding settings
        this.initTranscodingSettings();

        // User management (admin only)
        this.initUserManagement();
        this.initDiscordBotAdmin();

        // Firebase media cache controls
        this.initFirebaseCacheControls();

        // Account settings for all users
        this.initAccountSettings();
    }

    initDiscordBotAdmin() {
        const refreshBtn = document.getElementById('discord-bot-refresh-btn');
        const form = document.getElementById('discord-bot-config-form');

        refreshBtn?.addEventListener('click', async () => {
            await this.loadDiscordBotStatus(true);
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const feedback = document.getElementById('discord-bot-status-feedback');
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn?.textContent || 'Save Bot Config';

            const payload = {
                prefix: document.getElementById('discord-bot-prefix')?.value || '!',
                guildId: document.getElementById('discord-bot-guild-id')?.value || '',
                adminRoleId: document.getElementById('discord-bot-admin-role-id')?.value || '',
                logChannelId: document.getElementById('discord-bot-log-channel-id')?.value || '',
                activeWindowMs: Number(document.getElementById('discord-bot-active-window-ms')?.value || 300000),
                commandDedupeWindowMs: Number(document.getElementById('discord-bot-dedupe-window-ms')?.value || 15000)
            };

            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Saving...';
                }
                if (feedback) feedback.textContent = 'Saving Discord bot config...';

                await API.settings.updateDiscordBotConfig(payload);
                if (feedback) feedback.textContent = 'Discord bot config saved.';
                this.showToast('Discord bot config updated.', 'success');
                await this.loadDiscordBotStatus();
            } catch (err) {
                if (feedback) feedback.textContent = `Failed to save config: ${err.message}`;
                this.showToast('Failed to save Discord bot config.', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
            }
        });
    }

    setDiscordBotStatusText(id, text, ok = null) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.style.color = ok === true
            ? 'var(--color-success)'
            : (ok === false ? 'var(--color-error)' : 'var(--color-text-muted)');
    }

    formatAge(ms) {
        if (!Number.isFinite(ms) || ms < 0) return 'unknown';
        if (ms < 1000) return `${Math.floor(ms)}ms`;
        if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
        return `${Math.floor(ms / 60000)}m`;
    }

    formatDuration(ms) {
        if (!Number.isFinite(ms) || ms < 0) return 'unknown';
        const totalSeconds = Math.floor(ms / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    async loadDiscordBotStatus(showToastOnError = false) {
        const feedback = document.getElementById('discord-bot-status-feedback');
        try {
            const data = await API.settings.getDiscordBotStatus();
            const config = data?.config || {};
            const monitor = data?.monitor || {};
            const heartbeat = monitor.heartbeat || {};

            if (!this.discordBotConfigLoaded) {
                const prefixInput = document.getElementById('discord-bot-prefix');
                const guildInput = document.getElementById('discord-bot-guild-id');
                const roleInput = document.getElementById('discord-bot-admin-role-id');
                const logChannelInput = document.getElementById('discord-bot-log-channel-id');
                const activeInput = document.getElementById('discord-bot-active-window-ms');
                const dedupeInput = document.getElementById('discord-bot-dedupe-window-ms');
                if (prefixInput) prefixInput.value = config.prefix || '!';
                if (guildInput) guildInput.value = config.guildId || '';
                if (roleInput) roleInput.value = config.adminRoleId || '';
                if (logChannelInput) logChannelInput.value = config.logChannelId || '';
                if (activeInput) activeInput.value = Number(config.activeWindowMs || 300000);
                if (dedupeInput) dedupeInput.value = Number(config.commandDedupeWindowMs || 15000);
                this.discordBotConfigLoaded = true;
            }

            this.setDiscordBotStatusText(
                'discord-bot-heartbeat-status',
                heartbeat.online
                    ? `Online (${this.formatAge(heartbeat.ageMs)} ago)`
                    : (heartbeat.lastSeenAt ? `Offline (${this.formatAge(heartbeat.ageMs)} ago)` : 'No heartbeat yet'),
                heartbeat.online
            );

            const uptimeMs = Number(heartbeat.uptimeMs || 0);
            const uptimeText = uptimeMs > 0
                ? this.formatDuration(uptimeMs)
                : (heartbeat.lastSeenAt ? 'Unknown (not reported)' : 'No data yet');
            this.setDiscordBotStatusText(
                'discord-bot-uptime-status',
                uptimeText,
                heartbeat.online ? true : null
            );

            const identityOk = !!monitor?.botIdentity?.ok;
            this.setDiscordBotStatusText(
                'discord-bot-identity-status',
                identityOk
                    ? `${monitor.botIdentity.tag || 'Bot'} (${monitor.botIdentity.id || ''})`
                    : `Not reachable${monitor?.botIdentity?.error ? `: ${monitor.botIdentity.error}` : ''}`,
                identityOk
            );

            const guildOk = !!monitor?.guildStatus?.ok;
            this.setDiscordBotStatusText(
                'discord-bot-guild-status',
                guildOk
                    ? `${monitor.guildStatus.name || 'Guild'} (${monitor.guildStatus.id || ''})`
                    : `Not connected${monitor?.guildStatus?.error ? `: ${monitor.guildStatus.error}` : ''}`,
                guildOk
            );

            const roleOk = !!monitor?.roleStatus?.ok;
            this.setDiscordBotStatusText(
                'discord-bot-role-status',
                roleOk
                    ? `${monitor.roleStatus.name || 'Role'} (${monitor.roleStatus.id || ''})`
                    : `Missing${monitor?.roleStatus?.error ? `: ${monitor.roleStatus.error}` : ''}`,
                roleOk
            );

            if (feedback) {
                feedback.textContent = `Config prefix ${config.prefix || '!'} | Guild ${config.guildId || 'unset'} | Role ${config.adminRoleId || 'unset'} | Log channel ${config.logChannelId || 'unset'}`;
            }
        } catch (err) {
            console.error('Failed to load Discord bot status:', err);
            this.setDiscordBotStatusText('discord-bot-heartbeat-status', 'Unavailable', false);
            this.setDiscordBotStatusText('discord-bot-uptime-status', 'Unavailable', false);
            this.setDiscordBotStatusText('discord-bot-identity-status', 'Unavailable', false);
            this.setDiscordBotStatusText('discord-bot-guild-status', 'Unavailable', false);
            this.setDiscordBotStatusText('discord-bot-role-status', 'Unavailable', false);
            if (feedback) feedback.textContent = `Failed to load bot status: ${err.message}`;
            if (showToastOnError) this.showToast('Failed to load Discord bot status.', 'error');
        }
    }

    startDiscordBotStatusPolling() {
        this.stopDiscordBotStatusPolling();
        this.loadDiscordBotStatus();
        this.discordBotStatusTimer = setInterval(() => {
            this.loadDiscordBotStatus();
        }, 15000);
    }

    stopDiscordBotStatusPolling() {
        if (this.discordBotStatusTimer) {
            clearInterval(this.discordBotStatusTimer);
            this.discordBotStatusTimer = null;
        }
    }

    showToast(message, type = 'success', duration = 3200) {
        const container = document.getElementById('toast-container');
        if (!container || !message) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 220);
        }, duration);
    }

    initAccountSettings() {
        const languageSelect = document.getElementById('setting-default-language');
        const usernameForm = document.getElementById('account-username-form');
        const usernameInput = document.getElementById('setting-new-username');
        const usernameFeedback = document.getElementById('account-username-feedback');
        const passwordForm = document.getElementById('account-password-form');
        const feedback = document.getElementById('account-password-feedback');
        const discordActionBtn = document.getElementById('account-discord-action-btn');
        const discordFeedback = document.getElementById('account-discord-feedback');

        languageSelect?.addEventListener('change', async () => {
            try {
                const value = languageSelect.value || '';
                const updatedUser = await API.account.updatePreferences({ defaultLanguage: value });
                this.app.currentUser = updatedUser;
                this.app.updateNavbarProfileVisuals?.(updatedUser);
                this.applyDefaultLanguagePreference(updatedUser.defaultLanguage || '');
            } catch (err) {
                alert(`Failed to save default language: ${err.message}`);
            }
        });

        usernameForm?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const requested = String(usernameInput?.value || '').trim();
            if (!requested) {
                if (usernameFeedback) usernameFeedback.textContent = 'Username is required.';
                return;
            }
            if (requested.length < 3 || requested.length > 32) {
                if (usernameFeedback) usernameFeedback.textContent = 'Username must be 3-32 characters long.';
                return;
            }
            if (!/^[A-Za-z0-9_.-]+$/.test(requested)) {
                if (usernameFeedback) usernameFeedback.textContent = 'Use letters, numbers, dot, underscore, or dash only.';
                return;
            }

            if (usernameFeedback) usernameFeedback.textContent = 'Updating username...';
            try {
                const updatedUser = await API.account.changeUsername({ username: requested });
                this.app.currentUser = updatedUser;
                this.app.updateNavbarProfileVisuals?.(updatedUser);
                if (usernameInput) usernameInput.value = updatedUser.username || '';

                const usernameEl = document.getElementById('account-username');
                if (usernameEl) usernameEl.textContent = updatedUser.username || '-';

                if (usernameFeedback) usernameFeedback.textContent = 'Username updated successfully.';
                this.showToast('Username updated.', 'success');
            } catch (err) {
                if (usernameFeedback) usernameFeedback.textContent = `Username update failed: ${err.message}`;
            }
        });

        passwordForm?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const currentPassword = document.getElementById('setting-current-password')?.value || '';
            const newPassword = document.getElementById('setting-new-password')?.value || '';
            const confirmPassword = document.getElementById('setting-confirm-password')?.value || '';

            if (newPassword.length < 6) {
                if (feedback) feedback.textContent = 'New password must be at least 6 characters.';
                return;
            }

            if (newPassword !== confirmPassword) {
                if (feedback) feedback.textContent = 'New password and confirmation do not match.';
                return;
            }

            if (feedback) feedback.textContent = 'Updating password...';

            try {
                await API.account.changePassword({ currentPassword, newPassword });
                passwordForm.reset();
                if (feedback) feedback.textContent = 'Password updated successfully.';
            } catch (err) {
                if (feedback) feedback.textContent = `Password update failed: ${err.message}`;
            }
        });

        discordActionBtn?.addEventListener('click', async () => {
            const linked = !!this.app?.currentUser?.discordLinked;
            if (linked) {
                if (!window.confirm('Unlink your Discord account from this LurkedTV profile?')) return;
                try {
                    if (discordFeedback) discordFeedback.textContent = 'Unlinking Discord account...';
                    await API.account.unlinkDiscord();
                    await this.loadAccountSettings();
                    if (discordFeedback) discordFeedback.textContent = 'Discord account unlinked.';
                } catch (err) {
                    if (discordFeedback) discordFeedback.textContent = `Failed to unlink Discord: ${err.message}`;
                }
                return;
            }

            try {
                if (discordFeedback) discordFeedback.textContent = 'Redirecting to Discord...';
                const result = await API.account.startDiscordLink();
                if (!result?.url) throw new Error('Missing Discord authorization URL');
                window.location.href = result.url;
            } catch (err) {
                if (discordFeedback) discordFeedback.textContent = `Failed to start Discord link: ${err.message}`;
            }
        });
    }

    applyDefaultLanguagePreference(languageCode) {
        if (!languageCode) return;

        const moviesSelect = document.getElementById('movies-language-select');
        const seriesSelect = document.getElementById('series-language-select');

        if (moviesSelect && Array.from(moviesSelect.options).some(o => o.value === languageCode)) {
            moviesSelect.value = languageCode;
            moviesSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (seriesSelect && Array.from(seriesSelect.options).some(o => o.value === languageCode)) {
            seriesSelect.value = languageCode;
            seriesSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    async loadAccountSettings() {
        const usernameEl = document.getElementById('account-username');
        const usernameInput = document.getElementById('setting-new-username');
        const emailEl = document.getElementById('account-email');
        const badgeEl = document.getElementById('account-email-verified-badge');
        const languageSelect = document.getElementById('setting-default-language');
        const discordStatusEl = document.getElementById('account-discord-status');
        const discordActionBtn = document.getElementById('account-discord-action-btn');
        const discordFeedback = document.getElementById('account-discord-feedback');
        const discordCard = document.getElementById('account-discord-card');
        const discordAvatar = document.getElementById('account-discord-avatar');
        const discordName = document.getElementById('account-discord-name');
        const discordHandle = document.getElementById('account-discord-handle');
        const discordMemberStatus = document.getElementById('account-discord-member-status');

        try {
            const user = await API.account.getMe();
            this.app.currentUser = user;
            this.app.updateNavbarProfileVisuals?.(user);

            if (usernameEl) {
                usernameEl.textContent = user.username || '-';
            }
            if (usernameInput) {
                usernameInput.value = user.username || '';
            }

            if (emailEl) {
                emailEl.textContent = user.email || 'No email found';
            }

            if (badgeEl) {
                badgeEl.textContent = user.emailVerified ? 'Verified' : 'Unverified';
                badgeEl.classList.toggle('verified', !!user.emailVerified);
            }

            if (languageSelect) {
                languageSelect.value = user.defaultLanguage || '';
            }

            if (discordStatusEl) {
                discordStatusEl.textContent = user.discordLinked ? 'Linked' : 'Not linked';
            }

            const linked = !!user.discordLinked;
            if (discordCard) discordCard.classList.toggle('hidden', !linked);
            if (discordAvatar) {
                discordAvatar.src = linked && user.discordAvatarUrl ? user.discordAvatarUrl : '';
            }
            if (discordName) {
                discordName.textContent = linked ? (user.discordDisplayName || user.discordUsername || 'Discord User') : 'Discord User';
            }
            if (discordHandle) {
                discordHandle.textContent = linked && user.discordUsername ? `@${user.discordUsername}` : '@username';
            }
            if (discordMemberStatus) {
                const memberLabel = user.discordMemberStatus === 'in_server'
                    ? 'Member status: In server'
                    : (user.discordMemberStatus === 'not_in_server' ? 'Member status: Not in server' : 'Member status: Unknown');
                discordMemberStatus.textContent = linked ? memberLabel : 'Status unknown';
            }

            if (discordActionBtn) {
                discordActionBtn.textContent = user.discordLinked ? 'Unlink Discord' : 'Link Discord';
                discordActionBtn.classList.toggle('btn-error', !!user.discordLinked);
                discordActionBtn.classList.toggle('btn-secondary', !user.discordLinked);
            }

            const query = new URLSearchParams(window.location.search);
            const discordStatus = query.get('discord');
            if (discordFeedback && discordStatus) {
                if (discordStatus === 'linked') {
                    discordFeedback.textContent = 'Discord account linked successfully.';
                    this.showToast('Discord linked successfully.', 'success');
                } else if (discordStatus === 'already_linked') {
                    discordFeedback.textContent = 'That Discord account is already linked to another LurkedTV user.';
                    this.showToast('That Discord account is already linked.', 'error');
                } else if (discordStatus.startsWith('link_failed')) {
                    discordFeedback.textContent = 'Discord linking failed. Please try again.';
                    this.showToast('Discord linking failed. Please try again.', 'error');
                }

                if (window.location.search.includes('discord=')) {
                    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
                    window.history.replaceState({}, document.title, cleanUrl);
                }
            }

            await this.updateAdminDashboardVisibility(user);
        } catch (err) {
            console.error('Error loading account settings:', err);
            if (usernameEl) usernameEl.textContent = 'Unable to load account';
            if (emailEl) emailEl.textContent = 'Unable to load account';
            if (badgeEl) {
                badgeEl.textContent = 'Unknown';
                badgeEl.classList.remove('verified');
            }
            if (discordStatusEl) discordStatusEl.textContent = 'Unknown';
            if (discordCard) discordCard.classList.add('hidden');
            await this.updateAdminDashboardVisibility(null);
        }
    }

    async updateAdminDashboardVisibility(user = this.app?.currentUser || null) {
        const usersTab = document.getElementById('users-tab');
        if (!usersTab) return;

        let isAdmin = false;
        if (user && typeof user.discordAdmin === 'boolean') {
            isAdmin = user.discordAdmin;
        } else if (user) {
            try {
                const status = await API.account.getDiscordAdminStatus();
                isAdmin = !!status?.isAdmin;
                this.app.currentUser = { ...this.app.currentUser, discordAdmin: isAdmin };
            } catch (err) {
                console.warn('Unable to verify Discord admin status:', err.message);
            }
        }

        usersTab.style.display = isAdmin ? 'block' : 'none';

        if (!isAdmin && document.getElementById('tab-users')?.classList.contains('active')) {
            this.switchTab('sources');
        }
    }

    initPlayerSettings() {
        const arrowKeysToggle = document.getElementById('setting-arrow-keys');
        const overlayDurationInput = document.getElementById('setting-overlay-duration');
        const defaultVolumeSlider = document.getElementById('setting-default-volume');
        const volumeValueDisplay = document.getElementById('volume-value');
        const rememberVolumeToggle = document.getElementById('setting-remember-volume');
        const autoPlayNextToggle = document.getElementById('setting-autoplay-next');

        // Load current settings
        if (this.app.player?.settings) {
            arrowKeysToggle.checked = this.app.player.settings.arrowKeysChangeChannel;
            overlayDurationInput.value = this.app.player.settings.overlayDuration;
            defaultVolumeSlider.value = this.app.player.settings.defaultVolume;
            volumeValueDisplay.textContent = this.app.player.settings.defaultVolume + '%';
            rememberVolumeToggle.checked = this.app.player.settings.rememberVolume;
            autoPlayNextToggle.checked = this.app.player.settings.autoPlayNextEpisode;
        }

        // Arrow keys toggle
        arrowKeysToggle.addEventListener('change', () => {
            this.app.player.settings.arrowKeysChangeChannel = arrowKeysToggle.checked;
            this.app.player.saveSettings();
        });

        // Overlay duration
        overlayDurationInput.addEventListener('change', () => {
            this.app.player.settings.overlayDuration = parseInt(overlayDurationInput.value) || 5;
            this.app.player.saveSettings();
        });

        // Default volume slider
        defaultVolumeSlider.addEventListener('input', () => {
            const value = defaultVolumeSlider.value;
            volumeValueDisplay.textContent = value + '%';
            this.app.player.settings.defaultVolume = parseInt(value);
            this.app.player.saveSettings();
        });

        // Remember volume toggle
        rememberVolumeToggle.addEventListener('change', () => {
            this.app.player.settings.rememberVolume = rememberVolumeToggle.checked;
            this.app.player.saveSettings();
        });

        // Auto-play next episode toggle
        autoPlayNextToggle.addEventListener('change', () => {
            this.app.player.settings.autoPlayNextEpisode = autoPlayNextToggle.checked;
            this.app.player.saveSettings();
        });

        // EPG refresh interval
        const epgRefreshSelect = document.getElementById('epg-refresh-interval');
        if (epgRefreshSelect && this.app.player?.settings) {
            // Load saved value from player settings
            epgRefreshSelect.value = this.app.player.settings.epgRefreshInterval || '24';

            // Save on change - server will restart its sync timer via PUT /api/settings
            epgRefreshSelect.addEventListener('change', () => {
                this.app.player.settings.epgRefreshInterval = epgRefreshSelect.value;
                this.app.player.saveSettings();
            });
        }

        // Update last refreshed display
        this.updateEpgLastRefreshed();
    }

    async initTranscodingSettings() {
        // Encoder settings
        const hwEncoderSelect = document.getElementById('setting-hw-encoder');
        const maxResolutionSelect = document.getElementById('setting-max-resolution');
        const qualitySelect = document.getElementById('setting-quality');
        const audioMixSelect = document.getElementById('setting-audio-mix');

        // Stream processing (use -tc suffix IDs from Transcoding tab)
        const forceProxyToggle = document.getElementById('setting-force-proxy-tc');
        const hagsEnabledToggle = document.getElementById('setting-hags-enabled');
        const autoTranscodeToggle = document.getElementById('setting-auto-transcode-tc');
        const forceTranscodeToggle = document.getElementById('setting-force-transcode-tc');
        const forceVideoTranscodeToggle = document.getElementById('setting-force-video-transcode-tc');
        const forceRemuxToggle = document.getElementById('setting-force-remux-tc');
        const streamFormatSelect = document.getElementById('setting-stream-format-tc');

        // User-Agent (Transcoding tab versions)
        const userAgentSelect = document.getElementById('setting-user-agent-tc');
        const userAgentCustomInput = document.getElementById('setting-user-agent-custom-tc');
        const customUaContainer = document.getElementById('custom-user-agent-container-tc');
        const autoOptimizeBtn = document.getElementById('auto-optimize-btn');
        const autoOptimizeFeedback = document.getElementById('auto-optimize-feedback');

        // Fetch settings directly from API to avoid race condition with VideoPlayer
        let s;
        try {
            s = await API.settings.get();
        } catch (err) {
            console.warn('[Settings] Failed to load settings from API, using player defaults:', err);
            s = this.app.player?.settings || {};
        }

        if (hwEncoderSelect) hwEncoderSelect.value = s.hwEncoder || 'auto';
        if (maxResolutionSelect) maxResolutionSelect.value = s.maxResolution || '1080p';
        if (qualitySelect) qualitySelect.value = s.quality || 'medium';
        if (forceProxyToggle) forceProxyToggle.checked = s.forceProxy === true;
        if (hagsEnabledToggle) hagsEnabledToggle.checked = s.hagsEnabled === true;
        if (autoTranscodeToggle) autoTranscodeToggle.checked = s.autoTranscode !== false;
        if (forceTranscodeToggle) forceTranscodeToggle.checked = s.forceTranscode === true;
        if (forceVideoTranscodeToggle) forceVideoTranscodeToggle.checked = s.forceVideoTranscode === true;
        if (forceRemuxToggle) forceRemuxToggle.checked = s.forceRemux || false;
        if (streamFormatSelect) streamFormatSelect.value = s.streamFormat || 'm3u8';
        if (userAgentSelect) userAgentSelect.value = s.userAgentPreset || 'chrome';
        if (userAgentCustomInput) userAgentCustomInput.value = s.userAgentCustom || '';
        if (customUaContainer) {
            customUaContainer.style.display = userAgentSelect?.value === 'custom' ? 'flex' : 'none';
        }

        // Event listeners for encoder settings
        hwEncoderSelect?.addEventListener('change', () => {
            this.app.player.settings.hwEncoder = hwEncoderSelect.value;
            this.app.player.saveSettings();
        });

        maxResolutionSelect?.addEventListener('change', () => {
            this.app.player.settings.maxResolution = maxResolutionSelect.value;
            this.app.player.saveSettings();
        });

        qualitySelect?.addEventListener('change', () => {
            this.app.player.settings.quality = qualitySelect.value;
            this.app.player.saveSettings();
        });

        // Audio Mix Preset
        if (audioMixSelect) {
            audioMixSelect.value = s.audioMixPreset || 'auto';
            audioMixSelect.addEventListener('change', () => {
                this.app.player.settings.audioMixPreset = audioMixSelect.value;
                this.app.player.saveSettings();
            });
        }

        // Upscaling Settings
        const upscaleEnabledToggle = document.getElementById('setting-upscale-enabled');
        const upscaleMethodSelect = document.getElementById('setting-upscale-method');
        const upscaleTargetSelect = document.getElementById('setting-upscale-target');
        const upscaleMethodContainer = document.getElementById('upscale-method-container');
        const upscaleTargetContainer = document.getElementById('upscale-target-container');

        // Helper to toggle upscale options visibility
        const toggleUpscaleOptions = (enabled) => {
            if (upscaleMethodContainer) upscaleMethodContainer.style.display = enabled ? 'flex' : 'none';
            if (upscaleTargetContainer) upscaleTargetContainer.style.display = enabled ? 'flex' : 'none';
        };

        // Load upscaling settings
        if (upscaleEnabledToggle) {
            upscaleEnabledToggle.checked = s.upscaleEnabled || false;
            toggleUpscaleOptions(upscaleEnabledToggle.checked);
        }
        if (upscaleMethodSelect) upscaleMethodSelect.value = s.upscaleMethod || 'hardware';
        if (upscaleTargetSelect) upscaleTargetSelect.value = s.upscaleTarget || '1080p';

        // Upscaling event handlers
        upscaleEnabledToggle?.addEventListener('change', () => {
            this.app.player.settings.upscaleEnabled = upscaleEnabledToggle.checked;
            this.app.player.saveSettings();
            toggleUpscaleOptions(upscaleEnabledToggle.checked);
        });

        upscaleMethodSelect?.addEventListener('change', () => {
            this.app.player.settings.upscaleMethod = upscaleMethodSelect.value;
            this.app.player.saveSettings();
        });

        upscaleTargetSelect?.addEventListener('change', () => {
            this.app.player.settings.upscaleTarget = upscaleTargetSelect.value;
            this.app.player.saveSettings();
        });

        // Stream processing toggles
        forceProxyToggle?.addEventListener('change', () => {
            this.app.player.settings.forceProxy = forceProxyToggle.checked;
            this.app.player.saveSettings();
        });

        hagsEnabledToggle?.addEventListener('change', () => {
            this.app.player.settings.hagsEnabled = hagsEnabledToggle.checked;
            this.app.player.saveSettings();
        });

        autoTranscodeToggle?.addEventListener('change', () => {
            this.app.player.settings.autoTranscode = autoTranscodeToggle.checked;
            this.app.player.saveSettings();
        });

        forceTranscodeToggle?.addEventListener('change', () => {
            this.app.player.settings.forceTranscode = forceTranscodeToggle.checked;
            this.app.player.saveSettings();
        });

        forceVideoTranscodeToggle?.addEventListener('change', () => {
            this.app.player.settings.forceVideoTranscode = forceVideoTranscodeToggle.checked;
            this.app.player.saveSettings();
        });

        forceRemuxToggle?.addEventListener('change', () => {
            this.app.player.settings.forceRemux = forceRemuxToggle.checked;
            this.app.player.saveSettings();
        });

        streamFormatSelect?.addEventListener('change', () => {
            this.app.player.settings.streamFormat = streamFormatSelect.value;
            this.app.player.saveSettings();
        });

        // Auto optimization button
        autoOptimizeBtn?.addEventListener('click', async () => {
            const originalText = autoOptimizeBtn.textContent;
            autoOptimizeBtn.disabled = true;
            autoOptimizeBtn.textContent = 'Optimizing...';
            if (autoOptimizeFeedback) autoOptimizeFeedback.textContent = 'Applying best settings for this device...';

            try {
                const result = await API.settings.applyAutoProfile({ refreshHardware: true, force: true });
                const applied = result?.settings || await API.settings.get();

                // Sync player runtime settings so playback uses new profile immediately.
                this.app.player.settings = { ...this.app.player.settings, ...applied };

                if (hwEncoderSelect) hwEncoderSelect.value = applied.hwEncoder || 'auto';
                if (maxResolutionSelect) maxResolutionSelect.value = applied.maxResolution || '1080p';
                if (qualitySelect) qualitySelect.value = applied.quality || 'medium';
                if (audioMixSelect) audioMixSelect.value = applied.audioMixPreset || 'auto';
                if (forceProxyToggle) forceProxyToggle.checked = applied.forceProxy === true;
                if (hagsEnabledToggle) hagsEnabledToggle.checked = applied.hagsEnabled === true;
                if (autoTranscodeToggle) autoTranscodeToggle.checked = applied.autoTranscode !== false;
                if (forceTranscodeToggle) forceTranscodeToggle.checked = applied.forceTranscode === true;
                if (forceVideoTranscodeToggle) forceVideoTranscodeToggle.checked = applied.forceVideoTranscode === true;
                if (forceRemuxToggle) forceRemuxToggle.checked = applied.forceRemux === true;
                if (streamFormatSelect) streamFormatSelect.value = applied.streamFormat || 'm3u8';
                if (upscaleEnabledToggle) upscaleEnabledToggle.checked = applied.upscaleEnabled === true;
                if (upscaleMethodSelect) upscaleMethodSelect.value = applied.upscaleMethod || 'hardware';
                if (upscaleTargetSelect) upscaleTargetSelect.value = applied.upscaleTarget || '1080p';
                toggleUpscaleOptions(!!applied.upscaleEnabled);

                await this.loadHardwareInfo();
                if (autoOptimizeFeedback) {
                    autoOptimizeFeedback.textContent = applied.autoProfileSummary || 'Optimization complete.';
                }
            } catch (err) {
                console.error('Auto optimization failed:', err);
                if (autoOptimizeFeedback) autoOptimizeFeedback.textContent = `Failed: ${err.message}`;
            } finally {
                autoOptimizeBtn.disabled = false;
                autoOptimizeBtn.textContent = originalText;
            }
        });

        // User-Agent handlers
        const toggleCustomInput = () => {
            if (customUaContainer) {
                customUaContainer.style.display = userAgentSelect?.value === 'custom' ? 'flex' : 'none';
            }
        };

        userAgentSelect?.addEventListener('change', () => {
            this.app.player.settings.userAgentPreset = userAgentSelect.value;
            this.app.player.saveSettings();
            toggleCustomInput();
        });

        userAgentCustomInput?.addEventListener('change', () => {
            this.app.player.settings.userAgentCustom = userAgentCustomInput.value;
            this.app.player.saveSettings();
        });
    }

    /**
     * Load and display hardware info in Transcoding tab
     */
async loadHardwareInfo() {
        const container = document.getElementById('hw-info-container');
        if (!container) return;

        try {
            const response = await fetch('/api/settings/hw-info');
            if (!response.ok) throw new Error('Failed to fetch hardware info');
            const hwInfo = await response.json();

            const detected = [];

            // Always show CPU for software/hybrid workflows.
            if (hwInfo.cpu?.available) {
                const cpuLabel = `${hwInfo.cpu.model || 'CPU'} (${hwInfo.cpu.physicalCores || '?'}C/${hwInfo.cpu.logicalThreads || '?'}T)`;
                detected.push(`<div class="hw-info-item hw-available">
                    <span class="hw-badge">CPU</span>
                    <span class="hw-name">${cpuLabel}</span>
                </div>`);
            }

            if (hwInfo.nvidia?.available) {
                detected.push(`<div class="hw-info-item hw-available">
                    <span class="hw-badge">NVIDIA</span>
                    <span class="hw-name">${hwInfo.nvidia.name}</span>
                </div>`);
            }

            if (hwInfo.amf?.available) {
                detected.push(`<div class="hw-info-item hw-available">
                    <span class="hw-badge">AMD</span>
                    <span class="hw-name">${hwInfo.amf.name || 'Available'}</span>
                </div>`);
            }

            if (hwInfo.qsv?.available) {
                detected.push(`<div class="hw-info-item hw-available">
                    <span class="hw-badge">Intel QSV</span>
                    <span class="hw-name">Available</span>
                </div>`);
            }

            if (hwInfo.vaapi?.available) {
                detected.push(`<div class="hw-info-item hw-available">
                    <span class="hw-badge">VAAPI</span>
                    <span class="hw-name">${hwInfo.vaapi.device || 'Available'}</span>
                </div>`);
            }

            let html = `<div class="hw-info-grid">${detected.join('')}</div>`;
            html += `<p class="hint" style="margin-top: var(--space-sm);">Recommended encoder: <strong>${hwInfo.recommended || 'software'}</strong></p>`;
            if (hwInfo.recommendedPipeline) {
                html += `<p class="hint">Pipeline: <strong>${hwInfo.recommendedPipeline}</strong> (GPU video + CPU demux/audio/filter threads when available)</p>`;
            }
            if (hwInfo.cpu?.recommendedThreads) {
                html += `<p class="hint">Recommended FFmpeg worker threads: <strong>${hwInfo.cpu.recommendedThreads}</strong></p>`;
            }

            container.innerHTML = html;
        } catch (err) {
            console.error('Error loading hardware info:', err);
            container.innerHTML = '<p class="hint error">Failed to load hardware info</p>';
        }
    }

    initUserManagement() {
        // User tab visibility is handled in show() method
        // when currentUser is available

        // Handle add user form
        const addUserForm = document.getElementById('add-user-form');
        if (addUserForm) {
            addUserForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const username = document.getElementById('new-username').value;
                const password = document.getElementById('new-password').value;
                const role = document.getElementById('new-role').value;
                const premium = document.getElementById('new-premium')?.checked === true;

                try {
                    await API.users.create({ username, password, role, premium });
                    alert('User created successfully!');
                    addUserForm.reset();
                    this.loadUsers();
                } catch (err) {
                    alert('Error creating user: ' + err.message);
                }
            });
        }
    }

    initFirebaseCacheControls() {
        const syncBtn = document.getElementById('firebase-cache-sync-btn');
        if (!syncBtn) return;

        syncBtn.addEventListener('click', async () => {
            const originalLabel = syncBtn.textContent;
            syncBtn.disabled = true;
            syncBtn.textContent = 'Syncing...';

            try {
                const result = await API.settings.syncFirebaseCache();
                if (result.started === false) {
                    alert(result.message || 'Firebase sync is already running.');
                }
                await this.updateEpgLastRefreshed();
            } catch (err) {
                alert(`Firebase cache sync failed: ${err.message}`);
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = originalLabel;
            }
        });
    }

    async loadUsers() {
        const userList = document.getElementById('user-list');
        const premiumUserList = document.getElementById('premium-user-list');
        if (!userList) return;

        try {
            const users = await API.users.getAll();
            // Store users in memory for easy access during edit
            this.users = users;

            if (users.length === 0) {
                userList.innerHTML = '<tr><td colspan="6" class="hint">No users found</td></tr>';
                if (premiumUserList) premiumUserList.innerHTML = '<tr><td colspan="4" class="hint">No users found</td></tr>';
                return;
            }

            userList.innerHTML = users.map(user => {
                const isSSO = !!user.oidcId;
                const typeBadge = isSSO
                    ? '<span class="user-badge user-badge-sso">SSO</span>'
                    : '<span class="user-badge user-badge-local">Local</span>';

                const roleBadge = user.role === 'admin'
                    ? '<span class="user-badge user-badge-admin">Admin</span>'
                    : '<span class="user-badge user-badge-viewer">Viewer</span>';
                const premiumBadge = user.premium
                    ? '<span class="user-badge user-badge-admin">Premium</span>'
                    : '<span class="user-badge user-badge-viewer">Standard</span>';

                return `
                <tr>
                    <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <strong>${user.username}</strong>
                            ${typeBadge}
                        </div>
                    </td>
                    <td>${user.email || '<span class="hint">-</span>'}</td>
                    <td>${roleBadge}</td>
                    <td>${premiumBadge}</td>
                    <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="window.app.pages.settings.openEditUserModal(${user.id})">Edit</button>
                        <button class="btn btn-sm btn-error" onclick="window.app.pages.settings.deleteUser(${user.id}, '${user.username}')">Delete</button>
                    </td>
                </tr>
            `}).join('');

            if (premiumUserList) {
                premiumUserList.innerHTML = users.map(user => {
                    const premiumLabel = user.premium
                        ? '<span class="user-badge user-badge-admin">Active</span>'
                        : '<span class="user-badge user-badge-viewer">Inactive</span>';
                    const actionLabel = user.premium ? 'Revoke Premium' : 'Grant Premium';
                    const actionClass = user.premium ? 'btn-error' : 'btn-primary';

                    return `
                    <tr>
                        <td><strong>${user.username}</strong></td>
                        <td>${user.email || '<span class="hint">-</span>'}</td>
                        <td>${premiumLabel}</td>
                        <td>
                            <button class="btn btn-sm ${actionClass}" onclick="window.app.pages.settings.setPremium(${user.id}, ${user.premium ? 'false' : 'true'})">${actionLabel}</button>
                        </td>
                    </tr>
                    `;
                }).join('');
            }
        } catch (err) {
            console.error('Error loading users:', err);
            userList.innerHTML = '<tr><td colspan="6" class="hint">Error loading users</td></tr>';
            if (premiumUserList) premiumUserList.innerHTML = '<tr><td colspan="4" class="hint">Error loading users</td></tr>';
        }
    }

    async setPremium(userId, premiumEnabled) {
        try {
            await API.users.update(userId, { premium: premiumEnabled === true });
            this.loadUsers();
        } catch (err) {
            alert('Error updating premium access: ' + err.message);
        }
    }

    openEditUserModal(userId) {
        console.log('openEditUserModal called with ID:', userId, 'Type:', typeof userId);
        console.log('Current users list:', this.users);

        const user = this.users.find(u => u.id === userId);
        if (!user) {
            console.error('User not found in this.users cache!');
            console.log('Available IDs:', this.users.map(u => u.id));
            return;
        }
        console.log('User found:', user);

        const modal = document.getElementById('edit-user-modal');
        console.log('Modal element:', modal);
        if (!modal) {
            console.error('CRITICAL: Modal element #edit-user-modal not found in DOM!');
            alert('Error: Modal not found. Please refresh the page.');
            return;
        }

        const isSSO = !!user.oidcId;
        console.log('Is SSO user:', isSSO);

        // Populate form with null checks
        try {
            const editId = document.getElementById('edit-user-id');
            const editUsername = document.getElementById('edit-username');
            const editEmail = document.getElementById('edit-email');
            const editRole = document.getElementById('edit-role');
            const editPremium = document.getElementById('edit-premium');
            const editPassword = document.getElementById('edit-password');

            console.log('Form elements found:', { editId, editUsername, editEmail, editRole, editPremium, editPassword });

            if (editId) editId.value = user.id;
            if (editUsername) editUsername.value = user.username;
            if (editEmail) editEmail.value = user.email || '';
            if (editRole) editRole.value = user.role;
            if (editPremium) editPremium.checked = user.premium === true;
            if (editPassword) editPassword.value = '';

            // Handle SSO specific UI
            const passwordHint = document.getElementById('edit-password-hint');
            const oidcGroup = document.getElementById('oidc-info-group');
            const oidcIdDisplay = document.getElementById('edit-oidc-id');

            if (isSSO) {
                if (editPassword) {
                    editPassword.disabled = true;
                    editPassword.placeholder = "Managed by SSO Provider";
                }
                if (passwordHint) passwordHint.textContent = "Password cannot be changed for SSO users.";
                if (oidcGroup) oidcGroup.classList.remove('hidden');
                if (oidcIdDisplay) oidcIdDisplay.textContent = user.oidcId;
            } else {
                if (editPassword) {
                    editPassword.disabled = false;
                    editPassword.placeholder = "Leave blank to keep current";
                }
                if (passwordHint) passwordHint.textContent = "Optional. Leave blank to keep unchanged.";
                if (oidcGroup) oidcGroup.classList.add('hidden');
            }

            // Show modal
            console.log('Adding active class to modal...');
            modal.classList.add('active');
            console.log('Modal classes after add:', modal.classList.toString());

            // Setup Close/Cancel handlers (once)
            this.setupModalHandlers(modal);
            console.log('Modal should now be visible!');
        } catch (err) {
            console.error('Error populating modal:', err);
            alert('Error opening edit modal: ' + err.message);
        }
    }

    setupModalHandlers(modal) {
        if (this.modalHandlersSetup) return;

        const closeBtn = document.getElementById('edit-user-close');
        const cancelBtn = document.getElementById('edit-user-cancel');
        const saveBtn = document.getElementById('edit-user-save');

        const closeModal = () => modal.classList.remove('active');

        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;

        // Click outside to close
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        // Save Handler
        saveBtn.onclick = async () => {
            const userId = document.getElementById('edit-user-id').value;
            const updates = {
                username: document.getElementById('edit-username').value,
                role: document.getElementById('edit-role').value,
                premium: document.getElementById('edit-premium')?.checked === true
            };

            const newPassword = document.getElementById('edit-password').value;
            if (newPassword && !document.getElementById('edit-password').disabled) {
                updates.password = newPassword;
            }

            try {
                await API.users.update(userId, updates);
                // alert('User updated successfully!'); // Optional: Replace with toast?
                closeModal();
                this.loadUsers();
            } catch (err) {
                alert('Error updating user: ' + err.message);
            }
        };

        this.modalHandlersSetup = true;
    }


    async deleteUser(userId, username) {
        if (!confirm(`Are you sure you want to delete user "${username}"?`)) {
            return;
        }

        try {
            await API.users.delete(userId);
            this.loadUsers();
        } catch (err) {
            alert('Error deleting user: ' + err.message);
        }
    }

    switchTab(tabName) {
        this.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        this.tabContents.forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));

        // Load content browser when switching to that tab
        if (tabName === 'content') {
            this.app.withGlobalLoading(
                () => this.app.sourceManager.loadContentSources(),
                'Loading content...'
            );
        }

        // Load users when switching to users tab
        if (tabName === 'users') {
            this.app.withGlobalLoading(
                () => this.loadUsers(),
                'Loading users...'
            );
            this.startDiscordBotStatusPolling();
        } else {
            this.stopDiscordBotStatusPolling();
        }

        // Load hardware info when switching to transcode tab
        if (tabName === 'transcode') {
            this.app.withGlobalLoading(
                () => this.loadHardwareInfo(),
                'Loading hardware info...'
            );
        }
    }

    async show() {
        // Load sources when page is shown
        await this.app.sourceManager.loadSources();
        await this.loadAccountSettings();

        // Refresh ALL player settings from server
        if (this.app.player?.settings) {
            const s = this.app.player.settings;

            // Player settings
            const arrowKeysToggle = document.getElementById('setting-arrow-keys');
            const overlayDurationInput = document.getElementById('setting-overlay-duration');
            const defaultVolumeSlider = document.getElementById('setting-default-volume');
            const volumeValueDisplay = document.getElementById('volume-value');
            const rememberVolumeToggle = document.getElementById('setting-remember-volume');
            const autoPlayNextToggle = document.getElementById('setting-autoplay-next');
            const forceProxyToggle = document.getElementById('setting-force-proxy');
            const forceTranscodeToggle = document.getElementById('setting-force-transcode');
            const forceRemuxToggle = document.getElementById('setting-force-remux');
            const autoTranscodeToggle = document.getElementById('setting-auto-transcode');
            const epgRefreshSelect = document.getElementById('epg-refresh-interval');
            const streamFormatSelect = document.getElementById('setting-stream-format');

            if (arrowKeysToggle) arrowKeysToggle.checked = s.arrowKeysChangeChannel;
            if (overlayDurationInput) overlayDurationInput.value = s.overlayDuration;
            if (defaultVolumeSlider) defaultVolumeSlider.value = s.defaultVolume;
            if (volumeValueDisplay) volumeValueDisplay.textContent = s.defaultVolume + '%';
            if (rememberVolumeToggle) rememberVolumeToggle.checked = s.rememberVolume;
            if (autoPlayNextToggle) autoPlayNextToggle.checked = s.autoPlayNextEpisode;
            if (forceProxyToggle) forceProxyToggle.checked = s.forceProxy || false;
            if (forceTranscodeToggle) forceTranscodeToggle.checked = s.forceTranscode || false;
            if (forceRemuxToggle) forceRemuxToggle.checked = s.forceRemux || false;
            if (autoTranscodeToggle) autoTranscodeToggle.checked = s.autoTranscode || false;
            if (epgRefreshSelect) epgRefreshSelect.value = s.epgRefreshInterval || '24';
            if (streamFormatSelect) streamFormatSelect.value = s.streamFormat || 'm3u8';

            // User-Agent settings
            const userAgentSelect = document.getElementById('setting-user-agent');
            const userAgentCustomInput = document.getElementById('setting-user-agent-custom');
            const customUaContainer = document.getElementById('custom-user-agent-container');
            if (userAgentSelect) {
                userAgentSelect.value = s.userAgentPreset || 'chrome';
                if (customUaContainer) {
                    customUaContainer.style.display = userAgentSelect.value === 'custom' ? 'flex' : 'none';
                }
            }
            if (userAgentCustomInput) userAgentCustomInput.value = s.userAgentCustom || '';
        }

        // Update EPG last refreshed display
        this.updateEpgLastRefreshed();

        if (document.getElementById('tab-users')?.classList.contains('active')) {
            this.startDiscordBotStatusPolling();
            this.app.withGlobalLoading(
                () => this.loadUsers(),
                'Loading users...'
            );
        }
    }

    /**
     * Update the EPG last refreshed display
     */
    async updateEpgLastRefreshed() {
        const display = document.getElementById('epg-last-refreshed');
        const firebaseDisplay = document.getElementById('firebase-cache-last-sync');
        if (!display) return;

        try {
            const data = await API.settings.getSyncStatus();

            if (data.lastSyncTime) {
                const lastRefreshTime = new Date(data.lastSyncTime);

                // Format as relative time or absolute
                const now = new Date();
                const diffMs = now - lastRefreshTime;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMins / 60);

                let text;
                if (diffMins < 1) {
                    text = 'Just now';
                } else if (diffMins < 60) {
                    text = `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
                } else if (diffHours < 24) {
                    text = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
                } else {
                    // Use absolute time for older refreshes
                    text = lastRefreshTime.toLocaleString();
                }

                display.textContent = text;
                display.title = lastRefreshTime.toLocaleString(); // Full timestamp on hover
            } else {
                display.textContent = 'Never';
                display.title = 'Sync has not run yet since server started';
            }

            if (firebaseDisplay) {
                const firebaseStatus = data.firebaseCache;

                if (!firebaseStatus?.enabled) {
                    const detail = firebaseStatus?.lastError || 'Firebase cache is not configured';
                    firebaseDisplay.textContent = `Disabled (${detail})`;
                    firebaseDisplay.title = detail;
                } else if (firebaseStatus.syncing) {
                    firebaseDisplay.textContent = 'Sync in progress...';
                    firebaseDisplay.title = firebaseStatus.nextSyncTime || '';
                } else if (firebaseStatus.lastSyncTime) {
                    const firebaseTime = new Date(firebaseStatus.lastSyncTime);
                    firebaseDisplay.textContent = firebaseTime.toLocaleString();
                    firebaseDisplay.title = `Next sync: ${firebaseStatus.nextSyncTime || 'unknown'}`;
                } else {
                    firebaseDisplay.textContent = 'Never';
                    firebaseDisplay.title = firebaseStatus.nextSyncTime || 'No sync recorded yet';
                }
            }
        } catch (err) {
            console.error('Error fetching sync status:', err);
            display.textContent = 'Unknown';
            display.title = 'Could not fetch sync status';
            if (firebaseDisplay) {
                firebaseDisplay.textContent = 'Unknown';
                firebaseDisplay.title = 'Could not fetch Firebase cache status';
            }
        }
    }

    hide() {
        this.stopDiscordBotStatusPolling();
    }
}

window.SettingsPage = SettingsPage;

