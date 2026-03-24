const { getDisplayState, getStorageLabel } = require('../lib/display-store');

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'Method not allowed' });
        return;
    }

    res.setHeader('Cache-Control', 'no-store');
    const storage = getStorageLabel();
    res.setHeader('X-Flipboard-Storage', storage);
    const state = await getDisplayState();
    if (!state) {
        res.status(200).json({
            ok: true,
            empty: true,
            storage,
            hint:
                storage === 'redis'
                    ? 'No message stored yet. Run your Slack slash command with text, then reload.'
                    : 'Redis env missing or client failed; Slack updates only last in one server instance.',
        });
        return;
    }

    res.status(200).json({
        ok: true,
        empty: false,
        storage,
        updatedAt: state.updatedAt,
        rowsData: state.rowsData,
        numCols: state.numCols,
        numRows: state.numRows,
        source: state.source,
    });
};
