let memoryState = null;

/** In-memory fallback when Redis env is missing; `false` = init failed */
let redisClient;

/**
 * Same resolution as @upstash/redis Redis.fromEnv() (UPSTASH_* or KV_REST_*).
 * @returns {{ url: string|undefined, token: string|undefined }}
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

module.exports = {
    getDisplayState,
    setDisplayState,
    getStorageLabel,
};
