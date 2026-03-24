/**
 * Build rows/cols for the flipboard from a free-form message (used by API + can mirror in UI).
 * @param {string} raw
 * @returns {{ rowsData: string[], numCols: number, numRows: number } | { error: string }}
 */
function upperDisplay(s) {
    let out = '';
    for (const ch of s) {
        out += /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
    }
    return out;
}

function layoutMessage(raw) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return { error: 'Message is empty' };

    const MAX_COLS = 16;
    const MAX_ROWS = 12;

    if (text.includes('\n')) {
        let lines = text.split('\n').map((l) => upperDisplay(l.trim())).filter(Boolean);
        if (lines.length > MAX_ROWS) lines = lines.slice(0, MAX_ROWS);
        const cols = Math.min(
            MAX_COLS,
            Math.max(1, ...lines.map((l) => l.length))
        );
        const rowsData = lines.map((line) => padLine(line, cols));
        return { rowsData, numCols: cols, numRows: rowsData.length };
    }

    const single = upperDisplay(text.replace(/\s+/g, ' '));
    const words = single.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (!w) continue;
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= MAX_COLS) cur += ' ' + w;
        else {
            lines.push(cur);
            cur = w;
            if (lines.length >= MAX_ROWS) break;
        }
    }
    if (cur && lines.length < MAX_ROWS) lines.push(cur);
    if (lines.length === 0) return { error: 'No words to display' };

    const cols = Math.min(
        MAX_COLS,
        Math.max(1, ...lines.map((l) => l.length))
    );
    const rowsData = lines.map((line) => padLine(line, cols));
    return { rowsData, numCols: cols, numRows: rowsData.length };
}

function padLine(line, cols) {
    let s = line.slice(0, cols);
    while (s.length < cols) s += ' ';
    return s;
}

module.exports = { layoutMessage };
