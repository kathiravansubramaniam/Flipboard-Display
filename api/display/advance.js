const { text } = require('node:stream/consumers');
const { advanceDisplay } = require('../../lib/display-store');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed' });
        return;
    }

    let body = {};
    try {
        const raw = await text(req);
        body = raw ? JSON.parse(raw) : {};
    } catch (e) {
        res.status(400).json({ ok: false, error: 'invalid_json' });
        return;
    }

    const cycleId = body.cycleId != null ? body.cycleId : 0;
    res.setHeader('Cache-Control', 'no-store');

    try {
        const out = await advanceDisplay(cycleId);
        res.status(200).json(out);
    } catch (e) {
        console.error('[advance]', e);
        res.status(500).json({ ok: false, error: 'advance_failed' });
    }
};
