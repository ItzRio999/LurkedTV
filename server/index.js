const express = require('express');
const path = require('path');

// Initialize database
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// FFMPEG Configuration (optional - for transcoding support)
try {
    let ffmpegPath = require('ffmpeg-static');

    // In packaged Electron apps, ffmpeg-static returns path inside .asar archive
    // but the binary is actually unpacked to app.asar.unpacked
    if (ffmpegPath && ffmpegPath.includes('app.asar')) {
        ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }

    app.locals.ffmpegPath = ffmpegPath;
    console.log('FFmpeg binary configured at:', ffmpegPath);
} catch (err) {
    console.warn('FFmpeg not available - transcoding will be disabled. Install ffmpeg-static for transcoding support.');
}

// API Routes
app.use('/api/sources', require('./routes/sources'));
app.use('/api/proxy', require('./routes/proxy'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/transcode', require('./routes/transcode'));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`NodeCast TV server running on http://localhost:${PORT}`);
});
