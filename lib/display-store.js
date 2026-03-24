let memoryState = null;

/** In-memory fallback when Redis env is missing; `false` = init failed */
let redisClient;

function getRedis() {
    if (redisClient !== undefined) return redisClient === false ? null : redisClient;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        redisClient = false;
        return null;
    }
    try {
        const { Redis } = require('@upstash/redis');
        redisClient = new Redis({ url, token });
        return redisClient;
    } catch (e) {
        console.error('[display-store] redis init', e.message);
        redisClient = false;
        return null;
    }
}

async function getDisplayState() {
    const r = getRedis();
    if (r) {
        try {
            const raw = await r.get('flipboard:display');
            if (raw != null) {
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
        } catch (e) {
            console.error('[display-store] redis get', e.message);
        }
    }
    return memoryState;
}

async function setDisplayState(obj) {
    memoryState = obj;
    const r = getRedis();
    if (r) {
        try {
            await r.set('flipboard:display', JSON.stringify(obj));
        } catch (e) {
            console.error('[display-store] redis set', e.message);
        }
    }
}

module.exports = { getDisplayState, setDisplayState };
