/**
 * Global Search Page
 * Searches across movies, series, and live TV and renders grouped results.
 */
class SearchPage {
    constructor(app) {
        this.app = app;
        this.pageTitle = document.getElementById('search-page-title');
        this.pageSubtitle = document.getElementById('search-page-subtitle');
        this.resultsEl = document.getElementById('search-page-results');
        this.navSearchInput = document.getElementById('global-search');

        this.currentQuery = '';
        this.searchToken = 0;
        this.movieResults = [];
        this.seriesResults = [];
        this.liveResults = [];
    }

    async show() {
        if (this.navSearchInput && this.navSearchInput.value !== this.currentQuery) {
            this.navSearchInput.value = this.currentQuery;
        }
        await this.runSearch(this.currentQuery);
    }

    hide() {
        // No-op.
    }

    async setQuery(query, navigate = true) {
        this.currentQuery = (query || '').trim();
        if (this.navSearchInput && this.navSearchInput.value !== this.currentQuery) {
            this.navSearchInput.value = this.currentQuery;
        }

        if (navigate && this.currentQuery && this.app.currentPage !== 'search') {
            this.app.navigateTo('search');
            return;
        }

        if (this.app.currentPage === 'search') {
            await this.runSearch(this.currentQuery);
        }
    }

    async ensureDataLoaded() {
        const tasks = [];

        if (!this.app.channelList.channels || this.app.channelList.channels.length === 0) {
            tasks.push((async () => {
                await this.app.channelList.loadSources();
                await this.app.channelList.loadChannels();
            })());
        }

        if (!this.app.pages.movies.movies || this.app.pages.movies.movies.length === 0) {
            tasks.push((async () => {
                await this.app.pages.movies.loadSources();
                await this.app.pages.movies.loadCategories();
                await this.app.pages.movies.loadMovies();
            })());
        }

        if (!this.app.pages.series.seriesList || this.app.pages.series.seriesList.length === 0) {
            tasks.push((async () => {
                await this.app.pages.series.loadSources();
                await this.app.pages.series.loadCategories();
                await this.app.pages.series.loadSeries();
            })());
        }

        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }

    scoreMatch(text, query) {
        if (!text) return 0;
        const source = String(text).toLowerCase();
        if (source === query) return 100;
        if (source.startsWith(query)) return 60;
        const idx = source.indexOf(query);
        if (idx >= 0) return 30 - Math.min(20, idx);
        return 0;
    }

    takeBestMatches(items, query, textFn, limit = 40) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const scored = [];
        for (const item of items) {
            const titleScore = this.scoreMatch(textFn(item), query);
            if (titleScore <= 0) continue;
            scored.push({ item, score: titleScore });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(s => s.item);
    }

    escapeHtml(value) {
        return `${value || ''}`
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    renderEmpty(message = 'Type at least 2 characters to search all content.') {
        if (this.pageTitle) this.pageTitle.textContent = 'Search';
        if (this.pageSubtitle) this.pageSubtitle.textContent = message;
        if (this.resultsEl) {
            this.resultsEl.innerHTML = '<div class="empty-state"><p>Search movies, series, and live TV from one place.</p></div>';
        }
    }

    renderLoading(query) {
        if (this.pageTitle) this.pageTitle.textContent = `Search: "${query}"`;
        if (this.pageSubtitle) this.pageSubtitle.textContent = 'Searching across all categories...';
        if (this.resultsEl) {
            this.resultsEl.innerHTML = '<div class="loading-state"><div class="loading"></div><span>Searching...</span></div>';
        }
    }

    renderResults(query) {
        const movieCount = this.movieResults.length;
        const seriesCount = this.seriesResults.length;
        const liveCount = this.liveResults.length;
        const total = movieCount + seriesCount + liveCount;

        if (this.pageTitle) this.pageTitle.textContent = `Search: "${query}"`;
        if (this.pageSubtitle) this.pageSubtitle.textContent = `${total} result${total === 1 ? '' : 's'} found`;

        if (total === 0) {
            this.resultsEl.innerHTML = `<div class="empty-state"><p>No results found for "${this.escapeHtml(query)}".</p></div>`;
            return;
        }

        const moviesHtml = movieCount ? `
            <section class="search-section">
                <h3 class="search-section-title">Movies (${movieCount})</h3>
                <div class="search-results-grid" id="search-movie-results">
                    ${this.movieResults.map((movie, index) => `
                        <article class="search-result-card" data-index="${index}">
                            <img class="search-result-poster" src="${this.escapeHtml(movie.stream_icon || movie.cover || '/img/LurkedTV.png')}" alt="${this.escapeHtml(movie.name || 'Movie')}" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                            <div class="search-result-body">
                                <div class="search-result-title">${this.escapeHtml(movie.name || 'Untitled')}</div>
                                <div class="search-result-meta">${this.escapeHtml(movie.year || movie.releaseDate?.substring(0, 4) || '')}</div>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        ` : '';

        const seriesHtml = seriesCount ? `
            <section class="search-section">
                <h3 class="search-section-title">Series (${seriesCount})</h3>
                <div class="search-results-grid" id="search-series-results">
                    ${this.seriesResults.map((series, index) => `
                        <article class="search-result-card" data-index="${index}">
                            <img class="search-result-poster" src="${this.escapeHtml(series.cover || series.stream_icon || '/img/LurkedTV.png')}" alt="${this.escapeHtml(series.name || 'Series')}" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                            <div class="search-result-body">
                                <div class="search-result-title">${this.escapeHtml(series.name || 'Untitled')}</div>
                                <div class="search-result-meta">${this.escapeHtml(series.year || '')}</div>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        ` : '';

        const liveHtml = liveCount ? `
            <section class="search-section">
                <h3 class="search-section-title">Live TV (${liveCount})</h3>
                <div class="search-live-list" id="search-live-results">
                    ${this.liveResults.map((channel, index) => `
                        <article class="search-live-item" data-index="${index}">
                            <img class="search-live-logo" src="${this.escapeHtml(channel.logo || '/img/LurkedTV.png')}" alt="${this.escapeHtml(channel.name || 'Channel')}" onerror="this.onerror=null;this.src='/img/LurkedTV.png'">
                            <div>
                                <div class="search-live-title">${this.escapeHtml(channel.name || 'Untitled')}</div>
                                <div class="search-live-meta">${this.escapeHtml(channel.groupTitle || channel.sourceName || '')}</div>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        ` : '';

        this.resultsEl.innerHTML = `<div class="search-results-stack">${moviesHtml}${seriesHtml}${liveHtml}</div>`;
        this.attachHandlers();
    }

    attachHandlers() {
        this.resultsEl.querySelectorAll('#search-movie-results .search-result-card').forEach(card => {
            card.addEventListener('click', () => {
                const movie = this.movieResults[Number(card.dataset.index)];
                if (!movie) return;
                this.app.pages.movies.playMovie(movie);
            });
        });

        this.resultsEl.querySelectorAll('#search-series-results .search-result-card').forEach(card => {
            card.addEventListener('click', () => {
                const series = this.seriesResults[Number(card.dataset.index)];
                if (!series) return;
                this.app.navigateTo('series');
                this.app.pages.series.showDetails(series);
            });
        });

        this.resultsEl.querySelectorAll('#search-live-results .search-live-item').forEach(item => {
            item.addEventListener('click', async () => {
                const channel = this.liveResults[Number(item.dataset.index)];
                if (!channel) return;
                this.app.navigateTo('live');
                await this.app.channelList.selectChannel({ channelId: channel.id, sourceId: channel.sourceId });
            });
        });
    }

    async runSearch(query) {
        const normalized = (query || '').trim().toLowerCase();
        if (!normalized || normalized.length < 2) {
            this.movieResults = [];
            this.seriesResults = [];
            this.liveResults = [];
            this.renderEmpty();
            return;
        }

        const token = ++this.searchToken;
        this.renderLoading(normalized);
        await this.ensureDataLoaded();
        if (token !== this.searchToken) return;

        this.movieResults = this.takeBestMatches(
            this.app.pages.movies.movies,
            normalized,
            movie => movie?.name,
            36
        );
        this.seriesResults = this.takeBestMatches(
            this.app.pages.series.seriesList,
            normalized,
            series => series?.name,
            36
        );
        this.liveResults = this.takeBestMatches(
            this.app.channelList.channels,
            normalized,
            channel => channel?.name,
            30
        );

        if (token !== this.searchToken) return;
        this.renderResults(normalized);
    }
}

window.SearchPage = SearchPage;

