/**
 * LurkedTV Application Entry Point
 */

class App {
    constructor() {
        this.currentPage = 'home';
        this.pages = {};
        this.currentUser = null;
        this.device = this.detectDeviceCapabilities();

        // Initialize components
        this.player = new VideoPlayer();
        this.channelList = new ChannelList();
        this.sourceManager = new SourceManager();
        this.epgGuide = new EpgGuide();

        // Initialize page controllers
        this.pages.home = new HomePage(this);
        this.pages.live = new LivePage(this);
        this.pages.movies = new MoviesPage(this);
        this.pages.series = new SeriesPage(this);
        this.pages.search = new SearchPage(this);
        this.pages.settings = new SettingsPage(this);
        this.pages.watch = new WatchPage(this);

        this.init();
    }

    async init() {
        // Check authentication first
        await this.checkAuth();
        this.setupDeviceExperience();

        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const navbarMenu = document.getElementById('navbar-menu');

        if (mobileMenuToggle && navbarMenu) {
            mobileMenuToggle.addEventListener('click', () => {
                mobileMenuToggle.classList.toggle('active');
                navbarMenu.classList.toggle('active');
            });

            // Close menu when a nav link is clicked
            document.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', () => {
                    mobileMenuToggle.classList.remove('active');
                    navbarMenu.classList.remove('active');
                });
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.navbar')) {
                    mobileMenuToggle.classList.remove('active');
                    navbarMenu.classList.remove('active');
                }
            });
        }

        // Channel drawer toggle (mobile)
        const channelToggleBtn = document.getElementById('channel-toggle-btn');
        const channelSidebar = document.getElementById('channel-sidebar');
        const channelOverlay = document.getElementById('channel-sidebar-overlay');

        if (channelToggleBtn && channelSidebar && channelOverlay) {
            const toggleChannelDrawer = () => {
                channelSidebar.classList.toggle('active');
                channelOverlay.classList.toggle('active');
            };

            channelToggleBtn.addEventListener('click', toggleChannelDrawer);
            channelOverlay.addEventListener('click', toggleChannelDrawer);

            // Close drawer when a channel is selected
            channelSidebar.addEventListener('click', (e) => {
                if (e.target.closest('.channel-item')) {
                    // Small delay to let the channel selection happen
                    setTimeout(() => {
                        channelSidebar.classList.remove('active');
                        channelOverlay.classList.remove('active');
                    }, 300);
                }
            });
        }

        // Desktop sidebar collapse toggle
        const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
        const sidebarExpandBtn = document.getElementById('sidebar-expand-btn');
        const homeLayout = document.querySelector('.home-layout');

        const toggleSidebarCollapse = () => {
            channelSidebar?.classList.toggle('collapsed');
            homeLayout?.classList.toggle('sidebar-collapsed');

            // Persist preference
            const isCollapsed = channelSidebar?.classList.contains('collapsed');
            localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
        };

        sidebarCollapseBtn?.addEventListener('click', toggleSidebarCollapse);
        sidebarExpandBtn?.addEventListener('click', toggleSidebarCollapse);

        // Restore sidebar state from localStorage
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            channelSidebar?.classList.add('collapsed');
            homeLayout?.classList.add('sidebar-collapsed');
        }

        // Navigation handling
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                if (!link.dataset.page) return; // skip action links (logout, etc.)
                e.preventDefault();
                this.navigateTo(link.dataset.page);
            });
        });

        this.setupGlobalSearch();

        // Toggle groups button
        document.getElementById('toggle-groups').addEventListener('click', () => {
            this.channelList.toggleAllGroups();
        });

        // Search clear buttons (global handler for all)
        document.querySelectorAll('.search-clear').forEach(btn => {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.search-wrapper');
                const input = wrapper?.querySelector('.search-input');
                if (input) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                }
            });
        });

        // Handle browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            const page = e.state?.page || 'home';
            this.navigateTo(page, false); // false = don't add to history
        });

        // Initialize home page first (it's needed for channel list)
        await this.pages.home.init();

        // Preload EPG data in background (non-blocking)
        // This ensures EPG info is available on Live TV page without visiting Guide first
        this.epgGuide.loadEpg().catch(err => {
            console.warn('Background EPG load failed:', err.message);
        });

        // Navigate to the page from URL hash, or default to home
        const hash = window.location.hash.slice(1); // Remove #
        const initialPage = hash === 'guide' ? 'live' : (hash && this.pages[hash] ? hash : 'home');
        this.navigateTo(initialPage, true); // true = replace history (don't add)
        if (hash === 'guide') {
            this.pages.live?.setEpgMode?.(true);
            const liveToggle = document.getElementById('live-epg-toggle');
            if (liveToggle) liveToggle.checked = true;
        }

        console.log('LurkedTV initialized');
    }

    detectDeviceCapabilities() {
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const maxTouchPoints = navigator.maxTouchPoints || 0;
        const isIOS = /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
        const isTouch = maxTouchPoints > 0 || window.matchMedia('(hover: none), (pointer: coarse)').matches;
        const isSmallViewport = () => window.matchMedia('(max-width: 768px)').matches;

        return { isIOS, isTouch, isSmallViewport };
    }

    setupDeviceExperience() {
        const root = document.documentElement;
        root.classList.toggle('is-ios', this.device.isIOS);
        root.classList.toggle('is-touch', this.device.isTouch);

        const updateViewportVars = () => {
            const vh = window.innerHeight * 0.01;
            root.style.setProperty('--vh', `${vh}px`);

            let uiBottom = 0;
            if (this.device.isIOS && window.visualViewport) {
                const vv = window.visualViewport;
                uiBottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
            }
            root.style.setProperty('--ios-ui-bottom', `${uiBottom}px`);
        };

        updateViewportVars();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateViewportVars, { passive: true });
            window.visualViewport.addEventListener('scroll', updateViewportVars, { passive: true });
        }

        window.addEventListener('resize', updateViewportVars, { passive: true });
        window.addEventListener('orientationchange', updateViewportVars, { passive: true });

        if (this.device.isTouch) {
            this.initTouchGestures();
        }
    }

    initTouchGestures() {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let startTarget = null;
        let tracking = false;

        const isInteractiveTarget = (target) => {
            return Boolean(target?.closest?.(
                'input, textarea, select, button, a, [role="button"], .watch-controls, .watch-overlay, .video-container, .watch-video-section, .horizontal-scroll'
            ));
        };

        const closeMobileMenu = () => {
            const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
            const navbarMenu = document.getElementById('navbar-menu');
            if (!mobileMenuToggle || !navbarMenu || !navbarMenu.classList.contains('active')) return;
            mobileMenuToggle.classList.remove('active');
            navbarMenu.classList.remove('active');
        };

        const toggleChannelDrawer = (open) => {
            const channelSidebar = document.getElementById('channel-sidebar');
            const channelOverlay = document.getElementById('channel-sidebar-overlay');
            if (!channelSidebar || !channelOverlay) return;

            const shouldOpen = typeof open === 'boolean' ? open : !channelSidebar.classList.contains('active');
            channelSidebar.classList.toggle('active', shouldOpen);
            channelOverlay.classList.toggle('active', shouldOpen);
        };

        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                tracking = false;
                return;
            }

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
            startTarget = e.target;
            tracking = true;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (!tracking || e.changedTouches.length !== 1) return;
            tracking = false;

            const touch = e.changedTouches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            const elapsed = Date.now() - startTime;

            // Only handle quick, clearly horizontal swipes.
            if (elapsed > 700 || absX < 70 || absX < absY * 1.4) return;
            if (isInteractiveTarget(startTarget)) return;

            const isEdgeSwipe = startX <= 24;
            const isSmallViewport = this.device.isSmallViewport();

            // iOS-like edge swipe: open channel drawer on Home mobile, otherwise navigate back.
            if (dx > 0 && isEdgeSwipe && this.device.isIOS) {
                if (isSmallViewport && this.currentPage === 'home') {
                    toggleChannelDrawer(true);
                    closeMobileMenu();
                    return;
                }

                if (window.history.length > 1 && this.currentPage !== 'home') {
                    window.history.back();
                }
                return;
            }

            // Close mobile surfaces with left swipe.
            if (dx < 0) {
                if (isSmallViewport) {
                    closeMobileMenu();
                }

                const channelSidebar = document.getElementById('channel-sidebar');
                if (channelSidebar?.classList.contains('active')) {
                    toggleChannelDrawer(false);
                }
            }
        }, { passive: true });
    }

    async checkAuth() {
        const token = localStorage.getItem('authToken');

        if (!token) {
            // No token, redirect to login (replace to avoid back button issues)
            window.location.replace('/login.html');
            return;
        }

        try {
            // Verify token with server
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Invalid token');
            }

            this.currentUser = await response.json();

            // Wire up profile dropdown
            this.initProfileDropdown();

        } catch (err) {
            console.error('Authentication error:', err);
            localStorage.removeItem('authToken');
            window.location.replace('/login.html');
        }
    }

    async performLogout() {
        const token = localStorage.getItem('authToken');
        if (token) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
        localStorage.removeItem('authToken');
        window.location.replace('/login.html');
    }

    initProfileDropdown() {
        const user = this.currentUser;
        const profileEl = document.getElementById('navbar-profile');
        const profileBtn = document.getElementById('profile-btn');
        const dropdown = document.getElementById('profile-dropdown');
        const displayName = document.getElementById('profile-display-name');
        const displayEmail = document.getElementById('profile-display-email');
        const settingsBtn = document.getElementById('profile-settings-btn');
        const logoutBtn = document.getElementById('profile-logout-btn');
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

        if (!profileEl || !profileBtn || !dropdown) return;

        // Populate user info
        if (displayName) displayName.textContent = user?.username || user?.email || 'User';
        if (displayEmail) displayEmail.textContent = user?.email || '';

        const openDropdown = () => {
            profileEl.classList.add('open');
            profileBtn.setAttribute('aria-expanded', 'true');
            dropdown.setAttribute('aria-hidden', 'false');
            // Inline fallback so the menu still opens if CSS state rules are stale/cached.
            dropdown.style.opacity = '1';
            dropdown.style.transform = 'translateY(0) scale(1)';
            dropdown.style.pointerEvents = 'all';
            dropdown.style.visibility = 'visible';
        };

        const closeDropdown = () => {
            profileEl.classList.remove('open');
            profileBtn.setAttribute('aria-expanded', 'false');
            dropdown.setAttribute('aria-hidden', 'true');
            dropdown.style.opacity = '';
            dropdown.style.transform = '';
            dropdown.style.pointerEvents = '';
            dropdown.style.visibility = '';
        };

        const toggleDropdown = () => {
            if (profileEl.classList.contains('open')) {
                closeDropdown();
            } else {
                openDropdown();
            }
        };

        // Initial accessibility state
        profileBtn.setAttribute('aria-haspopup', 'menu');
        profileBtn.setAttribute('aria-expanded', 'false');
        dropdown.setAttribute('aria-hidden', 'true');

        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!profileEl.contains(e.target)) closeDropdown();
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDropdown();
        });

        // Settings button
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                closeDropdown();
                this.navigateTo('settings');
            });
        }

        // Desktop logout
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.performLogout());
        }

        // Mobile logout
        if (mobileLogoutBtn) {
            mobileLogoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.performLogout();
            });
        }
    }

    setupGlobalSearch() {
        if (!this.pages.search) return;

        // Wire both desktop and mobile search inputs
        ['global-search', 'global-search-mobile'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;

            let searchTimer = null;
            input.addEventListener('input', () => {
                clearTimeout(searchTimer);
                const query = input.value.trim();
                searchTimer = setTimeout(() => {
                    this.pages.search.setQuery(query, true);
                }, 250);
            });

            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                this.pages.search.setQuery(input.value.trim(), true);
            });
        });
    }

    navigateTo(pageName, replaceHistory = false) {
        const requestedGuide = pageName === 'guide';
        if (requestedGuide) {
            pageName = 'live';
        }

        if (!this.pages[pageName]) {
            pageName = 'home';
        }

        // Don't navigate if already on this page
        if (this.currentPage === pageName && !replaceHistory) {
            if (requestedGuide) {
                const liveToggle = document.getElementById('live-epg-toggle');
                if (liveToggle) liveToggle.checked = true;
                this.pages.live?.setEpgMode?.(true);
            }
            return;
        }

        // Update browser history
        if (replaceHistory) {
            // Replace current history entry (used on initial load)
            history.replaceState({ page: pageName }, '', `#${pageName}`);
        } else {
            // Add new history entry
            history.pushState({ page: pageName }, '', `#${pageName}`);
        }

        // Update nav
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === pageName);
        });

        // Update pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageName}`);
        });

        // Notify page controllers
        if (this.pages[this.currentPage]?.hide) {
            this.pages[this.currentPage].hide();
        }

        this.currentPage = pageName;

        if (this.pages[pageName]?.show) {
            this.pages[pageName].show();
        }

        if (requestedGuide) {
            const liveToggle = document.getElementById('live-epg-toggle');
            if (liveToggle) liveToggle.checked = true;
            this.pages.live?.setEpgMode?.(true);
        }
    }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();

    // Fetch and display version badge
    fetch('/api/version')
        .then(res => res.json())
        .then(data => {
            const badge = document.getElementById('version-badge');
            if (badge && data.version) {
                const major = Number.parseInt(`${data.version}`.split('.')[0], 10);
                badge.textContent = Number.isFinite(major) && major > 0 ? `V${major}` : `V${data.version}`;
            }
        })
        .catch(() => { });
});


