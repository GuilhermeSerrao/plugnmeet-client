import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import PlugNMeetClient from '../src/PlugNMeetClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, 'dist');
const PUBLIC_DIR = join(__dirname, 'public');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // shareable join links expire after 30 days
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // dashboard sessions expire after 7 days

const client = new PlugNMeetClient({
  serverUrl: process.env.PLUGNMEET_SERVER_URL,
  apiKey: process.env.PLUGNMEET_API_KEY,
  apiSecret: process.env.PLUGNMEET_API_SECRET,
});

// ---- Sessions (in-memory, single instance) ----

const sessions = new Map(); // sessionId -> expiresAt

function createSession() {
  const id = randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  return id;
}

function isValidSession(id) {
  const expiresAt = sessions.get(id);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(id);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, expiresAt] of sessions) {
    if (now > expiresAt) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();

function parseCookies(req) {
  const header = req.headers['cookie'];
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

function isAuthenticated(req) {
  if (!ADMIN_PASSWORD) return false;
  const { session } = parseCookies(req);
  return session ? isValidSession(session) : false;
}

// ---- Shareable join links: HMAC-signed, opaque token (room + role + expiry) ----
// Editing the URL by hand can't change what room or role it grants, since the
// signature covers the payload; /api/join-token only trusts the verified payload.

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

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function sendFile(res, path, status = 200) {
  const data = await readFile(path);
  res.writeHead(status, { 'Content-Type': MIME_TYPES[extname(path)] || 'application/octet-stream' });
  res.end(data);
}

// "no X found" is how the API reports an empty list — treat it as one instead of an error.
async function fetchOrEmpty(promise, emptyShape) {
  try {
    return await promise;
  } catch (err) {
    if (err.statusCode === 'NOT_FOUND') return emptyShape;
    throw err;
  }
}

// ---- Routes ----
// path may contain :param segments. `protected: false` marks the handful of public routes.

const routes = [
  {
    method: 'POST',
    path: '/api/login',
    protected: false,
    handler: async (req, res) => {
      const { password } = await readJsonBody(req);
      if (!ADMIN_PASSWORD || typeof password !== 'string') {
        return { statusCode: 401, body: { status: false, msg: 'Invalid password' } };
      }
      const given = Buffer.from(password);
      const expected = Buffer.from(ADMIN_PASSWORD);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return { statusCode: 401, body: { status: false, msg: 'Invalid password' } };
      }
      const sessionId = createSession();
      res.setHeader(
        'Set-Cookie',
        `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/`,
      );
      return { body: { status: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/logout',
    protected: false,
    handler: async (req, res) => {
      const { session } = parseCookies(req);
      if (session) sessions.delete(session);
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
      return { body: { status: true } };
    },
  },

  {
    method: 'GET',
    path: '/api/rooms',
    handler: async () => ({
      body: await fetchOrEmpty(client.getActiveRoomsInfo(), { status: true, msg: 'success', rooms: [] }),
    }),
  },
  {
    method: 'POST',
    path: '/api/rooms',
    handler: async (req) => {
      const { roomId, title, lockSettings } = await readJsonBody(req);
      const body = await client.createRoom(roomId, {
        metadata: { room_title: title || 'Untitled room', default_lock_settings: lockSettings || {} },
      });
      return { body };
    },
  },
  {
    method: 'GET',
    path: '/api/rooms/:id',
    handler: async (req, res, { id }) => ({ body: await client.getActiveRoomInfo(id) }),
  },
  {
    method: 'DELETE',
    path: '/api/rooms/:id',
    handler: async (req, res, { id }) => ({ body: await client.endRoom(id) }),
  },
  {
    method: 'POST',
    path: '/api/rooms/:id/links',
    handler: async (req, res, { id }) => {
      const { isAdmin } = await readJsonBody(req);
      const token = signLinkToken({ roomId: id, isAdmin: !!isAdmin, exp: Date.now() + LINK_TTL_MS });
      return { body: { status: true, token } };
    },
  },

  {
    method: 'GET',
    path: '/api/recordings',
    handler: async () => ({
      body: await fetchOrEmpty(
        client.fetchRecordings([]),
        { status: true, msg: 'success', result: { total_recordings: 0, from: 0, limit: 20, order_by: 'DESC', recordings_list: [] } },
      ),
    }),
  },
  {
    method: 'DELETE',
    path: '/api/recordings/:id',
    handler: async (req, res, { id }) => ({ body: await client.deleteRecording(id) }),
  },

  {
    method: 'GET',
    path: '/api/artifacts',
    handler: async () => ({
      body: await fetchOrEmpty(
        client.fetchArtifacts(),
        { status: true, msg: 'success', result: { total_artifacts: 0, from: 0, limit: 20, order_by: 'DESC', artifacts_list: [] } },
      ),
    }),
  },
  {
    method: 'DELETE',
    path: '/api/artifacts/:id',
    handler: async (req, res, { id }) => ({ body: await client.deleteArtifact(id) }),
  },

  {
    method: 'GET',
    path: '/api/past-rooms',
    handler: async () => ({
      body: await fetchOrEmpty(
        client.fetchPastRooms([]),
        { status: true, msg: 'success', result: { total_rooms: 0, from: 0, limit: 20, order_by: 'DESC', rooms_list: [] } },
      ),
    }),
  },

  // ---- Public join flow (unchanged from examples/) ----
  {
    method: 'POST',
    path: '/api/join-token',
    protected: false,
    handler: async (req) => {
      const { token, name } = await readJsonBody(req);
      const link = verifyLinkToken(token);
      if (!link) {
        return { statusCode: 401, body: { status: false, msg: 'Invalid or expired link' } };
      }
      const result = await client.getJoinToken(link.roomId, {
        name,
        user_id: `web-${Date.now()}`,
        is_admin: !!link.isAdmin,
      });
      return { body: { ...result, joinUrl: client.buildJoinUrl(result.token) } };
    },
  },
];

// download routes redirect straight to the plugNmeet server, so they need res access
// before JSON serialization kicks in — handled separately in the request handler below.

function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const paramNames = [];
    const pattern = route.path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          paramNames.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const match = pathname.match(new RegExp(`^${pattern}$`));
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  // Public pages
  if (req.method === 'GET' && pathname === '/login') {
    return sendFile(res, join(PUBLIC_DIR, 'login.html'));
  }
  if (req.method === 'GET' && pathname === '/join') {
    return sendFile(res, join(PUBLIC_DIR, 'join.html'));
  }

  // Download redirects (need direct res access, not the JSON envelope)
  if (req.method === 'GET' && pathname.startsWith('/api/recordings/') && pathname.endsWith('/download')) {
    if (!isAuthenticated(req)) return sendJson(res, 401, { status: false, msg: 'Unauthorized' });
    const recordId = pathname.split('/')[3];
    try {
      const url = await client.getRecordingDownloadUrl(recordId);
      res.writeHead(302, { Location: url });
      return res.end();
    } catch (err) {
      return sendJson(res, err.statusCode ? 400 : 500, { status: false, msg: err.message });
    }
  }
  if (req.method === 'GET' && pathname.startsWith('/api/artifacts/') && pathname.endsWith('/download')) {
    if (!isAuthenticated(req)) return sendJson(res, 401, { status: false, msg: 'Unauthorized' });
    const artifactId = pathname.split('/')[3];
    try {
      const url = await client.getArtifactDownloadUrl(artifactId);
      res.writeHead(302, { Location: url });
      return res.end();
    } catch (err) {
      return sendJson(res, err.statusCode ? 400 : 500, { status: false, msg: err.message });
    }
  }

  // Static built assets (JS/CSS bundles) — never sensitive on their own
  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    try {
      return await sendFile(res, join(DIST_DIR, pathname));
    } catch {
      return sendJson(res, 404, { status: false, msg: 'not found' });
    }
  }

  const matched = matchRoute(req.method, pathname);
  if (matched) {
    if (matched.route.protected !== false && !isAuthenticated(req)) {
      return sendJson(res, 401, { status: false, msg: 'Unauthorized' });
    }
    try {
      const result = await matched.route.handler(req, res, matched.params);
      if (result === null) return; // handler already wrote the response
      return sendJson(res, result.statusCode || 200, result.body);
    } catch (err) {
      return sendJson(res, err.statusCode ? 400 : 500, {
        status: false,
        msg: err.message,
        status_code: err.statusCode,
      });
    }
  }

  // Everything else: the dashboard SPA shell (auth-gated) for any GET, 404 otherwise.
  if (req.method === 'GET') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    try {
      return await sendFile(res, join(DIST_DIR, 'index.html'));
    } catch {
      return sendJson(res, 500, { status: false, msg: 'dashboard build not found — run `npm run build`' });
    }
  }

  sendJson(res, 404, { status: false, msg: 'not found' });
});

server.listen(PORT, () => {
  console.log(`plugNmeet dashboard: http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) {
    console.warn('ADMIN_PASSWORD not set — dashboard routes are locked out until it is configured.');
  }
});
