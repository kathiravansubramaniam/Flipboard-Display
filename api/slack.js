/**
 * Slack slash command endpoint.
 * Create a Slash Command in your Slack app with Request URL:
 *   https://<your-domain>/api/slack
 * Set env SLACK_SIGNING_SECRET (Signing Secret from Slack app "Basic Information").
 * Optional: add Upstash Redis from Vercel Marketplace so state survives cold starts
 * (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).
 */
const crypto = require('node:crypto');
const { text } = require('node:stream/consumers');
const { layoutMessage, expandSlackEmoji } = require('../lib/layout-message');
const { setDisplayState } = require('../lib/display-store');

function escapeSlackText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function verifySlackRequest(req, rawBody, signingSecret) {
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    if (!ts || !sig) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(ts, 10)) > 60 * 5) return false;
    const base = `v0:${ts}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
    const expected = `v0=${hmac}`;
    try {
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(sig, 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

function json(res, status, body) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(status).send(JSON.stringify(body));
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    let rawBody;
    try {
        rawBody = await text(req);
    } catch (e) {
        console.error('[slack] body read', e);
        json(res, 500, { ok: false, error: 'read_body' });
        return;
    }

    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (process.env.NODE_ENV === 'production' && !signingSecret) {
        json(res, 500, { ok: false, error: 'missing SLACK_SIGNING_SECRET' });
        return;
    }
    if (signingSecret && !verifySlackRequest(req, rawBody, signingSecret)) {
        res.status(401).send('invalid signature');
        return;
    }

    const params = new URLSearchParams(rawBody);
    const textArg = (params.get('text') || '').trim();

    const result = layoutMessage(textArg);
    if (result.error) {
        json(res, 200, {
            response_type: 'ephemeral',
            text: `Could not update: ${result.error} Send text after the command, e.g. \`/flipboard Hello world\`.`,
        });
        return;
    }

    const payload = {
        updatedAt: Date.now(),
        rowsData: result.rowsData,
        numCols: result.numCols,
        numRows: result.numRows,
        source: 'slack',
        rawText: textArg.slice(0, 500),
    };
    await setDisplayState(payload);

    const preview = expandSlackEmoji(textArg);
    const previewShort =
        preview.length > 450 ? `${preview.slice(0, 447)}…` : preview;
    const safePreview = escapeSlackText(previewShort);

    json(res, 200, {
        response_type: 'ephemeral',
        text: `*Flipboard updated*\n\n*Preview (what will show on the display):*\n${safePreview}\n\n• Grid: ${result.numRows}×${result.numCols}\n• The live site should refresh within a few seconds.`,
    });
};
