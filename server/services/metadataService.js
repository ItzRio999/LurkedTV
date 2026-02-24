const cache = new Map();

const METADATA_CACHE_TTL_MS = (() => {
    const parsed = Number.parseInt(process.env.METADATA_CACHE_TTL_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : (6 * 60 * 60 * 1000);
})();

const TMDB_API_KEY = String(process.env.TMDB_API_KEY || '').trim();
const OMDB_API_KEY = String(process.env.OMDB_API_KEY || '').trim();
const FETCH_TIMEOUT_MS = 6500;

function normalizeTitle(title) {
    return String(title || '')
        .trim()
        .toLowerCase()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function toYear(value) {
    const n = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : 0;
}

function numberOrZero(value) {
    const raw = String(value ?? '').replace(/[^0-9.\-]/g, '');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeVotes(value) {
    const parsed = numberOrZero(value);
    if (parsed <= 0) return 0;
    return Math.max(0, Math.min(1, Math.log10(parsed + 1) / 6));
}

function normalizePopularity(value) {
    const n = numberOrZero(value);
    if (n <= 0) return 0;
    return n / (n + 80);
}

function getCacheKey(type, title, year) {
    return `${type}:${normalizeTitle(title)}:${toYear(year) || 'na'}`;
}

function readCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if ((Date.now() - hit.at) > METADATA_CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.data;
}

function writeCache(key, data) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 5000) {
        const first = cache.keys().next().value;
        cache.delete(first);
    }
}

async function fetchJson(url) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: ctrl.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function parseTmdbYear(row, type) {
    const dateValue = type === 'series' ? row?.first_air_date : row?.release_date;
    return toYear(String(dateValue || '').slice(0, 4));
}

function chooseTmdbResult(results, requestedYear, type) {
    if (!Array.isArray(results) || results.length === 0) return null;
    const targetYear = toYear(requestedYear);

    const scored = results.slice(0, 8).map(row => {
        const year = parseTmdbYear(row, type);
        const yearPenalty = targetYear > 0 && year > 0 ? Math.min(10, Math.abs(targetYear - year)) : 4;
        const popularity = numberOrZero(row?.popularity);
        const votes = numberOrZero(row?.vote_count);
        const quality = numberOrZero(row?.vote_average);
        const score = (quality * 0.9) + (Math.log10(votes + 1) * 1.8) + (Math.log10(popularity + 1) * 2.1) - (yearPenalty * 0.6);
        return { row, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.row || null;
}

async function fetchTmdb(type, title, year) {
    if (!TMDB_API_KEY || !title) return null;

    const searchPath = type === 'series' ? 'tv' : 'movie';
    const params = new URLSearchParams({
        api_key: TMDB_API_KEY,
        query: String(title),
        include_adult: 'false',
        language: 'en-US',
        page: '1'
    });

    const parsedYear = toYear(year);
    if (parsedYear > 0) {
        if (type === 'series') params.set('first_air_date_year', String(parsedYear));
        else params.set('year', String(parsedYear));
    }

    const payload = await fetchJson(`https://api.themoviedb.org/3/search/${searchPath}?${params.toString()}`);
    const chosen = chooseTmdbResult(payload?.results, parsedYear, type);
    if (!chosen) return null;

    return {
        id: chosen.id,
        title: chosen.title || chosen.name || '',
        rating10: numberOrZero(chosen.vote_average),
        votes: Math.max(0, Math.floor(numberOrZero(chosen.vote_count))),
        popularity: numberOrZero(chosen.popularity),
        year: parseTmdbYear(chosen, type),
        overview: chosen.overview || '',
        poster: chosen.poster_path ? `https://image.tmdb.org/t/p/w500${chosen.poster_path}` : '',
        backdrop: chosen.backdrop_path ? `https://image.tmdb.org/t/p/w780${chosen.backdrop_path}` : ''
    };
}

async function fetchOmdb(type, title, year) {
    if (!OMDB_API_KEY || !title) return null;

    const params = new URLSearchParams({
        apikey: OMDB_API_KEY,
        t: String(title),
        type: type === 'series' ? 'series' : 'movie',
        plot: 'short'
    });
    const parsedYear = toYear(year);
    if (parsedYear > 0) params.set('y', String(parsedYear));

    const payload = await fetchJson(`https://www.omdbapi.com/?${params.toString()}`);
    if (!payload || payload.Response === 'False') return null;

    return {
        id: payload.imdbID || '',
        title: payload.Title || '',
        rating10: numberOrZero(payload.imdbRating),
        votes: Math.max(0, Math.floor(numberOrZero(payload.imdbVotes))),
        metascore: Math.max(0, Math.floor(numberOrZero(payload.Metascore))),
        year: toYear(String(payload.Year || '').split(/[^\d]/)[0]),
        runtime: payload.Runtime || '',
        genre: payload.Genre || '',
        director: payload.Director || '',
        actors: payload.Actors || '',
        plot: payload.Plot || '',
        poster: payload.Poster && payload.Poster !== 'N/A' ? payload.Poster : ''
    };
}

function buildSmartScore(type, item, tmdb, omdb) {
    const nowYear = new Date().getUTCFullYear();
    const localRating10 = numberOrZero(item?.localRating);
    const localVotes = Math.max(0, Math.floor(numberOrZero(item?.localVotes)));
    const fallbackYear = toYear(item?.year);

    const tmdbRating10 = numberOrZero(tmdb?.rating10);
    const omdbRating10 = numberOrZero(omdb?.rating10);
    const tmdbVotes = Math.max(0, Math.floor(numberOrZero(tmdb?.votes)));
    const omdbVotes = Math.max(0, Math.floor(numberOrZero(omdb?.votes)));
    const tmdbPopularity = numberOrZero(tmdb?.popularity);
    const localConfidence = normalizeVotes(localVotes);
    const tmdbConfidence = normalizeVotes(tmdbVotes);
    const omdbConfidence = normalizeVotes(omdbVotes);
    const sourceRatings = {
        local: localRating10 > 0 ? localRating10 : 0,
        tmdb: tmdbRating10 > 0 ? tmdbRating10 : 0,
        omdb: omdbRating10 > 0 ? omdbRating10 : 0
    };

    // Weighted 3-source rating: provider + TMDB + OMDb, with vote confidence.
    const weightedSources = [];
    if (localRating10 > 0) weightedSources.push({ rating: localRating10, weight: 1.05 + (localConfidence * 0.75) });
    if (tmdbRating10 > 0) weightedSources.push({ rating: tmdbRating10, weight: 1.2 + (tmdbConfidence * 1.1) });
    if (omdbRating10 > 0) weightedSources.push({ rating: omdbRating10, weight: 1.25 + (omdbConfidence * 1.15) });

    const totalWeight = weightedSources.reduce((sum, row) => sum + row.weight, 0);
    const rating10 = totalWeight > 0
        ? weightedSources.reduce((sum, row) => sum + (row.rating * row.weight), 0) / totalWeight
        : 0;
    const ratingPercent = Math.max(0, Math.min(100, Math.round(rating10 * 10)));
    const ratingNorm = Math.max(0, Math.min(1, rating10 / 10));

    const votesCombined = localVotes + tmdbVotes + omdbVotes;
    const votesNorm = normalizeVotes(votesCombined);
    const popularityNorm = normalizePopularity(tmdbPopularity);

    const year = toYear(tmdb?.year) || toYear(omdb?.year) || fallbackYear;
    const age = year > 0 ? Math.max(0, nowYear - year) : 35;
    const recencyNorm = Math.max(0, Math.min(1, 1 - (age / 30)));

    const availableRatings = [localRating10, tmdbRating10, omdbRating10].filter(n => n > 0);
    let consensusNorm = 0.45;
    if (availableRatings.length >= 2) {
        const spread = Math.max(...availableRatings) - Math.min(...availableRatings);
        consensusNorm = Math.max(0, 1 - (spread / 5));
    } else if (availableRatings.length === 1) {
        consensusNorm = 0.62;
    }

    const providers = (localRating10 > 0 || localVotes > 0 ? 1 : 0) + (tmdb ? 1 : 0) + (omdb ? 1 : 0);
    const providerCoverageNorm = providers / 3;

    const score = (ratingNorm * 0.34)
        + (votesNorm * 0.24)
        + (popularityNorm * 0.2)
        + (recencyNorm * 0.1)
        + (consensusNorm * 0.08)
        + (providerCoverageNorm * 0.04);

    return {
        type,
        score: Number(score.toFixed(6)),
        rating10: Number(rating10.toFixed(2)),
        ratingPercent,
        votes: votesCombined,
        year,
        ratingSources,
        providers: {
            local: localRating10 > 0 || localVotes > 0,
            tmdb: !!tmdb,
            omdb: !!omdb
        }
    };
}

function buildMergedMetadata(tmdb, omdb) {
    return {
        plot: String(tmdb?.overview || omdb?.plot || '').trim(),
        poster: String(tmdb?.poster || omdb?.poster || '').trim(),
        backdrop: String(tmdb?.backdrop || '').trim(),
        genre: String(omdb?.genre || '').trim(),
        director: String(omdb?.director || '').trim(),
        cast: String(omdb?.actors || '').trim(),
        runtime: String(omdb?.runtime || '').trim()
    };
}

async function enrichItem(type, item) {
    const title = String(item?.title || '').trim();
    if (!title) {
        return {
            smart: buildSmartScore(type, item, null, null),
            tmdb: null,
            omdb: null,
            merged: buildMergedMetadata(null, null)
        };
    }

    const cacheKey = getCacheKey(type, title, item?.year);
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const [tmdb, omdb] = await Promise.all([
        fetchTmdb(type, title, item?.year),
        fetchOmdb(type, title, item?.year)
    ]);

    const result = {
        smart: buildSmartScore(type, item, tmdb, omdb),
        tmdb,
        omdb,
        merged: buildMergedMetadata(tmdb, omdb)
    };

    writeCache(cacheKey, result);
    return result;
}

async function enrichBatch(type, items) {
    const cleanType = type === 'series' ? 'series' : 'movie';
    const safeItems = Array.isArray(items) ? items.slice(0, 120) : [];
    const out = {};

    await Promise.all(safeItems.map(async (item) => {
        const id = String(item?.id || '').trim();
        if (!id) return;
        const result = await enrichItem(cleanType, item);
        out[id] = result;
    }));

    return {
        providerStatus: {
            tmdbEnabled: !!TMDB_API_KEY,
            omdbEnabled: !!OMDB_API_KEY
        },
        items: out
    };
}

module.exports = {
    enrichBatch
};
