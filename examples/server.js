import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import PlugNMeetClient from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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
  'POST /api/join-token': async (req) => {
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
});
