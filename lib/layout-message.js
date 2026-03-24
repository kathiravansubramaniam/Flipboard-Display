/**
 * Build rows/cols for the flipboard from a free-form message.
 * rowsData is string[][] — each inner array is one row of single-grapheme cells (letters, space, or emoji).
 */

function graphemes(s) {
    const str = typeof s === 'string' ? s : '';
    try {
        const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return [...seg.segment(str)].map((x) => x.segment);
    } catch {
        return [...str];
    }
}

function upperDisplayGraphemes(s) {
    let out = '';
    for (const seg of graphemes(s)) {
        if (seg.length === 1 && /[a-z]/.test(seg)) out += seg.toUpperCase();
        else out += seg;
    }
    return out;
}

function padCellRow(cells, cols) {
    const row = cells.slice(0, cols);
    while (row.length < cols) row.push(' ');
    return row;
}

function layoutMessage(raw) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return { error: 'Message is empty' };

    const MAX_COLS = 16;
    const MAX_ROWS = 12;

    if (text.includes('\n')) {
        let lines = text
            .split('\n')
            .map((l) => upperDisplayGraphemes(l.trim()))
            .filter(Boolean);
        if (lines.length > MAX_ROWS) lines = lines.slice(0, MAX_ROWS);
        const colWidths = lines.map((l) => graphemes(l).length);
        const cols = Math.min(MAX_COLS, Math.max(1, ...colWidths));
        const rowsData = lines.map((line) => padCellRow(graphemes(line), cols));
        return { rowsData, numCols: cols, numRows: rowsData.length };
    }

    const single = upperDisplayGraphemes(text.replace(/\s+/g, ' '));
    const words = single.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = [];

    for (const w of words) {
        let wg = graphemes(w);
        if (wg.length > MAX_COLS) wg = wg.slice(0, MAX_COLS);

        if (cur.length === 0) {
            cur = [...wg];
            continue;
        }
        if (cur.length + 1 + wg.length <= MAX_COLS) {
            cur.push(' ');
            cur.push(...wg);
        } else {
            lines.push(cur);
            if (lines.length >= MAX_ROWS) {
                cur = [];
                break;
            }
            cur = [...wg];
        }
    }
    if (cur.length > 0 && lines.length < MAX_ROWS) lines.push(cur);

    if (lines.length === 0) return { error: 'No words to display' };

    const cols = Math.min(
        MAX_COLS,
        Math.max(1, ...lines.map((ln) => ln.length))
    );
    const rowsData = lines.map((ln) => padCellRow(ln, cols));
    return { rowsData, numCols: cols, numRows: rowsData.length };
}

module.exports = { layoutMessage };
