/**
 * Movies Page Controller
 * Handles VOD movie browsing and playback
 */

class MoviesPage {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('movies-grid');
        this.sourceSelect = document.getElementById('movies-source-select');
        this.categorySelect = document.getElementById('movies-category-select');
        this.languageSelect = document.getElementById('movies-language-select');
        this.searchInput = document.getElementById('movies-search');
        this.detailsPanel = document.getElementById('movie-details');
        this.detailsPoster = document.getElementById('movie-details-poster');
        this.detailsTitle = document.getElementById('movie-details-title');
        this.detailsMeta = document.getElementById('movie-details-meta');
        this.detailsPlot = document.getElementById('movie-details-plot');
        this.detailsRatingScore = document.getElementById('movie-details-rating-score');
        this.detailsRatingCount = document.getElementById('movie-details-rating-count');
        this.detailsPlayBtn = document.getElementById('movie-details-play-btn');

        this.movies = [];
        this.categories = [];
        this.sources = [];
        this.currentBatch = 0;
        this.batchSize = 24;
        this.filteredMovies = [];
        this.isLoading = false;
        this.favoriteIds = new Set(); // Track favorite movie IDs
        this.showFavoritesOnly = false;
        this.categoryNameMap = new Map();
        this.currentMovie = null;
        this.scrollRaf = null;
        this.resizeTimer = null;
        this.virtualTopSpacer = null;
        this.virtualBottomSpacer = null;
        this.virtualRangeStart = -1;
        this.virtualRangeEnd = -1;
        this.virtualItemsPerRow = 1;
        this.virtualRowHeight = 300;
        this.virtualGap = 16;
        this.virtualOverscanRows = 4;
        this.onGridScroll = () => this.scheduleVirtualRender(false);
        this.onGridResize = () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => this.scheduleVirtualRender(true), 120);
        };

        this.init();
    }

    init() {
        // Source change handler
        this.sourceSelect?.addEventListener('change', async () => {
            await this.loadCategories();
            await this.loadMovies();
        });

        // Category change handler
        this.categorySelect?.addEventListener('change', () => {
            this.loadMovies();
        });

        // Language change handler
        this.languageSelect?.addEventListener('change', () => {
            this.filterAndRender();
        });

        // Search with debounce
        let searchTimeout;
        this.searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.filterAndRender(), 300);
        });

        this.container?.addEventListener('scroll', this.onGridScroll, { passive: true });
        window.addEventListener('resize', this.onGridResize);

        // Favorites filter toggle
        const favBtn = document.getElementById('movies-favorites-btn');
        favBtn?.addEventListener('click', () => {
            this.showFavoritesOnly = !this.showFavoritesOnly;
            favBtn.classList.toggle('active', this.showFavoritesOnly);
            this.filterAndRender();
        });

        document.getElementById('movie-back-btn')?.addEventListener('click', () => this.hideDetails());
        this.detailsPlayBtn?.addEventListener('click', () => {
            if (this.currentMovie) this.playMovie(this.currentMovie);
        });
    }

    async show() {
        this.hideDetails();

        // Load sources if not loaded
        if (this.sources.length === 0) {
            await this.loadSources();
        }

        // Load favorites
        await this.loadFavorites();

        // Load movies if empty
        if (this.movies.length === 0) {
            await this.loadCategories();
            await this.loadMovies();
            return;
        }

        // When returning from Watch page, ensure virtualized grid is rebuilt.
        this.filterAndRender();
        this.scheduleVirtualRender(true);
        requestAnimationFrame(() => this.scheduleVirtualRender(true));
    }

    hide() {
        // Page is hidden
        this.hideDetails();
        if (this.scrollRaf) {
            cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
    }

    formatRating(rating) {
        const value = Number.parseFloat(rating);
        if (!Number.isFinite(value)) return '';
        return `${Math.round(value)}`;
    }

    parseNumber(value, fallback = 0) {
        if (value === null || value === undefined) return fallback;
        const parsed = Number.parseFloat(`${value}`.replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    getReleaseYear(item) {
        const explicitYear = this.parseNumber(item?.year, 0);
        if (explicitYear >= 1900 && explicitYear <= 2100) return explicitYear;

        const dateCandidates = [
            item?.releaseDate,
            item?.release_date,
            item?.release,
            item?.added,
            item?.date_added
        ];

        for (const raw of dateCandidates) {
            if (!raw) continue;
            if (/^\d{10,13}$/.test(`${raw}`)) {
                const ms = `${raw}`.length === 13 ? Number(raw) : Number(raw) * 1000;
                const y = new Date(ms).getUTCFullYear();
                if (y >= 1900 && y <= 2100) return y;
            }

            const d = new Date(raw);
            const y = d.getUTCFullYear();
            if (Number.isFinite(y) && y >= 1900 && y <= 2100) return y;
        }

        return 0;
    }

    getSmartDiscoverScore(movie, searchTerm = '') {
        const nowYear = new Date().getUTCFullYear();
        const ratingRaw = this.parseNumber(
            movie?.rating ?? movie?.imdb_rating ?? movie?.tmdb_rating ?? movie?.rating_5based,
            0
        );
        const rating10 = ratingRaw <= 5 ? ratingRaw * 2 : ratingRaw;
        const ratingNorm = Math.max(0, Math.min(1, rating10 / 10));

        const votes = this.parseNumber(
            movie?.votes ?? movie?.vote_count ?? movie?.num ?? movie?.rating_count ?? movie?.review_count ?? movie?.reviews,
            0
        );
        const votesNorm = Math.max(0, Math.min(1, Math.log10(votes + 1) / 5));

        const year = this.getReleaseYear(movie);
        const age = year > 0 ? Math.max(0, nowYear - year) : 40;
        const recencyNorm = Math.max(0, Math.min(1, 1 - (age / 25)));

        const isFav = this.favoriteIds.has(`${movie.sourceId}:${movie.stream_id}`) ? 1 : 0;
        const title = movie?.name?.toLowerCase() || '';
        const searchBonus = searchTerm && title.startsWith(searchTerm) ? 0.06 : 0;

        return (ratingNorm * 0.58) + (votesNorm * 0.22) + (recencyNorm * 0.16) + (isFav * 0.04) + searchBonus;
    }

    getMovieRating10(movie) {
        const ratingRaw = this.parseNumber(
            movie?.rating ?? movie?.imdb_rating ?? movie?.tmdb_rating ?? movie?.rating_5based,
            0
        );
        return ratingRaw > 0 ? (ratingRaw <= 5 ? ratingRaw * 2 : ratingRaw) : 0;
    }

    getMovieVotes(movie) {
        return Math.max(0, Math.floor(this.parseNumber(
            movie?.votes ?? movie?.vote_count ?? movie?.num ?? movie?.rating_count ?? movie?.review_count ?? movie?.reviews,
            0
        )));
    }

    formatVotes(count) {
        if (!Number.isFinite(count) || count <= 0) return 'No rating votes yet';
        if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M votes`;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}K votes`;
        return `${count} votes`;
    }

    getMovieDescription(movie, details = null) {
        const info = details?.info || {};
        const movieData = details?.movie_data || {};
        const raw =
            info.plot ||
            info.description ||
            info.overview ||
            movieData.plot ||
            movieData.description ||
            movie.plot ||
            movie.description ||
            '';

        return `${raw}`.trim();
    }

    async loadFavorites() {
        try {
            const favs = await API.favorites.getAll(null, 'movie');
            this.favoriteIds = new Set(favs.map(f => `${f.source_id}:${f.item_id}`));
        } catch (err) {
            console.error('Error loading favorites:', err);
        }
    }


    async loadSources() {
        try {
            const allSources = await API.sources.getAll();
            this.sources = allSources.filter(s => s.type === 'xtream' && s.enabled);

            this.sourceSelect.innerHTML = '<option value="">All Sources</option>';
            this.sources.forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = s.name;
                this.sourceSelect.appendChild(option);
            });
        } catch (err) {
            console.error('Error loading sources:', err);
        }
    }

    async loadCategories() {
        try {
            this.categories = [];
            this.hiddenCategoryIds = new Set(); // Track hidden categories
            this.categoryNameMap = new Map();
            this.categorySelect.innerHTML = '<option value="">All Categories</option>';

            const sourceId = this.sourceSelect.value;
            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            // Fetch hidden items for each source
            for (const source of sourcesToLoad) {
                try {
                    const hiddenItems = await API.channels.getHidden(source.id);
                    hiddenItems.forEach(h => {
                        if (h.item_type === 'vod_category') {
                            this.hiddenCategoryIds.add(`${source.id}:${h.item_id}`);
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load hidden items from source ${source.id}`);
                }
            }

            for (const source of sourcesToLoad) {
                try {
                    const cats = await API.proxy.xtream.vodCategories(source.id);
                    if (cats && Array.isArray(cats)) {
                        cats.forEach(c => {
                            this.categoryNameMap.set(`${source.id}:${c.category_id}`, c.category_name);
                            // Skip hidden categories
                            if (!this.hiddenCategoryIds.has(`${source.id}:${c.category_id}`)) {
                                this.categories.push({ ...c, sourceId: source.id });
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load categories from source ${source.id}:`, err.message);
                }
            }

            // Populate dropdown
            this.categories.forEach(c => {
                const option = document.createElement('option');
                option.value = `${c.sourceId}:${c.category_id}`;
                option.textContent = c.category_name;
                this.categorySelect.appendChild(option);
            });
        } catch (err) {
            console.error('Error loading categories:', err);
        }
    }

    async loadMovies() {
        this.isLoading = true;
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            this.movies = [];

            const sourceId = this.sourceSelect.value;
            const categoryValue = this.categorySelect.value;

            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            for (const source of sourcesToLoad) {
                try {
                    // Parse category if selected
                    let catId = null;
                    if (categoryValue) {
                        const [catSourceId, categoryId] = categoryValue.split(':');
                        if (parseInt(catSourceId) === source.id) {
                            catId = categoryId;
                        } else if (sourceId) {
                            continue; // Skip this source if category is from different source
                        }
                    }

                    const movies = await API.proxy.xtream.vodStreams(source.id, catId);
                    console.log(`[Movies] Source ${source.id}, Category ${catId || 'ALL'}: Got ${movies?.length || 0} movies`);
                    if (movies && Array.isArray(movies)) {
                        movies.forEach(m => {
                            // Skip movies from hidden categories
                            if (this.hiddenCategoryIds && this.hiddenCategoryIds.has(`${source.id}:${m.category_id}`)) {
                                return;
                            }

                            const categoryName = this.categoryNameMap.get(`${source.id}:${m.category_id}`) || '';
                            const languageCode = window.LanguageFilter?.detectLanguage(m, categoryName) || 'unknown';

                            this.movies.push({
                                ...m,
                                sourceId: source.id,
                                id: `${source.id}:${m.stream_id}`,
                                languageCode
                            });
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load movies from source ${source.id}:`, err.message);
                }
            }

            console.log(`[Movies] Total loaded: ${this.movies.length} movies`);
            this.updateLanguageOptions();
            this.filterAndRender();
        } catch (err) {
            console.error('Error loading movies:', err);
            this.container.innerHTML = '<div class="empty-state"><p>Error loading movies</p></div>';
        } finally {
            this.isLoading = false;
        }
    }

    filterAndRender() {
        const searchTerm = this.searchInput?.value?.toLowerCase() || '';
        const languageFilter = this.languageSelect?.value || '';
        const isAllCategories = !this.categorySelect?.value;

        this.filteredMovies = this.movies.filter(m => {
            // Filter by favorites if enabled
            if (this.showFavoritesOnly) {
                const favKey = `${m.sourceId}:${m.stream_id}`;
                if (!this.favoriteIds.has(favKey)) return false;
            }
            if (searchTerm && !m.name?.toLowerCase().includes(searchTerm)) {
                return false;
            }
            if (languageFilter && (m.languageCode || 'unknown') !== languageFilter) {
                return false;
            }
            return true;
        });

        if (isAllCategories) {
            this.filteredMovies.sort((a, b) => {
                const scoreDelta = this.getSmartDiscoverScore(b, searchTerm) - this.getSmartDiscoverScore(a, searchTerm);
                if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;

                const yearDelta = this.getReleaseYear(b) - this.getReleaseYear(a);
                if (yearDelta !== 0) return yearDelta;

                const ratingDelta = this.parseNumber(b.rating, 0) - this.parseNumber(a.rating, 0);
                if (ratingDelta !== 0) return ratingDelta;

                return (a.name || '').localeCompare(b.name || '');
            });
        }

        console.log(`[Movies] Displaying ${this.filteredMovies.length} of ${this.movies.length} movies`);

        this.currentBatch = 0;
        this.virtualRangeStart = -1;
        this.virtualRangeEnd = -1;
        this.container.innerHTML = '';

        if (this.filteredMovies.length === 0) {
            this.container.innerHTML = '<div class="empty-state"><p>No movies found</p></div>';
            return;
        }

        this.virtualTopSpacer = document.createElement('div');
        this.virtualTopSpacer.className = 'movies-virtual-spacer movies-virtual-spacer-top';
        this.virtualTopSpacer.style.flexBasis = '100%';
        this.virtualTopSpacer.style.height = '0px';
        this.virtualTopSpacer.style.pointerEvents = 'none';

        this.virtualBottomSpacer = document.createElement('div');
        this.virtualBottomSpacer.className = 'movies-virtual-spacer movies-virtual-spacer-bottom';
        this.virtualBottomSpacer.style.flexBasis = '100%';
        this.virtualBottomSpacer.style.height = '0px';
        this.virtualBottomSpacer.style.pointerEvents = 'none';

        this.container.appendChild(this.virtualTopSpacer);
        this.container.appendChild(this.virtualBottomSpacer);

        this.container.scrollTop = 0;
        this.scheduleVirtualRender(true);
        requestAnimationFrame(() => this.scheduleVirtualRender(true));
    }

    updateLanguageOptions() {
        if (!this.languageSelect) return;

        const previousValue = this.languageSelect.value;
        const counts = new Map();

        this.movies.forEach(movie => {
            const code = movie.languageCode || 'unknown';
            counts.set(code, (counts.get(code) || 0) + 1);
        });

        const options = Array.from(counts.entries())
            .sort((a, b) => {
                const labelA = window.LanguageFilter?.getLanguageLabel(a[0]) || 'Unknown';
                const labelB = window.LanguageFilter?.getLanguageLabel(b[0]) || 'Unknown';
                return labelA.localeCompare(labelB);
            });

        this.languageSelect.innerHTML = '<option value="">All Languages</option>';
        options.forEach(([code, count]) => {
            const option = document.createElement('option');
            const label = window.LanguageFilter?.getLanguageLabel(code) || 'Unknown';
            option.value = code;
            option.textContent = `${label} (${count})`;
            this.languageSelect.appendChild(option);
        });

        const hasPrevious = previousValue && options.some(([code]) => code === previousValue);
        if (hasPrevious) {
            this.languageSelect.value = previousValue;
            return;
        }

        const preferred = this.app?.currentUser?.defaultLanguage || '';
        const hasPreferred = preferred && options.some(([code]) => code === preferred);
        this.languageSelect.value = hasPreferred ? preferred : '';
    }

    scheduleVirtualRender(force = false) {
        if (this.scrollRaf) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            this.renderVirtualWindow(force);
        });
    }

    measureVirtualMetrics() {
        const style = window.getComputedStyle(this.container);
        const gapValue = parseFloat(style.gap || style.rowGap || '16');
        this.virtualGap = Number.isFinite(gapValue) ? gapValue : 16;

        const firstCard = this.container.querySelector('.movie-card');
        const cardWidth = firstCard?.offsetWidth || 160;
        const cardHeight = firstCard?.offsetHeight || 300;
        const containerWidth = this.container.clientWidth || window.innerWidth || 1;

        this.virtualItemsPerRow = Math.max(1, Math.floor((containerWidth + this.virtualGap) / (cardWidth + this.virtualGap)));
        this.virtualRowHeight = Math.max(1, cardHeight + this.virtualGap);
    }

    createMovieCard(movie) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.dataset.movieId = movie.stream_id;
        card.dataset.sourceId = movie.sourceId;

        const poster = movie.stream_icon || movie.cover || '/img/LurkedTV.png';
        const year = movie.year || movie.releaseDate?.substring(0, 4) || '';
        const normalizedRating = this.getMovieRating10(movie);
        const rating = normalizedRating > 0 ? `${Icons.star} ${Math.round(normalizedRating)}` : '';

        const isFav = this.favoriteIds.has(`${movie.sourceId}:${movie.stream_id}`);

        card.innerHTML = `
            <div class="movie-poster">
                <img src="${poster}" alt="${movie.name}" 
                     onerror="this.onerror=null;this.src='/img/LurkedTV.png'" loading="lazy">
                <div class="movie-play-overlay">
                    <span class="play-icon">${Icons.play}</span>
                </div>
                <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                    <span class="fav-icon">${isFav ? Icons.favorite : Icons.favoriteOutline}</span>
                </button>
            </div>
            <div class="movie-info">
                <div class="movie-title">${movie.name}</div>
                <div class="movie-meta">
                    ${year ? `<span>${year}</span>` : ''}
                    ${rating ? `<span>${rating}</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.favorite-btn')) {
                const btn = e.target.closest('.favorite-btn');
                this.toggleFavorite(movie, btn);
                e.stopPropagation();
            } else {
                this.showMovieDetails(movie);
            }
        });

        return card;
    }

    renderVirtualWindow(force = false) {
        if (!this.container || !this.virtualTopSpacer || !this.virtualBottomSpacer) return;
        if (!this.filteredMovies.length) return;

        this.measureVirtualMetrics();

        const totalItems = this.filteredMovies.length;
        const itemsPerRow = Math.max(1, this.virtualItemsPerRow);
        const totalRows = Math.ceil(totalItems / itemsPerRow);
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight || 1;
        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / this.virtualRowHeight));
        const visibleRows = Math.max(1, Math.ceil(viewportHeight / this.virtualRowHeight));

        const startRow = Math.max(0, firstVisibleRow - this.virtualOverscanRows);
        const endRow = Math.min(totalRows, firstVisibleRow + visibleRows + this.virtualOverscanRows);

        const startIndex = startRow * itemsPerRow;
        const endIndex = Math.min(totalItems, endRow * itemsPerRow);

        if (!force && startIndex === this.virtualRangeStart && endIndex === this.virtualRangeEnd) {
            return;
        }

        this.virtualRangeStart = startIndex;
        this.virtualRangeEnd = endIndex;

        Array.from(this.container.querySelectorAll('.movie-card')).forEach(card => card.remove());

        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
            fragment.appendChild(this.createMovieCard(this.filteredMovies[i]));
        }

        this.container.insertBefore(fragment, this.virtualBottomSpacer);

        const topHeight = startRow * this.virtualRowHeight;
        const bottomHeight = Math.max(0, (totalRows - endRow) * this.virtualRowHeight);
        this.virtualTopSpacer.style.height = `${topHeight}px`;
        this.virtualBottomSpacer.style.height = `${bottomHeight}px`;
    }

    async showMovieDetails(movie) {
        if (!movie || !this.detailsPanel) return;

        this.currentMovie = movie;
        this.container.classList.add('hidden');
        this.detailsPanel.classList.remove('hidden');

        const poster = movie.stream_icon || movie.cover || '/img/LurkedTV.png';
        if (this.detailsPoster) {
            this.detailsPoster.onerror = () => {
                this.detailsPoster.onerror = null;
                this.detailsPoster.src = '/img/LurkedTV.png';
            };
            this.detailsPoster.src = poster;
            this.detailsPoster.alt = movie.name || 'Movie Poster';
        }

        if (this.detailsTitle) {
            this.detailsTitle.textContent = movie.name || 'Unknown Movie';
        }

        let details = null;
        try {
            details = await API.proxy.xtream.vodInfo(movie.sourceId, movie.stream_id);
        } catch (err) {
            console.warn('Failed to load movie details:', err.message);
        }

        if (this.detailsPlot) {
            const synopsis = this.getMovieDescription(movie, details);
            this.detailsPlot.textContent = synopsis || 'Description unavailable.';
            this.detailsPlot.style.display = '';
        }

        const year = this.getReleaseYear(movie);
        const rating10 = this.getMovieRating10(movie);
        const votes = this.getMovieVotes(movie);
        const duration = movie.duration || movie.runtime || '';

        if (this.detailsMeta) {
            const metaBits = [];
            if (year > 0) metaBits.push(`<span>${year}</span>`);
            if (duration) metaBits.push(`<span>${duration}</span>`);
            if (movie.genre) metaBits.push(`<span>${movie.genre}</span>`);
            if (movie.container_extension) metaBits.push(`<span>${String(movie.container_extension).toUpperCase()}</span>`);
            this.detailsMeta.innerHTML = metaBits.join('');
        }

        if (this.detailsRatingScore) {
            if (rating10 > 0) {
                this.detailsRatingScore.innerHTML = `${Icons.star} ${rating10.toFixed(1)}/10`;
            } else {
                this.detailsRatingScore.textContent = 'Not Rated';
            }
        }

        if (this.detailsRatingCount) {
            this.detailsRatingCount.textContent = this.formatVotes(votes);
        }
    }

    hideDetails() {
        if (this.detailsPanel) {
            this.detailsPanel.classList.add('hidden');
        }
        this.container.classList.remove('hidden');
        this.currentMovie = null;
    }

    async playMovie(movie) {
        try {
            // Get stream URL for movie using the actual container extension from API
            // Xtream API returns container_extension (e.g., 'mp4', 'mkv', 'avi')
            const container = movie.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(movie.sourceId, movie.stream_id, 'movie', container);

            if (result && result.url) {
                // Play in dedicated Watch page
                if (this.app.pages.watch) {
                    this.app.pages.watch.play({
                        type: 'movie',
                        id: movie.stream_id,
                        title: movie.name,
                        poster: movie.stream_icon || movie.cover,
                        description: movie.plot || '',
                        year: movie.year || movie.releaseDate?.substring(0, 4),
                        rating: movie.rating,
                        duration: movie.duration || movie.runtime || '',
                        sourceId: movie.sourceId,
                        categoryId: movie.category_id,
                        containerExtension: container
                    }, result.url);
                }
            }
        } catch (err) {
            console.error('Error playing movie:', err);
        }
    }
    async toggleFavorite(movie, btn) {
        const favKey = `${movie.sourceId}:${movie.stream_id}`;
        const isFav = this.favoriteIds.has(favKey);
        const iconSpan = btn.querySelector('.fav-icon');

        try {
            // Optimistic update
            if (isFav) {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                btn.title = 'Add to Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
                await API.favorites.remove(movie.sourceId, movie.stream_id, 'movie');
            } else {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                btn.title = 'Remove from Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
                await API.favorites.add(movie.sourceId, movie.stream_id, 'movie');
            }
        } catch (err) {
            console.error('Error toggling favorite:', err);
            // Revert on error
            if (isFav) {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
            } else {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
            }
        }
    }
}

window.MoviesPage = MoviesPage;

