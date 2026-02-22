/**
 * Settings Page Controller
 */

class SettingsPage {
    constructor(app) {
        this.app = app;
        this.tabs = document.querySelectorAll('.tabs .tab');
        this.tabContents = document.querySelectorAll('.tab-content');

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

        // Firebase media cache controls
        this.initFirebaseCacheControls();

        // Account settings for all users
        this.initAccountSettings();
    }

    initAccountSettings() {
        const languageSelect = document.getElementById('setting-default-language');
        const passwordForm = document.getElementById('account-password-form');
        const feedback = document.getElementById('account-password-feedback');

        languageSelect?.addEventListener('change', async () => {
            try {
                const value = languageSelect.value || '';
                const updatedUser = await API.account.updatePreferences({ defaultLanguage: value });
                this.app.currentUser = updatedUser;
                this.applyDefaultLanguagePreference(updatedUser.defaultLanguage || '');
            } catch (err) {
                alert(`Failed to save default language: ${err.message}`);
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
        const emailEl = document.getElementById('account-email');
        const badgeEl = document.getElementById('account-email-verified-badge');
        const languageSelect = document.getElementById('setting-default-language');

        try {
            const user = await API.account.getMe();
            this.app.currentUser = user;

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
        } catch (err) {
            console.error('Error loading account settings:', err);
            if (emailEl) emailEl.textContent = 'Unable to load account';
            if (badgeEl) {
                badgeEl.textContent = 'Unknown';
                badgeEl.classList.remove('verified');
            }
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

                try {
                    await API.users.create({ username, password, role });
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
        if (!userList) return;

        try {
            const users = await API.users.getAll();
            // Store users in memory for easy access during edit
            this.users = users;

            if (users.length === 0) {
                userList.innerHTML = '<tr><td colspan="5" class="hint">No users found</td></tr>';
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
                    <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="window.app.pages.settings.openEditUserModal(${user.id})">Edit</button>
                        <button class="btn btn-sm btn-error" onclick="window.app.pages.settings.deleteUser(${user.id}, '${user.username}')">Delete</button>
                    </td>
                </tr>
            `}).join('');
        } catch (err) {
            console.error('Error loading users:', err);
            userList.innerHTML = '<tr><td colspan="5" class="hint">Error loading users</td></tr>';
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
            const editPassword = document.getElementById('edit-password');

            console.log('Form elements found:', { editId, editUsername, editEmail, editRole, editPassword });

            if (editId) editId.value = user.id;
            if (editUsername) editUsername.value = user.username;
            if (editEmail) editEmail.value = user.email || '';
            if (editRole) editRole.value = user.role;
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
                role: document.getElementById('edit-role').value
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
            this.app.sourceManager.loadContentSources();
        }

        // Load users when switching to users tab
        if (tabName === 'users') {
            this.loadUsers();
        }

        // Load hardware info when switching to transcode tab
        if (tabName === 'transcode') {
            this.loadHardwareInfo();
        }
    }

    async show() {
        // Show users tab for admin, hide for non-admin.
        const usersTab = document.getElementById('users-tab');
        if (usersTab) {
            usersTab.style.display = (this.app.currentUser && this.app.currentUser.role === 'admin') ? 'block' : 'none';
        }

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
                    firebaseDisplay.textContent = 'Disabled (missing Firebase admin env vars)';
                    firebaseDisplay.title = firebaseStatus?.lastError || 'Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY';
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
        // Page is hidden
    }
}

window.SettingsPage = SettingsPage;

