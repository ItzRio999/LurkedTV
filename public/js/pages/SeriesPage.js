/**
 * Series Page Controller
 * Handles TV series browsing and playback
 */

class SeriesPage {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('series-grid');
        this.sourceSelect = document.getElementById('series-source-select');
        this.categorySelect = document.getElementById('series-category-select');
        this.languageSelect = document.getElementById('series-language-select');
        this.searchInput = document.getElementById('series-search');
        this.detailsPanel = document.getElementById('series-details');
        this.detailsCast = document.getElementById('series-cast');
        this.detailsTrailerBtn = document.getElementById('series-details-trailer-btn');
        this.seasonsContainer = document.getElementById('series-seasons');

        this.seriesList = [];
        this.categories = [];
        this.sources = [];
        this.currentBatch = 0;
        this.batchSize = 24;
        this.filteredSeries = [];
        this.isLoading = false;
        this.observer = null;
        this.hiddenCategoryIds = new Set();
        this.currentSeries = null;
        this.currentSeriesInfo = null;
        this.seriesInfoCache = new Map();
        this.favoriteIds = new Set(); // Track favorite series IDs
        this.showFavoritesOnly = false;
        this.categoryNameMap = new Map();
        this.detailsBackdropLoadId = 0;
        this.externalMetadataByKey = new Map();
        this.smartMetadataRequestSeq = 0;
        this.skipNextSmartMetadataRefresh = false;
        this.lastSmartMetadataSignature = '';

        this.init();
    }

    init() {
        // Source change handler
        this.sourceSelect?.addEventListener('change', async () => {
            await this.loadCategories();
            await this.loadSeries();
        });

        // Category change handler
        this.categorySelect?.addEventListener('change', () => {
            this.loadSeries();
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

        // Back button
        document.querySelector('.series-back-btn')?.addEventListener('click', () => {
            this.hideDetails();
        });

        // Set up IntersectionObserver for lazy loading
        this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.isLoading) {
                this.renderNextBatch();
            }
        }, { rootMargin: '200px' });

        // Favorites filter toggle
        const favBtn = document.getElementById('series-favorites-btn');
        favBtn?.addEventListener('click', () => {
            this.showFavoritesOnly = !this.showFavoritesOnly;
            favBtn.classList.toggle('active', this.showFavoritesOnly);
            this.filterAndRender();
        });

        this.detailsTrailerBtn?.addEventListener('click', () => {
            const url = this.getSeriesTrailerUrl(this.currentSeriesInfo, this.currentSeries);
            if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        });
    }

    async show() {
        // Hide details panel when showing page
        this.hideDetails();

        // Load sources if not loaded
        // Load sources if not loaded
        if (this.sources.length === 0) {
            await this.loadSources();
        }

        // Load favorites
        await this.loadFavorites();

        // Load series if empty
        if (this.seriesList.length === 0) {
            await this.loadCategories();
            await this.loadSeries();
            return;
        }

        // Ensure grid is rebuilt when returning from Watch/details.
        this.filterAndRender();
    }

    hide() {
        // Page is hidden
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

    getSeriesBackdropUrl(series) {
        const info = series?.info || {};
        const data = series?.data || {};
        return this.getFirstImageUrl(
            series?.backdrop_path,
            info?.backdrop_path,
            data?.backdrop_path,
            series?.backdrop,
            info?.backdrop,
            info?.background,
            series?.cover_big,
            series?.big_cover,
            data?.cover_big,
            data?.big_cover,
            series?.cover,
            data?.cover,
            series?.poster,
            series?.poster_path,
            info?.poster,
            info?.poster_path,
            series?.image,
            series?.movie_image,
            series?.thumb
        );
    }

    getSeriesPosterUrl(series) {
        const info = series?.info || {};
        return this.getFirstImageUrl(
            series?.cover,
            series?.cover_big,
            series?.big_cover,
            series?.poster,
            series?.poster_path,
            info?.poster,
            info?.poster_path,
            series?.backdrop_path,
            series?.backdrop
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

            if (imageRatio < panelRatio * 0.82) {
                position = 'center 18%';
            } else if (imageRatio > panelRatio * 2) {
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
        const raw = item?.last_modified || item?.added || item?.added_at || item?.releaseDate || item?.release_date || '';
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

    pickPreferredSeries(existing, candidate) {
        const score = (item) => {
            const hasPoster = this.getSeriesPosterUrl(item) ? 1 : 0;
            const rating = this.getSeriesRating10(item);
            const votes = this.getSeriesVotes(item);
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

    dedupeSeriesForAllCategories(items) {
        const map = new Map();
        for (const item of items) {
            const normalizedTitle = this.normalizeCatalogTitle(item?.name || item?.title || '');
            if (!normalizedTitle) {
                map.set(`fallback:${item.sourceId}:${item.series_id}`, item);
                continue;
            }

            const year = this.getReleaseYear(item);
            const key = year > 0 ? `${normalizedTitle}:${year}` : normalizedTitle;
            if (!map.has(key)) {
                map.set(key, item);
            } else {
                map.set(key, this.pickPreferredSeries(map.get(key), item));
            }
        }
        return Array.from(map.values());
    }

    getSmartDiscoverScore(series, searchTerm = '') {
        const nowYear = new Date().getUTCFullYear();
        const ratingRaw = this.parseNumber(
            series?.rating ?? series?.imdb_rating ?? series?.tmdb_rating ?? series?.rating_5based,
            0
        );
        const rating10 = ratingRaw <= 5 ? ratingRaw * 2 : ratingRaw;
        const ratingNorm = Math.max(0, Math.min(1, rating10 / 10));

        const votes = this.parseNumber(
            series?.votes ?? series?.vote_count ?? series?.num ?? series?.rating_count ?? series?.review_count ?? series?.reviews,
            0
        );
        const votesNorm = Math.max(0, Math.min(1, Math.log10(votes + 1) / 5));

        const year = this.getReleaseYear(series);
        const age = year > 0 ? Math.max(0, nowYear - year) : 40;
        const recencyNorm = Math.max(0, Math.min(1, 1 - (age / 25)));

        const isFav = this.favoriteIds.has(`${series.sourceId}:${series.series_id}`) ? 1 : 0;
        const title = series?.name?.toLowerCase() || '';
        const searchBonus = searchTerm && title.startsWith(searchTerm) ? 0.06 : 0;

        return (ratingNorm * 0.58) + (votesNorm * 0.22) + (recencyNorm * 0.16) + (isFav * 0.04) + searchBonus;
    }

    getCatalogEntityKey(item) {
        const normalizedTitle = this.normalizeCatalogTitle(item?.name || item?.title || '');
        const year = this.getReleaseYear(item);
        if (normalizedTitle) {
            return year > 0 ? `${normalizedTitle}:${year}` : normalizedTitle;
        }
        return `fallback:${item?.sourceId || 'na'}:${item?.series_id || item?.id || 'na'}`;
    }

    getExternalDiscoverScore(series) {
        const key = `series:${this.getCatalogEntityKey(series)}`;
        const metadata = this.externalMetadataByKey.get(key);
        return this.parseNumber(metadata?.smart?.score, 0);
    }

    getSmartSortScore(series, searchTerm = '') {
        const baseScore = this.getSmartDiscoverScore(series, searchTerm);
        const externalScore = this.getExternalDiscoverScore(series);
        return (baseScore * 0.62) + (externalScore * 0.38);
    }

    applyExternalMetadataToSeries(series, metadata) {
        if (!series || !metadata) return;
        const merged = metadata.merged || {};
        if (merged.plot && !series.plot && !series.description && !series.overview) series.plot = merged.plot;
        if (merged.genre && !series.genre) series.genre = merged.genre;
        if (merged.director && !series.director) series.director = merged.director;
        if (merged.cast && !series.cast && !series.actors) series.cast = merged.cast;
        if (merged.runtime && !series.duration && !series.runtime) series.runtime = merged.runtime;
        if (merged.poster && !this.getSeriesPosterUrl(series)) series.cover = merged.poster;
        if (merged.backdrop && !series.backdrop_path && !series.backdrop) series.backdrop_path = merged.backdrop;
    }

    sortSeriesForDiscover(searchTerm = '') {
        this.filteredSeries.sort((a, b) => {
            const scoreDelta = this.getSmartSortScore(b, searchTerm) - this.getSmartSortScore(a, searchTerm);
            if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;

            const yearDelta = this.getReleaseYear(b) - this.getReleaseYear(a);
            if (yearDelta !== 0) return yearDelta;

            const ratingDelta = this.getSeriesRating10(b) - this.getSeriesRating10(a);
            if (ratingDelta !== 0) return ratingDelta;

            const votesDelta = this.getSeriesVotes(b) - this.getSeriesVotes(a);
            if (votesDelta !== 0) return votesDelta;

            return (a.name || '').localeCompare(b.name || '');
        });
    }

    async scheduleSmartMetadataEnrichment(items) {
        if (!Array.isArray(items) || items.length === 0 || !API?.metadata?.enrichBatch) return;

        const candidates = items.slice(0, 120).map((series) => ({
            id: this.getCatalogEntityKey(series),
            title: series?.name || series?.title || '',
            year: this.getReleaseYear(series),
            localRating: this.getSeriesRating10(series),
            localVotes: this.getSeriesVotes(series),
            series
        })).filter(row => row.id && row.title);

        if (candidates.length === 0) return;

        const signature = `series:${candidates.map(c => c.id).join('|')}`;
        if (signature === this.lastSmartMetadataSignature) return;
        this.lastSmartMetadataSignature = signature;

        const requestId = ++this.smartMetadataRequestSeq;
        try {
            const payload = candidates.map(({ id, title, year, localRating, localVotes }) => ({
                id, title, year, localRating, localVotes
            }));
            const response = await API.metadata.enrichBatch('series', payload);
            if (requestId !== this.smartMetadataRequestSeq) return;

            let changed = false;
            candidates.forEach(({ id, series }) => {
                const metadata = response?.items?.[id];
                if (!metadata) return;
                const mapKey = `series:${id}`;
                const prevScore = this.parseNumber(this.externalMetadataByKey.get(mapKey)?.smart?.score, 0);
                const nextScore = this.parseNumber(metadata?.smart?.score, 0);
                if (Math.abs(nextScore - prevScore) > 0.0001) changed = true;
                this.externalMetadataByKey.set(mapKey, metadata);
                this.applyExternalMetadataToSeries(series, metadata);
            });

            if (changed) {
                this.skipNextSmartMetadataRefresh = true;
                this.filterAndRender();
            }
        } catch (err) {
            console.warn('Series metadata enrichment failed:', err?.message || err);
        }
    }

    getSeriesRating10(series) {
        const ratingRaw = this.parseNumber(
            series?.rating ?? series?.imdb_rating ?? series?.tmdb_rating ?? series?.rating_5based,
            0
        );
        return ratingRaw > 0 ? (ratingRaw <= 5 ? ratingRaw * 2 : ratingRaw) : 0;
    }

    getSeriesVotes(series) {
        return Math.max(0, Math.floor(this.parseNumber(
            series?.votes ?? series?.vote_count ?? series?.num ?? series?.rating_count ?? series?.review_count ?? series?.reviews,
            0
        )));
    }

    formatVotes(count) {
        if (!Number.isFinite(count) || count <= 0) return 'No rating votes yet';
        if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M votes`;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}K votes`;
        return `${count} votes`;
    }

    escapeHtml(value) {
        return `${value ?? ''}`
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    formatEpisodeDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    getEpisodeRating10(ep) {
        const raw = this.parseNumber(
            ep?.rating ??
            ep?.info?.rating ??
            ep?.info?.vote_average ??
            ep?.movie_data?.rating,
            0
        );
        return raw > 0 ? (raw <= 5 ? raw * 2 : raw) : 0;
    }

    getEpisodeThumb(ep, seriesPoster = '') {
        return (
            ep?.info?.movie_image ||
            ep?.info?.cover_big ||
            ep?.cover ||
            seriesPoster ||
            '/img/LurkedTV.png'
        );
    }

    getCardCastSnippet(series) {
        const rawCast = `${series?.cast || series?.actors || series?.starring || ''}`.trim();
        if (!rawCast) return '';
        const firstTwo = rawCast
            .split(',')
            .map(name => name.trim())
            .filter(Boolean)
            .slice(0, 2);
        return firstTwo.join(', ');
    }

    getCardDescriptionSnippet(series) {
        const raw = `${series?.plot || series?.description || series?.overview || ''}`.trim();
        if (!raw) return '';
        return raw.length > 92 ? `${raw.slice(0, 89)}...` : raw;
    }

    getSeriesCardExtraText(series) {
        return '';
    }

    getSeriesDescription(series, details = null) {
        const info = details?.info || {};
        const raw = info.plot || info.description || info.overview || series?.plot || series?.description || '';
        return `${raw}`.trim();
    }

    getSeriesCast(details = null, series = null) {
        const info = details?.info || {};
        const rawCast =
            info.cast ||
            info.actors ||
            info.starring ||
            series?.cast ||
            series?.actors ||
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

    getSeriesTrailerUrl(details = null, series = null) {
        const info = details?.info || {};
        const trailerCandidates = [
            info.youtube_trailer,
            info.youtube_trailer_id,
            info.trailer,
            info.trailer_url,
            info.trailerUrl,
            series?.youtube_trailer,
            series?.trailer,
            series?.trailer_url
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

    async getSeriesExternalMetadata(series) {
        if (!series || !API?.metadata?.enrichBatch) return null;

        const id = this.getCatalogEntityKey(series);
        const mapKey = `series:${id}`;
        if (this.externalMetadataByKey.has(mapKey)) {
            return this.externalMetadataByKey.get(mapKey) || null;
        }

        try {
            const payload = [{
                id,
                title: series?.name || series?.title || '',
                year: this.getReleaseYear(series),
                localRating: this.getSeriesRating10(series),
                localVotes: this.getSeriesVotes(series)
            }];
            const response = await API.metadata.enrichBatch('series', payload);
            const metadata = response?.items?.[id] || null;
            if (metadata) {
                this.externalMetadataByKey.set(mapKey, metadata);
                this.applyExternalMetadataToSeries(series, metadata);
            }
            return metadata;
        } catch (err) {
            console.warn('Series detail metadata enrichment failed:', err?.message || err);
            return null;
        }
    }

    getMergedSeriesData(series, info = null, externalMetadata = null) {
        const merged = {
            ...series,
            ...(info?.info || {})
        };

        const external = externalMetadata?.merged || {};
        if (external.plot && !merged.plot && !merged.description && !merged.overview) merged.plot = external.plot;
        if (external.genre && !merged.genre) merged.genre = external.genre;
        if (external.director && !merged.director) merged.director = external.director;
        if (external.cast && !merged.cast && !merged.actors) merged.cast = external.cast;
        if (external.runtime && !merged.duration && !merged.runtime) merged.runtime = external.runtime;
        if (external.poster && !this.getSeriesPosterUrl(merged)) merged.cover = external.poster;
        if (external.backdrop && !merged.backdrop_path && !merged.backdrop) merged.backdrop_path = external.backdrop;

        const smart = externalMetadata?.smart || {};
        const smartRating = this.parseNumber(smart.rating10, 0);
        const smartVotes = Math.max(0, Math.floor(this.parseNumber(smart.votes, 0)));
        const smartYear = this.parseNumber(smart.year, 0);
        if (smartRating > 0 && this.getSeriesRating10(merged) <= 0) merged.rating = smartRating;
        if (smartVotes > 0 && this.getSeriesVotes(merged) <= 0) merged.votes = smartVotes;
        if (smartYear > 0 && this.getReleaseYear(merged) <= 0) merged.year = smartYear;

        return merged;
    }

    async getSeriesInfo(sourceId, seriesId) {
        const key = `${sourceId}:${seriesId}`;
        if (this.seriesInfoCache.has(key)) {
            return this.seriesInfoCache.get(key);
        }

        const info = await API.proxy.xtream.seriesInfo(sourceId, seriesId);
        this.seriesInfoCache.set(key, info || null);
        return info || null;
    }

    async loadFavorites() {
        try {
            const favs = await API.favorites.getAll(null, 'series');
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
            this.hiddenCategoryIds = new Set();
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
                        if (h.item_type === 'series_category') {
                            this.hiddenCategoryIds.add(`${source.id}:${h.item_id}`);
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load hidden items from source ${source.id}`);
                }
            }

            for (const source of sourcesToLoad) {
                try {
                    const cats = await API.proxy.xtream.seriesCategories(source.id);
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
                    console.warn(`Failed to load series categories from source ${source.id}:`, err.message);
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

    async loadSeries() {
        this.isLoading = true;
        this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            this.seriesList = [];

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
                            continue;
                        }
                    }

                    const series = await API.proxy.xtream.series(source.id, catId);
                    console.log(`[Series] Source ${source.id}, Category ${catId || 'ALL'}: Got ${series?.length || 0} series`);
                    if (series && Array.isArray(series)) {
                        series.forEach(s => {
                            // Skip series from hidden categories
                            if (this.hiddenCategoryIds.has(`${source.id}:${s.category_id}`)) {
                                return;
                            }

                            const categoryName = this.categoryNameMap.get(`${source.id}:${s.category_id}`) || '';
                            const languageCode = window.LanguageFilter?.detectLanguage(s, categoryName) || 'unknown';

                            this.seriesList.push({
                                ...s,
                                sourceId: source.id,
                                id: `${source.id}:${s.series_id}`,
                                languageCode
                            });
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load series from source ${source.id}:`, err.message);
                }
            }

            console.log(`[Series] Total loaded: ${this.seriesList.length} series`);
            this.updateLanguageOptions();
            this.filterAndRender();
        } catch (err) {
            console.error('Error loading series:', err);
            this.container.innerHTML = '<div class="empty-state"><p>Error loading series</p></div>';
        } finally {
            this.isLoading = false;
        }
    }

    filterAndRender() {
        const searchTerm = this.searchInput?.value?.toLowerCase() || '';
        const languageFilter = this.languageSelect?.value || '';
        const isAllCategories = !this.categorySelect?.value;

        this.filteredSeries = this.seriesList.filter(s => {
            // Filter by favorites if enabled
            if (this.showFavoritesOnly) {
                const favKey = `${s.sourceId}:${s.series_id}`;
                if (!this.favoriteIds.has(favKey)) return false;
            }
            if (searchTerm && !s.name?.toLowerCase().includes(searchTerm)) {
                return false;
            }
            if (languageFilter && (s.languageCode || 'unknown') !== languageFilter) {
                return false;
            }
            return true;
        });

        if (isAllCategories) {
            this.filteredSeries = this.dedupeSeriesForAllCategories(this.filteredSeries);
            this.sortSeriesForDiscover(searchTerm);
            if (this.skipNextSmartMetadataRefresh) {
                this.skipNextSmartMetadataRefresh = false;
            } else {
                this.scheduleSmartMetadataEnrichment(this.filteredSeries);
            }
        } else {
            this.lastSmartMetadataSignature = '';
        }

        console.log(`[Series] Displaying ${this.filteredSeries.length} of ${this.seriesList.length} series`);

        this.currentBatch = 0;
        this.container.innerHTML = '';

        if (this.filteredSeries.length === 0) {
            this.container.innerHTML = '<div class="empty-state"><p>No series found</p></div>';
            return;
        }

        // Create loader element
        const loader = document.createElement('div');
        loader.className = 'series-loader';
        loader.innerHTML = '<div class="loading-spinner"></div>';
        this.container.appendChild(loader);

        // Render initial batches
        for (let i = 0; i < 5; i++) {
            this.renderNextBatch();
        }

        // Start observing loader
        this.observer.observe(loader);
    }

    updateLanguageOptions() {
        if (!this.languageSelect) return;

        const previousValue = this.languageSelect.value;
        const counts = new Map();

        this.seriesList.forEach(series => {
            const code = series.languageCode || 'unknown';
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

    renderNextBatch() {
        const start = this.currentBatch * this.batchSize;
        const end = start + this.batchSize;
        const batch = this.filteredSeries.slice(start, end);

        if (batch.length === 0) {
            const loader = this.container.querySelector('.series-loader');
            if (loader) loader.style.display = 'none';
            return;
        }

        const fragment = document.createDocumentFragment();

        batch.forEach(series => {
            const card = document.createElement('div');
            card.className = 'series-card';
            card.dataset.seriesId = series.series_id;
            card.dataset.sourceId = series.sourceId;

            const poster = series.cover || '/img/LurkedTV.png';
            const year = series.year || series.releaseDate?.substring(0, 4) || '';
            const normalizedRating = this.getSeriesRating10(series);
            const rating = normalizedRating > 0 ? `${Icons.star} ${Math.round(normalizedRating)}` : '';
            const extra = this.getSeriesCardExtraText(series);

            const isFav = this.favoriteIds.has(`${series.sourceId}:${series.series_id}`);

            card.innerHTML = `
                <div class="series-poster">
                    <img src="${poster}" alt="${series.name}" 
                         onerror="this.onerror=null;this.src='/img/LurkedTV.png'" loading="lazy">
                    <div class="series-play-overlay">
                        <span class="play-icon">${Icons.play}</span>
                    </div>
                    <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                        <span class="fav-icon">${isFav ? Icons.favorite : Icons.favoriteOutline}</span>
                    </button>
                </div>
                <div class="series-card-info">
                    <div class="series-title">${series.name}</div>
                    <div class="series-meta">
                        ${year ? `<span>${year}</span>` : ''}
                        ${rating ? `<span>${rating}</span>` : ''}
                    </div>
                    ${extra ? `<div class="series-meta-extra" title="${this.escapeHtml(extra)}">${this.escapeHtml(extra)}</div>` : ''}
                </div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.favorite-btn')) {
                    const btn = e.target.closest('.favorite-btn');
                    this.toggleFavorite(series, btn);
                    e.stopPropagation();
                } else {
                    this.showSeriesDetails(series);
                }
            });
            fragment.appendChild(card);
        });

        // Insert before loader
        const loader = this.container.querySelector('.series-loader');
        if (loader) {
            this.container.insertBefore(fragment, loader);
        } else {
            this.container.appendChild(fragment);
        }

        this.currentBatch++;

        // Hide loader if done
        if (end >= this.filteredSeries.length && loader) {
            loader.style.display = 'none';
        }
    }

    async showSeriesDetails(series) {
        this.currentSeries = series;
        this.currentSeriesInfo = null;

        // Show details panel
        this.container.classList.add('hidden');
        this.detailsPanel.classList.remove('hidden');
        this.setDetailsBackdrop(this.getSeriesBackdropUrl(series));

        // Set header info
        document.getElementById('series-poster').src = this.getSeriesPosterUrl(series) || '/img/LurkedTV.png';
        document.getElementById('series-title').textContent = series.name;
        document.getElementById('series-plot').textContent = this.getSeriesDescription(series) || '';
        document.getElementById('series-details-meta').innerHTML = '';
        document.getElementById('series-details-rating-score').textContent = '';
        document.getElementById('series-details-rating-count').textContent = '';
        if (this.detailsCast) {
            this.detailsCast.textContent = '';
            this.detailsCast.classList.add('hidden');
        }
        if (this.detailsTrailerBtn) {
            this.detailsTrailerBtn.classList.add('hidden');
            this.detailsTrailerBtn.disabled = true;
        }

        // Show loading
        this.seasonsContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        try {
            // Fetch series info (seasons/episodes)
            let info = null;
            let externalMetadata = null;
            const [infoResult, externalResult] = await Promise.allSettled([
                this.getSeriesInfo(series.sourceId, series.series_id),
                this.getSeriesExternalMetadata(series)
            ]);
            if (infoResult.status === 'fulfilled') {
                info = infoResult.value;
            } else if (infoResult.reason) {
                throw infoResult.reason;
            }
            if (externalResult.status === 'fulfilled') {
                externalMetadata = externalResult.value;
            }

            const merged = this.getMergedSeriesData(series, info, externalMetadata);
            document.getElementById('series-poster').src = this.getSeriesPosterUrl(merged) || '/img/LurkedTV.png';
            document.getElementById('series-title').textContent = merged.name || series.name;
            this.setDetailsBackdrop(this.getSeriesBackdropUrl(merged));
            const seasonsObj = info?.episodes || {};
            const seasonKeys = Object.keys(seasonsObj);
            const totalEpisodes = seasonKeys.reduce((acc, seasonNum) => {
                const eps = seasonsObj[seasonNum];
                return acc + (Array.isArray(eps) ? eps.length : 0);
            }, 0);

            const year = this.getReleaseYear(merged);
            const rating10 = this.getSeriesRating10(merged);
            const votes = this.getSeriesVotes(merged);
            const metaBits = [];
            if (year > 0) metaBits.push(`<span>${year}</span>`);
            if (totalEpisodes > 0) metaBits.push(`<span>${totalEpisodes} Episodes</span>`);
            if (merged.duration || merged.runtime) metaBits.push(`<span>${merged.duration || merged.runtime}</span>`);
            if (merged.genre) metaBits.push(`<span>${merged.genre}</span>`);
            if (merged.country) metaBits.push(`<span>${merged.country}</span>`);
            if (merged.director) metaBits.push(`<span>Dir: ${merged.director}</span>`);

            document.getElementById('series-details-meta').innerHTML = metaBits.join('');
            document.getElementById('series-plot').textContent = this.getSeriesDescription(merged, info) || 'Description unavailable.';

            if (this.detailsCast) {
                const cast = this.getSeriesCast(info, merged);
                if (cast) {
                    this.detailsCast.textContent = `Cast: ${cast}`;
                    this.detailsCast.classList.remove('hidden');
                } else {
                    this.detailsCast.textContent = '';
                    this.detailsCast.classList.add('hidden');
                }
            }

            const trailerUrl = this.getSeriesTrailerUrl(info, merged);
            if (this.detailsTrailerBtn) {
                this.detailsTrailerBtn.classList.toggle('hidden', !trailerUrl);
                this.detailsTrailerBtn.disabled = !trailerUrl;
            }

            if (rating10 > 0) {
                document.getElementById('series-details-rating-score').innerHTML = `${Icons.star} ${rating10.toFixed(1)}/10`;
            } else {
                document.getElementById('series-details-rating-score').textContent = 'Not Rated';
            }
            const sourceSummary = this.getExternalProviderSummary(externalMetadata);
            const baseVotes = this.formatVotes(votes);
            document.getElementById('series-details-rating-count').textContent = sourceSummary ? `${baseVotes} • ${sourceSummary}` : baseVotes;

            this.currentSeries = merged;
            this.currentSeriesInfo = info;

            if (!info || !info.episodes) {
                this.seasonsContainer.innerHTML = '<p class="hint">No episodes found</p>';
                return;
            }

            // Store series info for WatchPage
            this.currentSeriesInfo = info;

            // Render seasons and episodes
            let html = '';
            const seasons = seasonKeys.sort((a, b) => parseInt(a) - parseInt(b));

            seasons.forEach((seasonNum, index) => {
                const episodes = info.episodes[seasonNum];
                const collapsedClass = index === 0 ? '' : ' collapsed';
                html += `
                <div class="season-group${collapsedClass}">
                    <div class="season-header">
                        <span class="season-expander">${Icons.chevronDown}</span>
                        <span class="season-name">Season ${seasonNum} (${episodes.length} episodes)</span>
                    </div>
                    <div class="episode-list">
                        ${episodes.map(ep => {
                            const episodeTitle = this.escapeHtml(ep.title || `Episode ${ep.episode_num}`);
                            const episodeNum = this.escapeHtml(ep.episode_num || '');
                            const thumb = this.escapeHtml(this.getEpisodeThumb(ep, merged.cover || series.cover || ''));
                            const duration = this.escapeHtml(ep.duration || ep.info?.duration || '');
                            const airDate = this.escapeHtml(this.formatEpisodeDate(ep.releaseDate || ep.release_date || ep.air_date || ep.info?.release_date));
                            const rating10 = this.getEpisodeRating10(ep);
                            const ratingLabel = rating10 > 0 ? `${rating10.toFixed(1)}/10` : '';
                            const overviewRaw = ep.info?.plot || ep.info?.description || ep.plot || ep.description || '';
                            const overview = this.escapeHtml(overviewRaw);

                            const metaBits = [];
                            if (duration) metaBits.push(`<span>${duration}</span>`);
                            if (airDate) metaBits.push(`<span>${airDate}</span>`);
                            if (ratingLabel) metaBits.push(`<span>${Icons.star} ${ratingLabel}</span>`);

                            return `
                            <div class="episode-item" data-episode-id="${ep.id}" data-source-id="${series.sourceId}" data-container="${ep.container_extension || 'mp4'}">
                                <img class="episode-thumb" src="${thumb}" alt="${episodeTitle}" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                                <div class="episode-main">
                                    <div class="episode-top">
                                        <span class="episode-number">E${episodeNum}</span>
                                        <span class="episode-title">${episodeTitle}</span>
                                    </div>
                                    ${metaBits.length ? `<div class="episode-meta">${metaBits.join('')}</div>` : ''}
                                    ${overview ? `<p class="episode-overview">${overview}</p>` : ''}
                                </div>
                            </div>
                        `;
                        }).join('')}
                    </div>
                </div>`;
            });

            this.seasonsContainer.innerHTML = html;

            // Add click handlers
            this.seasonsContainer.querySelectorAll('.season-header').forEach(header => {
                header.addEventListener('click', () => {
                    header.closest('.season-group').classList.toggle('collapsed');
                });
            });

            this.seasonsContainer.querySelectorAll('.episode-item').forEach(ep => {
                ep.addEventListener('click', () => this.playEpisode(ep));
            });

        } catch (err) {
            console.error('Error loading series info:', err);
            this.seasonsContainer.innerHTML = '<p class="hint" style="color: var(--color-error);">Error loading episodes</p>';
        }
    }

    hideDetails() {
        this.detailsPanel.classList.add('hidden');
        this.setDetailsBackdrop('');
        this.container.classList.remove('hidden');
        this.currentSeries = null;
        this.currentSeriesInfo = null;
    }

    async playEpisode(episodeEl) {
        const episodeId = episodeEl.dataset.episodeId;
        const sourceId = parseInt(episodeEl.dataset.sourceId);
        const container = episodeEl.dataset.container || 'mp4';

        // Get season and episode number from the episode element context
        const seasonGroup = episodeEl.closest('.season-group');
        const seasonHeader = seasonGroup?.querySelector('.season-name')?.textContent || '';
        const seasonMatch = seasonHeader.match(/Season (\d+)/);
        const seasonNum = seasonMatch ? seasonMatch[1] : '1';
        const episodeNum = episodeEl.querySelector('.episode-number')?.textContent?.replace('E', '') || '1';

        try {
            // Get stream URL for episode (use 'series' type)
            const result = await API.proxy.xtream.getStreamUrl(sourceId, episodeId, 'series', container);

            if (result && result.url) {
                // Play in dedicated Watch page
                if (this.app.pages.watch) {
                    const episodeTitle = episodeEl.querySelector('.episode-title')?.textContent || `Episode ${episodeNum}`;

                    this.app.pages.watch.play({
                        type: 'series',
                        id: episodeId,
                        title: this.currentSeries?.name || 'Series',
                        subtitle: `S${seasonNum} E${episodeNum} - ${episodeTitle}`,
                        poster: this.currentSeries?.cover,
                        description: this.currentSeries?.plot || '',
                        year: this.currentSeries?.year,
                        rating: this.currentSeries?.rating,
                        sourceId: sourceId,
                        seriesId: this.currentSeries?.series_id,
                        seriesInfo: this.currentSeriesInfo,
                        currentSeason: seasonNum,
                        currentEpisode: episodeNum,
                        duration: episodeEl.querySelector('.episode-duration')?.textContent?.trim() || '',
                        containerExtension: container
                    }, result.url);
                }
            }
        } catch (err) {
            console.error('Error playing episode:', err);
        }
    }

    async toggleFavorite(series, btn) {
        const favKey = `${series.sourceId}:${series.series_id}`;
        const isFav = this.favoriteIds.has(favKey);
        const iconSpan = btn.querySelector('.fav-icon');

        try {
            // Optimistic update
            if (isFav) {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                btn.title = 'Add to Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
                await API.favorites.remove(series.sourceId, series.series_id, 'series');
            } else {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                btn.title = 'Remove from Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
                await API.favorites.add(series.sourceId, series.series_id, 'series');
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

window.SeriesPage = SeriesPage;

