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
        this.detailsCast = document.getElementById('movie-details-cast');
        this.detailsRatingScore = document.getElementById('movie-details-rating-score');
        this.detailsRatingCount = document.getElementById('movie-details-rating-count');
        this.detailsPlayBtn = document.getElementById('movie-details-play-btn');
        this.detailsTrailerBtn = document.getElementById('movie-details-trailer-btn');

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
        this.currentMovieDetails = null;
        this.movieDetailsCache = new Map();
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
        this.detailsBackdropLoadId = 0;
        this.externalMetadataByKey = new Map();
        this.smartMetadataRequestSeq = 0;
        this.skipNextSmartMetadataRefresh = false;
        this.lastSmartMetadataSignature = '';
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
        this.detailsTrailerBtn?.addEventListener('click', () => {
            const url = this.getMovieTrailerUrl(this.currentMovieDetails, this.currentMovie);
            if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
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

    collectImageUrls(value, bucket = []) {
        if (value === null || value === undefined) return bucket;

        if (Array.isArray(value)) {
            value.forEach(entry => this.collectImageUrls(entry, bucket));
            return bucket;
        }

        if (typeof value === 'object') {
            const keys = ['url', 'src', 'image', 'poster', 'backdrop', 'cover', 'big_cover', 'cover_big', 'movie_image', 'thumb', 'original'];
            keys.forEach(key => this.collectImageUrls(value?.[key], bucket));
            return bucket;
        }

        const raw = `${value}`.trim();
        if (!raw) return bucket;
        const lowered = raw.toLowerCase();
        if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a' || lowered === '[]' || lowered === '{}') {
            return bucket;
        }

        if (raw.startsWith('[') || raw.startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                this.collectImageUrls(parsed, bucket);
                if (bucket.length > 0) return bucket;
            } catch (_) {
                // Fallback to string parsing below.
            }
        }

        const normalized = raw.replace(/\\\//g, '/').replace(/[\r\n\t]/g, '').trim();
        if (!normalized) return bucket;

        const matches = normalized.match(/https?:\/\/[^"'\\\],\s]+/gi);
        if (matches && matches.length > 1) {
            matches.forEach(url => bucket.push(url.trim()));
            return bucket;
        }

        const clean = normalized.replace(/^["']+|["']+$/g, '').trim();
        if (!clean) return bucket;

        if (!/^data:image\//i.test(clean) && clean.includes(',')) {
            clean.split(',').map(part => part.trim()).filter(Boolean).forEach(part => bucket.push(part));
            return bucket;
        }

        bucket.push(clean);
        return bucket;
    }

    isLikelyImageUrl(url) {
        const value = `${url || ''}`.trim();
        if (!value) return false;
        const lowered = value.toLowerCase();
        if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a') return false;
        return (
            value.startsWith('http://') ||
            value.startsWith('https://') ||
            value.startsWith('//') ||
            value.startsWith('/') ||
            value.startsWith('img/') ||
            /^data:image\//i.test(value) ||
            /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(value)
        );
    }

    getFirstImageUrl(...values) {
        const raw = [];
        values.forEach(value => this.collectImageUrls(value, raw));
        const unique = [...new Set(raw.map(url => `${url}`.trim()).filter(Boolean))];
        return unique.find(url => this.isLikelyImageUrl(url)) || '';
    }

    getMovieBackdropUrl(movie) {
        const info = movie?.info || {};
        const movieData = movie?.movie_data || {};
        const data = movie?.data || {};
        return this.getFirstImageUrl(
            movie?.backdrop_path,
            info?.backdrop_path,
            movieData?.backdrop_path,
            data?.backdrop_path,
            movie?.backdrop,
            info?.backdrop,
            info?.background,
            movieData?.backdrop,
            movieData?.background,
            movie?.cover_big,
            movie?.big_cover,
            data?.cover_big,
            data?.big_cover,
            movie?.cover,
            data?.cover,
            movie?.stream_icon,
            movie?.poster,
            movie?.poster_path,
            info?.poster,
            info?.poster_path,
            movieData?.poster,
            movieData?.poster_path,
            movie?.image,
            movie?.movie_image,
            movie?.thumb
        );
    }

    getMoviePosterUrl(movie) {
        const info = movie?.info || {};
        const movieData = movie?.movie_data || {};
        return this.getFirstImageUrl(
            movie?.stream_icon,
            movie?.cover,
            movie?.cover_big,
            movie?.big_cover,
            movie?.poster,
            movie?.poster_path,
            info?.poster,
            info?.poster_path,
            movieData?.poster,
            movieData?.poster_path,
            movie?.backdrop_path,
            movie?.backdrop
        );
    }

    setDetailsBackdrop(imageUrl) {
        if (!this.detailsPanel) return;
        this.detailsBackdropLoadId += 1;
        const loadId = this.detailsBackdropLoadId;
        const panel = this.detailsPanel;
        const cleanUrl = `${imageUrl || ''}`.trim().replace(/[\r\n\t]/g, '');
        if (!cleanUrl) {
            panel.style.removeProperty('--details-backdrop-image');
            panel.style.removeProperty('--details-backdrop-size');
            panel.style.removeProperty('--details-backdrop-position');
            return;
        }
        panel.style.setProperty('--details-backdrop-image', `url("${cleanUrl}")`);
        panel.style.setProperty('--details-backdrop-size', 'cover');
        panel.style.setProperty('--details-backdrop-position', 'center center');

        const img = new Image();
        img.onload = () => {
            if (loadId !== this.detailsBackdropLoadId) return;
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (!w || !h) return;

            const imageRatio = w / h;
            const panelRatio = panel.clientWidth > 0 && panel.clientHeight > 0
                ? panel.clientWidth / panel.clientHeight
                : (16 / 9);

            let position = 'center center';

            // Keep full-screen fill for all artwork while nudging focus.
            if (imageRatio < panelRatio * 0.82) {
                position = 'center 18%';
            } else if (imageRatio > panelRatio * 2) {
                // Extra-wide backdrops keep key subject matter in view a bit higher.
                position = 'center 30%';
            }

            panel.style.setProperty('--details-backdrop-size', 'cover');
            panel.style.setProperty('--details-backdrop-position', position);
        };
        img.src = cleanUrl;
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

    normalizeCatalogTitle(rawTitle) {
        let title = String(rawTitle || '').trim();
        if (!title) return '';

        const prefixPattern = /^(?:\[[^\]]+\]\s*|\([^)]+\)\s*|(?:EN|ENG|MULTI|MULTI-SUB|SUB|DUB|4K|UHD|FHD|HD|SD|AMZ|NF|NETFLIX|DSNP|DSNP\+|HMAX|MAX|HULU|ATVP|APPLETV|WEB|WEB-DL|WEBRIP|BLURAY|BDRIP|HDRIP|DVDRIP|X264|X265|HEVC|AAC|DDP5\.1|DD5\.1|IMAX|EXTENDED|REMASTERED)(?:[\s._-]+))+/i;
        while (prefixPattern.test(title)) {
            title = title.replace(prefixPattern, '').trim();
        }

        title = title.replace(/^[-:|._\s]+/, '').trim();

        return title
            .toLowerCase()
            .replace(/['"`]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    getAddedMs(item) {
        const raw = item?.added || item?.added_at || item?.releaseDate || item?.release_date || '';
        if (raw === null || raw === undefined || raw === '') return 0;
        const text = String(raw).trim();
        if (!text) return 0;
        if (/^\d{10,13}$/.test(text)) {
            const n = Number(text);
            return text.length <= 10 ? n * 1000 : n;
        }
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    pickPreferredMovie(existing, candidate) {
        const score = (item) => {
            const hasPoster = this.getMoviePosterUrl(item) ? 1 : 0;
            const rating = this.getMovieRating10(item);
            const votes = this.getMovieVotes(item);
            const year = this.getReleaseYear(item);
            const addedMs = this.getAddedMs(item);
            return (hasPoster * 4)
                + (Math.max(0, Math.min(10, rating)) * 0.35)
                + (Math.log10((votes || 0) + 1) * 0.4)
                + ((year > 0 ? year : 0) * 0.001)
                + ((addedMs > 0 ? addedMs : 0) * 0.0000000001);
        };
        return score(candidate) > score(existing) ? candidate : existing;
    }

    dedupeMoviesForAllCategories(items) {
        const map = new Map();
        for (const item of items) {
            const normalizedTitle = this.normalizeCatalogTitle(item?.name || item?.title || '');
            if (!normalizedTitle) {
                map.set(`fallback:${item.sourceId}:${item.stream_id}`, item);
                continue;
            }

            const year = this.getReleaseYear(item);
            const key = year > 0 ? `${normalizedTitle}:${year}` : normalizedTitle;
            if (!map.has(key)) {
                map.set(key, item);
            } else {
                map.set(key, this.pickPreferredMovie(map.get(key), item));
            }
        }
        return Array.from(map.values());
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

    getCatalogEntityKey(item) {
        const normalizedTitle = this.normalizeCatalogTitle(item?.name || item?.title || '');
        const year = this.getReleaseYear(item);
        if (normalizedTitle) {
            return year > 0 ? `${normalizedTitle}:${year}` : normalizedTitle;
        }
        return `fallback:${item?.sourceId || 'na'}:${item?.stream_id || item?.id || 'na'}`;
    }

    getExternalDiscoverScore(movie) {
        const key = `movie:${this.getCatalogEntityKey(movie)}`;
        const metadata = this.externalMetadataByKey.get(key);
        return this.parseNumber(metadata?.smart?.score, 0);
    }

    getSmartSortScore(movie, searchTerm = '') {
        const baseScore = this.getSmartDiscoverScore(movie, searchTerm);
        const externalScore = this.getExternalDiscoverScore(movie);
        return (baseScore * 0.62) + (externalScore * 0.38);
    }

    applyExternalMetadataToMovie(movie, metadata) {
        if (!movie || !metadata) return;
        const merged = metadata.merged || {};
        const smart = metadata.smart || {};
        const smartRating = this.parseNumber(smart.rating10, 0);
        const smartVotes = Math.max(0, Math.floor(this.parseNumber(smart.votes, 0)));
        const smartPercent = Math.max(0, Math.min(100, Math.floor(this.parseNumber(smart.ratingPercent, 0))));
        if (merged.plot && !movie.plot && !movie.description && !movie.overview) movie.plot = merged.plot;
        if (merged.genre && !movie.genre) movie.genre = merged.genre;
        if (merged.director && !movie.director) movie.director = merged.director;
        if (merged.cast && !movie.cast && !movie.actors) movie.cast = merged.cast;
        if (merged.runtime && !movie.duration && !movie.runtime) movie.runtime = merged.runtime;
        if (merged.poster && !this.getMoviePosterUrl(movie)) movie.cover = merged.poster;
        if (merged.backdrop && !movie.backdrop_path && !movie.backdrop) movie.backdrop_path = merged.backdrop;
        if (smartRating > 0) {
            movie.smart_rating10 = smartRating;
            movie.rating = smartRating;
        }
        if (smartVotes > 0) {
            movie.smart_votes = smartVotes;
            movie.votes = smartVotes;
        }
        if (smartPercent > 0) movie.smart_rating_percent = smartPercent;
    }

    sortMoviesForDiscover(searchTerm = '') {
        this.filteredMovies.sort((a, b) => {
            const scoreDelta = this.getSmartSortScore(b, searchTerm) - this.getSmartSortScore(a, searchTerm);
            if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;

            const yearDelta = this.getReleaseYear(b) - this.getReleaseYear(a);
            if (yearDelta !== 0) return yearDelta;

            const ratingDelta = this.getMovieRating10(b) - this.getMovieRating10(a);
            if (ratingDelta !== 0) return ratingDelta;

            const votesDelta = this.getMovieVotes(b) - this.getMovieVotes(a);
            if (votesDelta !== 0) return votesDelta;

            return (a.name || '').localeCompare(b.name || '');
        });
    }

    async scheduleSmartMetadataEnrichment(items) {
        if (!Array.isArray(items) || items.length === 0 || !API?.metadata?.enrichBatch) return;

        const candidates = items.map((movie) => ({
            id: this.getCatalogEntityKey(movie),
            title: movie?.name || movie?.title || '',
            year: this.getReleaseYear(movie),
            localRating: this.getProviderMovieRating10(movie),
            localVotes: this.getProviderMovieVotes(movie),
            movie
        })).filter(row => row.id && row.title);

        if (candidates.length === 0) return;

        const signature = `movie:${candidates.map(c => c.id).join('|')}`;
        if (signature === this.lastSmartMetadataSignature) return;
        this.lastSmartMetadataSignature = signature;

        const requestId = ++this.smartMetadataRequestSeq;
        const chunkSize = 40;
        try {
            let changed = false;
            for (let i = 0; i < candidates.length; i += chunkSize) {
                if (requestId !== this.smartMetadataRequestSeq) return;
                const chunk = candidates.slice(i, i + chunkSize);
                const payload = chunk.map(({ id, title, year, localRating, localVotes }) => ({
                    id, title, year, localRating, localVotes
                }));
                const response = await API.metadata.enrichBatch('movie', payload);
                if (requestId !== this.smartMetadataRequestSeq) return;

                chunk.forEach(({ id, movie }) => {
                    const metadata = response?.items?.[id];
                    if (!metadata) return;
                    const mapKey = `movie:${id}`;
                    const prevScore = this.parseNumber(this.externalMetadataByKey.get(mapKey)?.smart?.score, 0);
                    const nextScore = this.parseNumber(metadata?.smart?.score, 0);
                    if (Math.abs(nextScore - prevScore) > 0.0001) changed = true;
                    this.externalMetadataByKey.set(mapKey, metadata);
                    this.applyExternalMetadataToMovie(movie, metadata);
                });
            }

            if (changed) {
                this.skipNextSmartMetadataRefresh = true;
                this.filterAndRender();
            }
        } catch (err) {
            console.warn('Movie metadata enrichment failed:', err?.message || err);
        }
    }

    getProviderMovieRating10(movie) {
        const ratingRaw = this.parseNumber(
            movie?.rating ?? movie?.imdb_rating ?? movie?.tmdb_rating ?? movie?.rating_5based,
            0
        );
        return ratingRaw > 0 ? (ratingRaw <= 5 ? ratingRaw * 2 : ratingRaw) : 0;
    }

    getMovieRating10(movie) {
        const smartRating = this.parseNumber(movie?.smart_rating10 ?? movie?.smart?.rating10, 0);
        if (smartRating > 0) return smartRating <= 5 ? smartRating * 2 : smartRating;
        return this.getProviderMovieRating10(movie);
    }

    getProviderMovieVotes(movie) {
        return Math.max(0, Math.floor(this.parseNumber(
            movie?.votes ?? movie?.vote_count ?? movie?.num ?? movie?.rating_count ?? movie?.review_count ?? movie?.reviews,
            0
        )));
    }

    getMovieVotes(movie) {
        const smartVotes = Math.max(0, Math.floor(this.parseNumber(movie?.smart_votes ?? movie?.smart?.votes, 0)));
        return smartVotes > 0 ? smartVotes : this.getProviderMovieVotes(movie);
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

    getCardCastSnippet(movie) {
        const rawCast = `${(
            movie?.cast ||
            movie?.actors ||
            movie?.starring ||
            movie?.info?.cast ||
            movie?.info?.actors ||
            movie?.movie_data?.cast ||
            movie?.movie_data?.actors ||
            movie?.data?.cast ||
            movie?.data?.actors ||
            ''
        )}`.trim();
        if (!rawCast) return '';
        const firstTwo = rawCast
            .split(',')
            .map(name => name.trim())
            .filter(Boolean)
            .slice(0, 2);
        return firstTwo.join(', ');
    }

    getCardCrewSnippet(movie) {
        const rawCrew = `${(
            movie?.director ||
            movie?.directors ||
            movie?.writer ||
            movie?.writers ||
            movie?.screenplay ||
            movie?.info?.director ||
            movie?.info?.directors ||
            movie?.info?.writer ||
            movie?.info?.writers ||
            movie?.movie_data?.director ||
            movie?.movie_data?.writer ||
            movie?.data?.director ||
            movie?.data?.writer ||
            ''
        )}`.trim();

        if (!rawCrew) return '';
        const first = rawCrew
            .split(',')
            .map(name => name.trim())
            .filter(Boolean)
            .slice(0, 1)
            .join(', ');
        return first ? `Dir: ${first}` : '';
    }

    getCardDescriptionSnippet(movie) {
        const raw = `${movie?.plot || movie?.description || movie?.overview || ''}`.trim();
        if (!raw) return '';
        return raw.length > 92 ? `${raw.slice(0, 89)}...` : raw;
    }

    getMovieCardExtraText(movie) {
        const plot = this.getCardDescriptionSnippet(movie);
        return plot || '';
    }

    getMovieCast(details = null, movie = null) {
        const info = details?.info || {};
        const movieData = details?.movie_data || {};
        const rawCast =
            info.cast ||
            info.actors ||
            info.starring ||
            movieData.cast ||
            movieData.actors ||
            movie?.cast ||
            movie?.actors ||
            '';

        const cast = `${rawCast}`.trim();
        if (!cast) return '';
        return cast.length > 200 ? `${cast.slice(0, 197)}...` : cast;
    }

    toYoutubeWatchUrl(value) {
        const raw = `${value || ''}`.trim();
        if (!raw) return '';
        if (/^[a-zA-Z0-9_-]{8,15}$/.test(raw)) {
            return `https://www.youtube.com/watch?v=${raw}`;
        }
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        return '';
    }

    getMovieTrailerUrl(details = null, movie = null) {
        const info = details?.info || {};
        const movieData = details?.movie_data || {};
        const trailerCandidates = [
            info.youtube_trailer,
            info.youtube_trailer_id,
            info.trailer,
            info.trailer_url,
            info.trailerUrl,
            movieData.youtube_trailer,
            movieData.trailer,
            movieData.trailer_url,
            movie?.youtube_trailer,
            movie?.trailer,
            movie?.trailer_url
        ];

        for (const candidate of trailerCandidates) {
            const url = this.toYoutubeWatchUrl(candidate);
            if (url) return url;
        }
        return '';
    }

    getExternalProviderSummary(externalMetadata) {
        const providers = externalMetadata?.smart?.providers || {};
        const parts = [];
        if (providers.local) parts.push('Provider');
        if (providers.tmdb) parts.push('TMDB');
        if (providers.omdb) parts.push('OMDb');
        if (!parts.length) return '';
        return parts.join(' + ');
    }

    async getMovieExternalMetadata(movie) {
        if (!movie || !API?.metadata?.enrichBatch) return null;

        const id = this.getCatalogEntityKey(movie);
        const mapKey = `movie:${id}`;
        if (this.externalMetadataByKey.has(mapKey)) {
            return this.externalMetadataByKey.get(mapKey) || null;
        }

        try {
            const payload = [{
                id,
                title: movie?.name || movie?.title || '',
                year: this.getReleaseYear(movie),
                localRating: this.getProviderMovieRating10(movie),
                localVotes: this.getProviderMovieVotes(movie)
            }];
            const response = await API.metadata.enrichBatch('movie', payload);
            const metadata = response?.items?.[id] || null;
            if (metadata) {
                this.externalMetadataByKey.set(mapKey, metadata);
                this.applyExternalMetadataToMovie(movie, metadata);
            }
            return metadata;
        } catch (err) {
            console.warn('Movie detail metadata enrichment failed:', err?.message || err);
            return null;
        }
    }

    getMergedMovieData(movie, details = null, externalMetadata = null) {
        const info = details?.info || {};
        const movieData = details?.movie_data || {};
        const merged = {
            ...movie,
            ...movieData,
            ...info
        };

        const external = externalMetadata?.merged || {};
        if (external.plot && !merged.plot && !merged.description && !merged.overview) merged.plot = external.plot;
        if (external.genre && !merged.genre) merged.genre = external.genre;
        if (external.director && !merged.director) merged.director = external.director;
        if (external.cast && !merged.cast && !merged.actors) merged.cast = external.cast;
        if (external.runtime && !merged.duration && !merged.runtime) merged.runtime = external.runtime;
        if (external.poster && !this.getMoviePosterUrl(merged)) merged.cover = external.poster;
        if (external.backdrop && !merged.backdrop_path && !merged.backdrop) merged.backdrop_path = external.backdrop;

        const smart = externalMetadata?.smart || {};
        const smartRating = this.parseNumber(smart.rating10, 0);
        const smartPercent = Math.max(0, Math.min(100, Math.floor(this.parseNumber(smart.ratingPercent, 0))));
        const smartVotes = Math.max(0, Math.floor(this.parseNumber(smart.votes, 0)));
        const smartYear = this.parseNumber(smart.year, 0);
        if (smartRating > 0) {
            merged.smart_rating10 = smartRating;
            merged.rating = smartRating;
        }
        if (smartVotes > 0) {
            merged.smart_votes = smartVotes;
            merged.votes = smartVotes;
        }
        if (smartPercent > 0) merged.smart_rating_percent = smartPercent;
        if (smartYear > 0 && this.getReleaseYear(merged) <= 0) merged.year = smartYear;

        return merged;
    }

    async getMovieDetails(sourceId, streamId) {
        const key = `${sourceId}:${streamId}`;
        if (this.movieDetailsCache.has(key)) {
            return this.movieDetailsCache.get(key);
        }

        const details = await API.proxy.xtream.vodInfo(sourceId, streamId);
        this.movieDetailsCache.set(key, details || null);
        return details || null;
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
            this.filteredMovies = this.dedupeMoviesForAllCategories(this.filteredMovies);
            this.sortMoviesForDiscover(searchTerm);
        }

        if (this.skipNextSmartMetadataRefresh) {
            this.skipNextSmartMetadataRefresh = false;
        } else {
            this.scheduleSmartMetadataEnrichment(this.filteredMovies);
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

        const poster = this.getMoviePosterUrl(movie) || '/img/LurkedTV.png';
        const yearValue = this.getReleaseYear(movie);
        const year = yearValue > 0 ? String(yearValue) : '';
        const normalizedRating = this.getMovieRating10(movie);
        const rating = normalizedRating > 0 ? `${Icons.star} ${Math.round(normalizedRating)}` : '';
        const extra = this.getMovieCardExtraText(movie);

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
                ${extra ? `<div class="movie-meta-extra" title="${this.escapeHtml(extra)}">${this.escapeHtml(extra)}</div>` : ''}
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
        this.currentMovieDetails = null;
        this.container.classList.add('hidden');
        this.detailsPanel.classList.remove('hidden');

        const poster = movie.stream_icon || movie.cover || '/img/LurkedTV.png';
        this.setDetailsBackdrop(this.getMovieBackdropUrl(movie));
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
        let externalMetadata = null;
        const [detailsResult, externalResult] = await Promise.allSettled([
            this.getMovieDetails(movie.sourceId, movie.stream_id),
            this.getMovieExternalMetadata(movie)
        ]);
        if (detailsResult.status === 'fulfilled') {
            details = detailsResult.value;
            this.currentMovieDetails = details;
        } else if (detailsResult.reason) {
            console.warn('Failed to load movie details:', detailsResult.reason?.message || detailsResult.reason);
        }
        if (externalResult.status === 'fulfilled') {
            externalMetadata = externalResult.value;
        }

        const merged = this.getMergedMovieData(movie, details, externalMetadata);
        if (this.detailsPoster) {
            this.detailsPoster.src = this.getMoviePosterUrl(merged) || '/img/LurkedTV.png';
        }
        this.setDetailsBackdrop(this.getMovieBackdropUrl(merged));

        if (this.detailsPlot) {
            const synopsis = this.getMovieDescription(merged, details);
            this.detailsPlot.textContent = synopsis || 'Description unavailable.';
            this.detailsPlot.style.display = '';
        }

        if (this.detailsCast) {
            const cast = this.getMovieCast(details, merged);
            if (cast) {
                this.detailsCast.textContent = `Cast: ${cast}`;
                this.detailsCast.classList.remove('hidden');
            } else {
                this.detailsCast.textContent = '';
                this.detailsCast.classList.add('hidden');
            }
        }

        const trailerUrl = this.getMovieTrailerUrl(details, merged);
        if (this.detailsTrailerBtn) {
            this.detailsTrailerBtn.classList.toggle('hidden', !trailerUrl);
            this.detailsTrailerBtn.disabled = !trailerUrl;
        }

        const year = this.getReleaseYear(merged);
        const rating10 = this.getMovieRating10(merged);
        const ratingPercent = Math.max(0, Math.min(100, Math.floor(this.parseNumber(
            merged?.smart_rating_percent ?? externalMetadata?.smart?.ratingPercent,
            rating10 > 0 ? rating10 * 10 : 0
        ))));
        const votes = this.getMovieVotes(merged);
        const duration = merged.duration || merged.runtime || '';

        if (this.detailsMeta) {
            const metaBits = [];
            if (year > 0) metaBits.push(`<span>${year}</span>`);
            if (duration) metaBits.push(`<span>${duration}</span>`);
            if (merged.genre) metaBits.push(`<span>${merged.genre}</span>`);
            if (merged.country) metaBits.push(`<span>${merged.country}</span>`);
            if (merged.director) metaBits.push(`<span>Dir: ${merged.director}</span>`);
            if (merged.container_extension) metaBits.push(`<span>${String(merged.container_extension).toUpperCase()}</span>`);
            this.detailsMeta.innerHTML = metaBits.join('');
        }

        if (this.detailsRatingScore) {
            if (rating10 > 0) {
                this.detailsRatingScore.innerHTML = `${Icons.star} ${rating10.toFixed(1)}/10 (${ratingPercent}%)`;
            } else {
                this.detailsRatingScore.textContent = 'Not Rated';
            }
        }

        if (this.detailsRatingCount) {
            const sourceSummary = this.getExternalProviderSummary(externalMetadata);
            const baseVotes = this.formatVotes(votes);
            this.detailsRatingCount.textContent = sourceSummary ? `${baseVotes} • ${sourceSummary}` : baseVotes;
        }
    }

    hideDetails() {
        if (this.detailsPanel) {
            this.detailsPanel.classList.add('hidden');
        }
        this.setDetailsBackdrop('');
        this.container.classList.remove('hidden');
        this.currentMovie = null;
        this.currentMovieDetails = null;
    }

    async playMovie(movie) {
        try {
            let details = null;
            try {
                details = await this.getMovieDetails(movie.sourceId, movie.stream_id);
            } catch (err) {
                console.warn('Failed to load movie metadata before playback:', err.message);
            }

            const merged = this.getMergedMovieData(movie, details);
            // Get stream URL for movie using the actual container extension from API
            // Xtream API returns container_extension (e.g., 'mp4', 'mkv', 'avi')
            const container = merged.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(movie.sourceId, movie.stream_id, 'movie', container);

            if (result && result.url) {
                // Play in dedicated Watch page
                if (this.app.pages.watch) {
                    this.app.pages.watch.play({
                        type: 'movie',
                        id: movie.stream_id,
                        title: merged.name || movie.name,
                        poster: merged.stream_icon || merged.cover || movie.stream_icon || movie.cover,
                        description: this.getMovieDescription(merged, details),
                        year: this.getReleaseYear(merged) || movie.year || movie.releaseDate?.substring(0, 4),
                        rating: this.getMovieRating10(merged) || merged.rating,
                        duration: merged.duration || merged.runtime || '',
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

