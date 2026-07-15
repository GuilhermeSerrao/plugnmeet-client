import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import PlugNMeetClient from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const LINK_TTL_MS = 24 * 60 * 60 * 1000; // shareable join links expire after 24h

// Room-management routes require a shared password (HTTP Basic Auth) since this
// tester has no per-user accounts. /join and /api/join-token stay open — but
// join-token only accepts a signed link token (see signLinkToken/verifyLinkToken),
// never a raw room id + admin flag, so it can't be used to join/impersonate an
// arbitrary room by guessing or editing the URL.
const PROTECTED_ROUTES = new Set([
  'GET /',
  'POST /api/create-room',
  'POST /api/end-room',
  'POST /api/active-rooms',
  'POST /api/is-active',
  'POST /api/create-link',
  'POST /api/direct-join-token',
]);

function isAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const match = /^Basic\s+(.+)$/i.exec(req.headers['authorization'] || '');
  if (!match) return false;

  const [, password = ''] = Buffer.from(match[1], 'base64').toString('utf8').split(':');
  const given = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Shareable join links carry an HMAC-signed, opaque token (room + role + expiry)
// instead of a plain roomId/isAdmin query param — editing the URL by hand can't
// change what room or role it grants, since the signature covers the payload.
function signLinkToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', ADMIN_PASSWORD).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyLinkToken(token) {
  if (!ADMIN_PASSWORD || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = createHmac('sha256', ADMIN_PASSWORD).update(body).digest('base64url');
  const given = Buffer.from(sig);
  const expected = Buffer.from(expectedSig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.roomId !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

const client = new PlugNMeetClient({
  serverUrl: process.env.PLUGNMEET_SERVER_URL,
  apiKey: process.env.PLUGNMEET_API_KEY,
  apiSecret: process.env.PLUGNMEET_API_SECRET,
});

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const routes = {
  'POST /api/create-room': async (req) => {
    const { roomId, title, lockSettings } = await readJsonBody(req);
    return client.createRoom(roomId, {
      metadata: {
        room_title: title || 'Test room',
        default_lock_settings: lockSettings || {},
      },
    });
  },
  'POST /api/create-link': async (req) => {
    const { roomId, isAdmin } = await readJsonBody(req);
    if (!roomId) {
      throw Object.assign(new Error('roomId is required'), { statusCode: 400 });
    }
    const token = signLinkToken({ roomId, isAdmin: !!isAdmin, exp: Date.now() + LINK_TTL_MS });
    return { status: true, token };
  },
  'POST /api/join-token': async (req) => {
    const { token, name } = await readJsonBody(req);
    const link = verifyLinkToken(token);
    if (!link) {
      throw Object.assign(new Error('Invalid or expired link'), { statusCode: 401 });
    }
    const result = await client.getJoinToken(link.roomId, {
      name,
      user_id: `web-${Date.now()}`,
      is_admin: !!link.isAdmin,
    });
    return { ...result, joinUrl: client.buildJoinUrl(result.token) };
  },
  // Direct, one-off join link for the authenticated admin (step 2 of the
  // tester UI) — separate from /api/join-token, which only trusts signed links.
  'POST /api/direct-join-token': async (req) => {
    const { roomId, name, isAdmin } = await readJsonBody(req);
    const result = await client.getJoinToken(roomId, {
      name,
      user_id: `web-${Date.now()}`,
      is_admin: !!isAdmin,
    });
    return { ...result, joinUrl: client.buildJoinUrl(result.token) };
  },
  'POST /api/is-active': async (req) => {
    const { roomId } = await readJsonBody(req);
    return client.isRoomActive(roomId);
  },
  'POST /api/active-rooms': async () => {
    return client.getActiveRoomsInfo();
  },
  'POST /api/end-room': async (req) => {
    const { roomId } = await readJsonBody(req);
    return client.endRoom(roomId);
  },
};

const server = createServer(async (req, res) => {
  const key = `${req.method} ${new URL(req.url, 'http://localhost').pathname}`;

  if (PROTECTED_ROUTES.has(key) && !isAuthorized(req)) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Basic realm="plugNmeet tester"',
    });
    res.end(JSON.stringify({ status: false, msg: 'Unauthorized' }));
    return;
  }

  if (key === 'GET /') {
    const html = await readFile(join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (key === 'GET /join') {
    const html = await readFile(join(__dirname, 'join.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  const handler = routes[key];
  if (!handler) {
    sendJson(res, 404, { status: false, msg: 'not found' });
    return;
  }

  try {
    const data = await handler(req);
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, err.statusCode ? 400 : 500, {
      status: false,
      msg: err.message,
      status_code: err.statusCode,
    });
  }
});

server.listen(PORT, () => {
  console.log(`plugNmeet client tester: http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) {
    console.warn('ADMIN_PASSWORD not set — room-management routes are locked out until it is configured.');
  }
});
