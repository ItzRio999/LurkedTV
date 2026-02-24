const express = require('express');
const router = express.Router();
const metadataService = require('../services/metadataService');

router.post('/enrich', async (req, res) => {
    try {
        const type = String(req.body?.type || '').toLowerCase();
        if (type !== 'movie' && type !== 'series') {
            return res.status(400).json({ error: 'type must be movie or series' });
        }

        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const payload = items
            .slice(0, 120)
            .map((item) => ({
                id: String(item?.id || '').trim(),
                title: String(item?.title || '').trim(),
                year: item?.year,
                localRating: item?.localRating,
                localVotes: item?.localVotes
            }))
            .filter(item => item.id && item.title);

        const data = await metadataService.enrichBatch(type, payload);
        res.json(data);
    } catch (err) {
        console.error('Error enriching metadata:', err);
        res.status(500).json({ error: 'Failed to enrich metadata' });
    }
});

module.exports = router;
