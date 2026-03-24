import { SplitFlapAudio } from './splitflap-audio.js';
import { emojify } from 'https://esm.sh/node-emoji@2.2.0';

const sfx = new SplitFlapAudio({
    sharpness: 0.1,
    reverbMix: 0.85,
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@&!?';
const FLIP_MS = 120;
const SPECIAL_CHARS = new Set(['❤', '✈', '★', '♥', '☺', '♦', '●', '✓']);

let audioEnabled = localStorage.getItem('flipboardAudioEnabled') !== '0';

function segmentGraphemes(s) {
    const str = typeof s === 'string' ? s : '';
    try {
        const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return [...seg.segment(str)].map((x) => x.segment);
    } catch {
        return [...str];
    }
}

function padCellArray(cells, cols) {
    const row = (cells || []).slice(0, cols);
    while (row.length < cols) row.push(' ');
    return row;
}

function normalizeLegacyStringRows(rows) {
    if (!rows?.length) return [padCellArray([' '], 1)];
    const widths = rows.map((r) => segmentGraphemes(r).length);
    const cols = Math.min(16, Math.max(1, ...widths));
    return rows.map((r) => padCellArray(segmentGraphemes(r), cols));
}

function normalizeRowsData(rd, numColsHint) {
    if (!Array.isArray(rd) || rd.length === 0) return [[' ']];
    if (typeof rd[0] === 'string') {
        const cols =
            numColsHint ??
            Math.max(
                ...rd.map((r) => segmentGraphemes(String(r)).length),
                1
            );
        return rd.map((row) => padCellArray(segmentGraphemes(String(row)), cols));
    }
    const cols =
        numColsHint ??
        Math.max(...rd.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
    return rd.map((row) => {
        const cells = Array.isArray(row)
            ? row.map((c) => (c == null || c === '' ? ' ' : String(c)))
            : segmentGraphemes(String(row));
        return padCellArray(cells, cols);
    });
}

function isEmojiCell(s) {
    if (!s || s === ' ') return false;
    if (SPECIAL_CHARS.has(s)) return true;
    if (/^[A-Z0-9#@&!?]$/i.test(s)) return false;
    return /\p{Extended_Pictographic}/u.test(s) || s.length > 1;
}

function normalizeCellInput(raw) {
    const s = emojify((raw || '').trim());
    if (!s) return ' ';
    const g = segmentGraphemes(s);
    const first = g[0] || ' ';
    if (first === ' ') return ' ';
    if (/^[A-Z0-9#@&!?]$/i.test(first)) return first.toUpperCase();
    return first;
}

let rowsData = normalizeLegacyStringRows(['YOU ARE ', 'WELCOME ']);
let numCols = rowsData[0]?.length ?? 8;
let animGen = 0;
let tiles = [];

const boardEl = document.getElementById('board');
const configBtn = document.getElementById('configBtn');
const modal = document.getElementById('modal');
const modalClose = document.getElementById('modalClose');
const cancelBtn = document.getElementById('cancelBtn');
const applyBtn = document.getElementById('applyBtn');
const rowInput = document.getElementById('rowInput');
const colInput = document.getElementById('colInput');
const gridEditor = document.getElementById('gridEditor');
const soundTextLabel = document.getElementById('soundTextLabel');

let focusedCell = null;

const REMOTE_POLL_MS = 3500;
let lastRemoteUpdatedAt = null;

function applyRemoteUpdate(data) {
    if (!data || !Array.isArray(data.rowsData) || data.rowsData.length === 0) return;
    rowsData = normalizeRowsData(data.rowsData, data.numCols);
    numCols =
        typeof data.numCols === 'number'
            ? data.numCols
            : rowsData[0]?.length || numCols;
    if (rowInput) rowInput.value = rowsData.length;
    if (colInput) colInput.value = numCols;
    buildBoard();
    startAnimation();
}

async function pollRemoteDisplay() {
    try {
        const res = await fetch('/api/display', { cache: 'no-store' });
        if (!res.ok) return;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = await res.json();
        if (!data.ok || data.empty || data.updatedAt == null) return;
        const ts = Number(data.updatedAt);
        if (Number.isNaN(ts)) return;
        if (lastRemoteUpdatedAt !== null && lastRemoteUpdatedAt === ts) return;
        lastRemoteUpdatedAt = ts;
        applyRemoteUpdate(data);
    } catch {
        /* no API (local file) or network error */
    }
}

function updateSoundTextLabel() {
    if (!soundTextLabel) return;
    soundTextLabel.textContent = audioEnabled
        ? 'Click anywhere to turn sound off'
        : 'Click anywhere to turn sound on';
    soundTextLabel.classList.toggle('sound-on', audioEnabled);
}

async function setAudioEnabled(on) {
    audioEnabled = on;
    localStorage.setItem('flipboardAudioEnabled', on ? '1' : '0');
    if (on) {
        await sfx.init();
        sfx.setOutputLevel(1);
    } else {
        sfx.setOutputLevel(0);
    }
    updateSoundTextLabel();
}

async function primeFlipAudioFromUserGesture() {
    if (!audioEnabled) return;
    await sfx.init();
    sfx.setOutputLevel(1);
}

function playFlapClick() {
    if (!audioEnabled) return;
    sfx.playClick();
}

function mkDiv(cls) {
    const d = document.createElement('div');
    d.className = cls;
    return d;
}
function mkSpan(ch) {
    const s = document.createElement('span');
    s.className = 'tile-char';
    s.textContent = ch;
    return s;
}

function buildBoard() {
    boardEl.innerHTML = '';
    tiles = [];

    const ratio = ((numCols * 0.72) / rowsData.length * 0.94).toFixed(3);
    boardEl.style.setProperty('--board-ratio', ratio);
    boardEl.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

    for (let r = 0; r < rowsData.length; r++) {
        tiles[r] = [];
        for (let c = 0; c < numCols; c++) {
            const ch = rowsData[r]?.[c] ?? ' ';
            const t = createTile(ch);
            boardEl.appendChild(t.el);
            tiles[r][c] = t;
        }
    }
}

function createTile(target) {
    const el = mkDiv('tile');
    if (isEmojiCell(target)) el.classList.add('tile-emoji');

    const topH = mkDiv('tile-half tile-top');
    const topS = mkSpan(' ');
    topH.appendChild(topS);

    const botH = mkDiv('tile-half tile-bottom');
    const botS = mkSpan(' ');
    botH.appendChild(botS);

    const fT = mkDiv('flap flap-top');
    const fTS = mkSpan(' ');
    fT.appendChild(fTS);

    const fB = mkDiv('flap flap-bottom');
    const fBS = mkSpan(' ');
    fB.appendChild(fBS);

    el.append(topH, botH, fT, fB);

    return { el, topS, botS, fT, fTS, fB, fBS, cur: ' ', target };
}

function flipOnce(tile, newCh, gen) {
    return new Promise((resolve) => {
        if (gen !== animGen || tile.cur === newCh) {
            resolve();
            return;
        }

        tile.fTS.textContent = tile.cur;
        tile.fT.style.display = 'block';
        tile.fT.classList.remove('flipping');
        tile.topS.textContent = newCh;

        void tile.fT.offsetWidth;
        tile.fT.classList.add('flipping');

        setTimeout(() => {
            tile.fT.style.display = 'none';
            tile.fT.classList.remove('flipping');
            if (gen !== animGen) {
                resolve();
                return;
            }

            playFlapClick();

            tile.fBS.textContent = newCh;
            tile.fB.style.display = 'block';
            tile.fB.classList.remove('flipping');

            void tile.fB.offsetWidth;
            tile.fB.classList.add('flipping');

            setTimeout(() => {
                tile.fB.style.display = 'none';
                tile.fB.classList.remove('flipping');
                playFlapClick();
                tile.botS.textContent = newCh;
                tile.cur = newCh;
                resolve();
            }, FLIP_MS);
        }, FLIP_MS);
    });
}

function randChar() {
    return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function revealTile(tile, delay, gen) {
    await sleep(delay);
    if (gen !== animGen || tile.target === ' ') return;

    const total = tiles.flat().filter((t) => t.target !== ' ').length;
    const flips = total > 40 ? 4 : total > 20 ? 6 : 8;
    const n = flips + Math.floor(Math.random() * flips);

    for (let i = 0; i < n; i++) {
        if (gen !== animGen) return;
        await flipOnce(tile, randChar(), gen);
        await sleep(20 + Math.random() * 35);
    }
    if (gen !== animGen) return;
    await flipOnce(tile, tile.target, gen);
    tile.el.classList.add('settled');
}

async function clearTile(tile, delay, gen) {
    await sleep(delay);
    if (gen !== animGen || tile.cur === ' ') return;
    tile.el.classList.remove('settled');

    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
        if (gen !== animGen) return;
        await flipOnce(tile, randChar(), gen);
        await sleep(20 + Math.random() * 35);
    }
    if (gen !== animGen) return;
    await flipOnce(tile, ' ', gen);
}

function startAnimation() {
    animGen++;
    const gen = animGen;

    const total = tiles.flat().filter((t) => t.target !== ' ').length;
    const stagger = total > 30 ? 60 : total > 15 ? 90 : 120;

    (async () => {
        while (gen === animGen) {
            if (audioEnabled) {
                void sfx.init().then(() => sfx.triggerCascade(numCols, 11));
            }

            const reveals = [];
            let d = 0;
            for (let r = 0; r < rowsData.length; r++) {
                for (let c = 0; c < numCols; c++) {
                    if (tiles[r][c].target !== ' ') {
                        reveals.push(revealTile(tiles[r][c], d, gen));
                        d += stagger;
                    }
                }
            }
            await Promise.all(reveals);
            if (gen !== animGen) return;
            await sleep(5000);
            if (gen !== animGen) return;

            const clears = [];
            d = 0;
            for (let r = rowsData.length - 1; r >= 0; r--) {
                for (let c = numCols - 1; c >= 0; c--) {
                    if (tiles[r][c].cur !== ' ') {
                        clears.push(clearTile(tiles[r][c], d, gen));
                        d += Math.min(80, stagger);
                    }
                }
            }
            await Promise.all(clears);
            if (gen !== animGen) return;
            await sleep(2500);
        }
    })();
}

function openModal() {
    rowInput.value = rowsData.length;
    colInput.value = numCols;
    buildEditorGrid();
    modal.classList.add('open');
}

function closeModal() {
    modal.classList.remove('open');
    focusedCell = null;
}

function buildEditorGrid() {
    const rows = parseInt(rowInput.value, 10) || 1;
    const cols = parseInt(colInput.value, 10) || 1;

    gridEditor.innerHTML = '';
    gridEditor.style.gridTemplateColumns = `repeat(${cols}, minmax(28px, 48px))`;

    const inputs = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'grid-cell';
            inp.maxLength = 32;
            inp.autocomplete = 'off';
            inp.setAttribute('data-r', r);
            inp.setAttribute('data-c', c);

            const existing = rowsData[r]?.[c] ?? '';
            if (existing && existing !== ' ') inp.value = existing;

            const idx = r * cols + c;
            inp.addEventListener('input', () => {
                if (inp.value.length > 0) {
                    const next = inputs[idx + 1];
                    if (next) next.focus();
                }
            });
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && inp.value === '') {
                    e.preventDefault();
                    const prev = inputs[idx - 1];
                    if (prev) {
                        prev.focus();
                        prev.select();
                    }
                } else if (e.key === 'ArrowRight') {
                    const next = inputs[idx + 1];
                    if (next) next.focus();
                } else if (e.key === 'ArrowLeft') {
                    const prev = inputs[idx - 1];
                    if (prev) prev.focus();
                } else if (e.key === 'ArrowDown') {
                    const below = inputs[idx + cols];
                    if (below) below.focus();
                } else if (e.key === 'ArrowUp') {
                    const above = inputs[idx - cols];
                    if (above) above.focus();
                }
            });
            inp.addEventListener('focus', () => {
                focusedCell = inp;
            });

            gridEditor.appendChild(inp);
            inputs.push(inp);
        }
    }

    if (inputs.length) inputs[0].focus();
}

function applyChanges() {
    const rows = parseInt(rowInput.value, 10) || 1;
    const cols = parseInt(colInput.value, 10) || 1;
    const inputs = gridEditor.querySelectorAll('.grid-cell');

    const newRows = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            const val = inputs[r * cols + c]?.value || '';
            row.push(normalizeCellInput(val));
        }
        newRows.push(row);
    }

    rowsData = newRows;
    numCols = cols;
    buildBoard();
    startAnimation();
    closeModal();
}

function unlockAudioOnInteraction() {
    if (audioEnabled) void sfx.init();
}

document.addEventListener('pointerdown', unlockAudioOnInteraction, { passive: true });
document.addEventListener('touchstart', unlockAudioOnInteraction, { passive: true });

document.addEventListener('click', (e) => {
    if (e.target.closest('#configBtn')) return;
    if (e.target.closest('#modal')) return;
    void setAudioEnabled(!audioEnabled);
});

document.addEventListener('visibilitychange', () => {
    if (!audioEnabled) return;
    if (document.visibilityState === 'visible' && sfx.ctx && sfx.ctx.state === 'suspended') {
        sfx.ctx.resume().catch(() => {});
    }
});

configBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
applyBtn.addEventListener('click', applyChanges);

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
});

document.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const dir = parseInt(btn.dataset.dir, 10);
        const min = parseInt(input.min, 10);
        const max = parseInt(input.max, 10);
        const val = Math.min(max, Math.max(min, (parseInt(input.value, 10) || 1) + dir));
        input.value = val;
        buildEditorGrid();
    });
});

rowInput.addEventListener('change', buildEditorGrid);
colInput.addEventListener('change', buildEditorGrid);

document.querySelectorAll('.emoji-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        if (focusedCell) {
            focusedCell.value = btn.dataset.ch;
            focusedCell.dispatchEvent(new Event('input'));
            focusedCell.focus();
        }
    });
});

updateSoundTextLabel();
buildBoard();
startAnimation();
setInterval(pollRemoteDisplay, REMOTE_POLL_MS);
void pollRemoteDisplay();
