const { getDisplayState } = require('../lib/display-store');

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'Method not allowed' });
        return;
    }

    res.setHeader('Cache-Control', 'no-store');
    const state = await getDisplayState();
    if (!state) {
        res.status(200).json({ ok: true, empty: true });
        return;
    }

    res.status(200).json({
        ok: true,
        updatedAt: state.updatedAt,
        rowsData: state.rowsData,
        numCols: state.numCols,
        numRows: state.numRows,
        source: state.source,
    });
};
