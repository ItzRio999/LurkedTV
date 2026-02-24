/**
 * Home Page Controller
 */

class LivePage {
    constructor(app) {
        this.app = app;
        this.liveLayout = document.querySelector('#page-live .home-layout');
        this.liveEpgPanel = document.getElementById('live-epg-panel');
        this.epgToggle = document.getElementById('live-epg-toggle');
        this._epgViewActive = false;
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleEpgToggle = this.handleEpgToggle.bind(this);

        this.epgToggle?.addEventListener('change', this.handleEpgToggle);
    }

    async init() {
        // Load sources and channels on initial page load
        await this.app.channelList.loadSources();
        await this.app.channelList.loadChannels();

        // Silently fetch EPG data for sidebar info
        try {
            await this.app.epgGuide.fetchEpgData();

            // Clear cache so we don't get stale "null" results from initial render
            this.app.channelList.clearProgramInfoCache();

            // Update program info in existing DOM elements without re-rendering
            this.updateProgramInfo();
        } catch (err) {
            console.warn('Background EPG fetch failed:', err);
        }
    }

    /**
     * Update "Now Playing" info in existing channel elements without blocking UI
     */
    updateProgramInfo() {
        const channelItems = Array.from(document.querySelectorAll('.channel-item'));
        if (channelItems.length === 0) return;

        // Build a map for O(1) channel lookups
        const channelMap = new Map();
        this.app.channelList.channels.forEach(c => channelMap.set(c.id, c));

        // Process in small batches to avoid blocking UI
        const BATCH_SIZE = 50;
        let index = 0;

        const processBatch = () => {
            const end = Math.min(index + BATCH_SIZE, channelItems.length);

            for (let i = index; i < end; i++) {
                const item = channelItems[i];
                const channelId = item.dataset.channelId;
                const channel = channelMap.get(channelId);

                if (channel) {
                    const programDiv = item.querySelector('.channel-program');
                    if (programDiv) {
                        const programTitle = this.app.channelList.getProgramInfo(channel);
                        programDiv.textContent = programTitle || '';
                    }
                }
            }

            index = end;
            if (index < channelItems.length) {
                // Yield to browser before next batch
                requestAnimationFrame(processBatch);
            }
        };

        // Start processing
        requestAnimationFrame(processBatch);
    }

    handleKeydown(e) {
        if (this._epgViewActive) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case 'ArrowUp':
                // Check if player handles arrows for volume
                if (this.app.player && !this.app.player.settings.arrowKeysChangeChannel) return;

                e.preventDefault();
                this.app.channelList.selectPrevChannel();
                break;
            case 'ArrowDown':
                // Check if player handles arrows for volume
                if (this.app.player && !this.app.player.settings.arrowKeysChangeChannel) return;

                e.preventDefault();
                this.app.channelList.selectNextChannel();
                break;
        }
    }

    async show() {
        document.addEventListener('keydown', this.handleKeydown);

        // Only reload if channels aren't already loaded
        if (this.app.channelList.channels.length === 0) {
            await this.app.channelList.loadSources();
            await this.app.channelList.loadChannels();
        }

        await this.setEpgMode(Boolean(this.epgToggle?.checked));
    }

    hide() {
        document.removeEventListener('keydown', this.handleKeydown);
    }

    async handleEpgToggle() {
        await this.setEpgMode(Boolean(this.epgToggle?.checked));
    }

    async setEpgMode(enabled) {
        if (this._epgViewActive === enabled) return;
        this._epgViewActive = enabled;

        this.liveLayout?.classList.toggle('hidden', enabled);
        this.liveEpgPanel?.classList.toggle('hidden', !enabled);

        if (enabled) {
            document.getElementById('channel-sidebar')?.classList.remove('active');
            document.getElementById('channel-sidebar-overlay')?.classList.remove('active');
        }

        if (enabled) {
            await this.showEpgView();
        }
    }

    async showEpgView() {
        const channelList = this.app.channelList;
        if (!channelList.channels || channelList.channels.length === 0) {
            await channelList.loadSources();
            await channelList.loadChannels();
        }

        if (!this.app.epgGuide.programmes || this.app.epgGuide.programmes.length === 0) {
            await this.app.epgGuide.loadEpg();
        } else {
            this.app.epgGuide.render();
        }
    }
}

window.LivePage = LivePage;

