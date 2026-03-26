let memoryState = null;
let memoryQueue = [];
let memoryCycleId = 0;

/** In-memory fallback when Redis env is missing; `false` = init failed */
let redisClient;

/**
 * Same resolution as @upstash/redis Redis.fromEnv() (UPSTASH_* or KV_REST_*).
 */
function getRedisUrlAndToken() {
    return {
        url:
            process.env.UPSTASH_REDIS_REST_URL ||
            process.env.KV_REST_API_URL,
        token:
            process.env.UPSTASH_REDIS_REST_TOKEN ||
            process.env.KV_REST_API_TOKEN,
    };
}

function getRedis() {
    if (redisClient !== undefined) return redisClient === false ? null : redisClient;
    const { url, token } = getRedisUrlAndToken();
    if (!url || !token) {
        redisClient = false;
        return null;
    }
    try {
        const { Redis } = require('@upstash/redis');
        redisClient = Redis.fromEnv();
        return redisClient;
    } catch (e) {
        console.error('[display-store] redis init', e.message);
        redisClient = false;
        return null;
    }
}

/** For diagnostics (e.g. X-Flipboard-Storage header). No secrets. */
function getStorageLabel() {
    const { url, token } = getRedisUrlAndToken();
    if (!url || !token) return 'no-redis-env';
    const r = getRedis();
    if (r) return 'redis';
    return 'redis-init-failed';
}

const KEY_DISPLAY = 'flipboard:display';
const KEY_QUEUE = 'flipboard:queue';
const KEY_CYCLE = 'flipboard:cycleId';
const KEY_ADV_LOCK = 'flipboard:advanceLock';

function parseState(raw) {
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getQueueLengthRedis(r) {
    try {
        const n = await r.llen(KEY_QUEUE);
        return typeof n === 'number' ? n : 0;
    } catch {
        return 0;
    }
}

async function getCycleIdRedis(r) {
    try {
        const v = await r.get(KEY_CYCLE);
        if (v == null) return 0;
        const n = parseInt(String(v), 10);
        return Number.isNaN(n) ? 0 : n;
    } catch {
        return 0;
    }
}

async function getDisplayState() {
    const r = getRedis();
    if (r) {
        try {
            const raw = await r.get(KEY_DISPLAY);
            const state = parseState(raw);
            if (state != null) {
                let cycleId = await getCycleIdRedis(r);
                if (cycleId === 0) {
                    await r.set(KEY_CYCLE, '1');
                    cycleId = 1;
                }
                const queueLength = await getQueueLengthRedis(r);
                return { ...state, cycleId, queueLength };
            }
        } catch (e) {
            console.error('[display-store] redis get', e.message);
        }
    }
    if (memoryState) {
        return {
            ...memoryState,
            cycleId: memoryCycleId,
            queueLength: memoryQueue.length,
        };
    }
    return null;
}

/**
 * FIFO enqueue from Slack. Does not replace the on-screen message until /advance runs.
 * If nothing is on screen yet, pulls the first queued item to the display.
 */
async function enqueueDisplay(obj) {
    const payload = JSON.stringify(obj);
    const r = getRedis();
    if (r) {
        try {
            await r.rpush(KEY_QUEUE, payload);
            const curRaw = await r.get(KEY_DISPLAY);
            if (curRaw == null) {
                const next = await r.lpop(KEY_QUEUE);
                if (next) {
                    await r.set(KEY_DISPLAY, next);
                    await r.set(KEY_CYCLE, '1');
                }
            }
        } catch (e) {
            console.error('[display-store] enqueue', e.message);
        }
        return;
    }
    memoryQueue.push(obj);
    if (!memoryState) {
        memoryState = memoryQueue.shift();
        memoryCycleId = 1;
    }
}

/**
 * Called after each full reveal→clear cycle. At most one client wins the lock;
 * pops FIFO when the queue has a message, always increments cycle.
 */
async function advanceDisplay(clientCycleId) {
    const r = getRedis();
    if (r) {
        try {
            const curCheck = await r.get(KEY_DISPLAY);
            if (curCheck == null) {
                const st = await getDisplayState();
                return { ok: true, skipped: true, ...serializeState(st) };
            }
            const lock = await r.set(KEY_ADV_LOCK, '1', { ex: 5, nx: true });
            if (!lock) {
                const st = await getDisplayState();
                return { ok: true, skipped: true, ...serializeState(st) };
            }
            try {
                const sid = await r.get(KEY_CYCLE);
                const serverCycle = sid == null ? 0 : parseInt(String(sid), 10) || 0;
                const client = parseInt(String(clientCycleId), 10) || 0;
                if (serverCycle !== client) {
                    const st = await getDisplayState();
                    return { ok: true, skipped: true, ...serializeState(st) };
                }
                const prevRaw = await r.get(KEY_DISPLAY);
                const prev = parseState(prevRaw);
                const next = await r.lpop(KEY_QUEUE);
                let contentChanged = false;
                if (next) {
                    await r.set(KEY_DISPLAY, next);
                    contentChanged = true;
                }
                await r.incr(KEY_CYCLE);
                const st = await getDisplayState();
                return {
                    ok: true,
                    skipped: false,
                    contentChanged,
                    previousHadMessage: !!(prev && prev.rowsData),
                    ...serializeState(st),
                };
            } finally {
                await r.del(KEY_ADV_LOCK);
            }
        } catch (e) {
            console.error('[display-store] advance', e.message);
            const st = await getDisplayState();
            return { ok: false, error: String(e.message), ...serializeState(st) };
        }
    }

    if (!memoryState) {
        return { ok: true, skipped: true, ...serializeState(null) };
    }

    const serverCycle = memoryCycleId;
    const client = parseInt(String(clientCycleId), 10) || 0;
    if (serverCycle !== client) {
        const st = memoryState
            ? {
                  ...memoryState,
                  cycleId: memoryCycleId,
                  queueLength: memoryQueue.length,
              }
            : null;
        return { ok: true, skipped: true, ...serializeState(st) };
    }
    const prev = memoryState;
    const next = memoryQueue.shift();
    let contentChanged = false;
    if (next) {
        memoryState = next;
        contentChanged = true;
    }
    memoryCycleId += 1;
    const st = await getDisplayState();
    return {
        ok: true,
        skipped: false,
        contentChanged,
        previousHadMessage: !!(prev && prev.rowsData),
        ...serializeState(st),
    };
}

function serializeState(st) {
    if (!st) {
        return {
            empty: true,
            cycleId: 0,
            queueLength: 0,
        };
    }
    const { cycleId, queueLength, ...rest } = st;
    return {
        empty: false,
        cycleId: cycleId ?? 0,
        queueLength: queueLength ?? 0,
        updatedAt: rest.updatedAt,
        rowsData: rest.rowsData,
        numCols: rest.numCols,
        numRows: rest.numRows,
        source: rest.source,
    };
}

/** Legacy helper — only used if we add a direct-set path later */
async function setDisplayState(obj) {
    memoryState = obj;
    const r = getRedis();
    if (r) {
        try {
            await r.set(KEY_DISPLAY, JSON.stringify(obj));
            await r.set(KEY_CYCLE, '1');
        } catch (e) {
            console.error('[display-store] redis set', e.message);
        }
    }
}

module.exports = {
    getDisplayState,
    setDisplayState,
    enqueueDisplay,
    advanceDisplay,
    getStorageLabel,
};
