# plugNmeet dashboard — design spec

Date: 2026-07-16

## Goal

Replace the `examples/` tester (a single-page dev demo) with a proper, session-authenticated
admin dashboard for managing plugNmeet rooms, recordings, artifacts, and past-room history,
built on top of the existing zero-dependency `PlugNMeetClient` (`src/PlugNMeetClient.js`,
unchanged). Lives in a new top-level `dashboard/` project, deployed as its own Coolify
application.

## Non-goals

- No changes to `src/PlugNMeetClient.js` — every dashboard action maps 1:1 to an existing
  client method.
- No multi-user accounts / roles for the dashboard itself — one shared `ADMIN_PASSWORD`,
  same trust model as today.
- No React/Vue/framework runtime — vanilla JS, Vite only as a dev-time bundler.
- No database — session store is an in-memory `Map`, acceptable for a single-container app.

## Architecture

```
dashboard/
├── server.js          # Node http server: session auth, REST API, serves built SPA + /join
│                         imports the library from ../src/PlugNMeetClient.js (repo root),
│                         same relative import examples/server.js uses today
├── frontend/           # dashboard UI source (built by Vite) — distinct from repo-root src/
│   ├── main.js          # bootstraps sidebar + router
│   ├── api.js            # fetch wrapper: credentials, 401 → redirect to /login, error normalization
│   ├── router.js          # minimal show/hide view switcher (no history-API library)
│   ├── views/
│   │   ├── rooms.js        # list, create, detail, end, generate links
│   │   ├── recordings.js
│   │   ├── artifacts.js
│   │   └── past-rooms.js
│   └── styles.css
├── public/
│   └── join.html         # moved from examples/join.html, unchanged logic
├── vite.config.js         # root: 'frontend', build.outDir: '../dist'
├── package.json
└── Dockerfile             # multi-stage: npm ci && vite build, then lean node:22-alpine runtime
```

Note: `dashboard/frontend/` (this project's UI source) is unrelated to the repo-root
`src/PlugNMeetClient.js` (the library). `server.js` imports the library via
`../src/PlugNMeetClient.js`; the Dockerfile's runtime stage copies both the repo-root `src/`
and `dashboard/`'s own build output.

`examples/` is no longer deployed. It's either deleted or kept as a minimal, undocumented
reference snippet — decided after the dashboard ships, out of scope for this spec.

Single container, single Node process in production: `server.js` serves the built `dist/`
assets, the API, and the public `/join` page. Dev mode: `vite dev` with a proxy to a locally
running `server.js` for the API, so frontend edits hot-reload.

## Authentication

Session-cookie based, replacing the current HTTP Basic Auth:

- `GET /login` — serves a small login page (password field only).
- `POST /api/login` — body `{ password }`. Compares against `ADMIN_PASSWORD` using
  `timingSafeEqual` (same pattern as today's Basic Auth check). On success: generates a
  random session id (`crypto.randomBytes(32).toString('hex')`), stores
  `sessionId → expiresAt` in an in-memory `Map`, sets cookie
  `session=<id>; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` (7 days).
- `POST /api/logout` — deletes the session id from the `Map`, clears the cookie.
- Middleware: every dashboard route (all API routes under `/api/*` except `/api/login` and
  `/api/join-token`, plus the SPA shell itself) requires a valid, non-expired session cookie.
  - HTML page requests without a valid session redirect to `/login`.
  - API requests without a valid session return `401 { status: false, msg: 'Unauthorized' }`.
- A background interval (e.g. every hour) sweeps expired entries out of the session `Map` to
  avoid unbounded growth across restarts-free long uptimes.
- `ADMIN_PASSWORD` unset at startup: identical fail-closed behavior to today — dashboard
  routes are unreachable, `/api/login` always rejects, and the server logs a warning.

`/join` (public join page) and `POST /api/join-token` (verifies the existing HMAC-signed
link token) are untouched and remain outside the session system — that flow was hardened in
the previous change (signed, room+role+expiry-bound tokens) and nothing here affects it.

## API routes

All under session auth except the two marked public.

```
POST   /api/login                     { password }                    → set session cookie
POST   /api/logout                    —                                 → clear session cookie

GET    /api/rooms                     —                                 → getActiveRoomsInfo()
POST   /api/rooms                     { roomId, title, lockSettings }   → createRoom()
GET    /api/rooms/:id                 —                                 → getActiveRoomInfo()
DELETE /api/rooms/:id                 —                                 → endRoom()
POST   /api/rooms/:id/links           { isAdmin }                       → signed link token (unchanged HMAC logic)

GET    /api/recordings                —                                 → fetchRecordings()
GET    /api/recordings/:id/download   —                                 → 302 to getRecordingDownloadUrl()
DELETE /api/recordings/:id            —                                 → deleteRecording()

GET    /api/artifacts                 —                                 → fetchArtifacts()
GET    /api/artifacts/:id/download    —                                 → 302 to getArtifactDownloadUrl()
DELETE /api/artifacts/:id             —                                 → deleteArtifact()

GET    /api/past-rooms                —                                 → fetchPastRooms()

GET    /join?t=<signed-token>         —                            [public] → name-picker page
POST   /api/join-token                { token, name }              [public] → verifies signature, mints real plugNmeet token
```

Route dispatch keeps the existing `${METHOD} ${path}` lookup style from `examples/server.js`,
extended to support `:id` path segments (simple manual parsing — no router dependency
needed for ~15 routes).

## Frontend structure

No state-management library. Each view module exports a `render(container)` function that:

1. Fetches its data via `api.js` helpers (thin `fetch` wrappers, one per resource).
2. Renders HTML into `container` (template strings + `element.innerHTML`, no vdom).
3. Wires up event listeners for actions (create, delete, generate link, etc.) that call the
   API and then re-invoke `render()` to refresh — no diffing, just re-render on demand.

`api.js` centralizes: `credentials: 'include'` on every request, automatic redirect to
`/login` on `401`, and error normalization (`{ status: false, msg }` responses throw
`Error(msg)`, caught by the calling view and shown as a dismissible toast/banner rather than
an unhandled exception).

`router.js` is a minimal hash-based (`#rooms`, `#recordings`, ...) or click-driven view
switcher: shows/hides the four view containers and highlights the active sidebar item. No
history-API library, no nested routes needed for four flat sections.

## Visual design

Dark theme matching plugNmeet's own UI (dark blue/slate, matching the screenshots captured
during testing this session). Plain CSS with custom properties for the palette (`--bg`,
`--surface`, `--accent`, `--text`, `--danger`), flexbox/grid layout, no CSS framework. Fixed
left sidebar (Rooms / Recordings / Artifacts / Past Rooms + logout), content area with
cards (Rooms grid) and tables (Recordings/Artifacts/Past Rooms).

## Error handling

- Backend: every route handler's thrown errors are caught centrally (same pattern as
  today's `examples/server.js`), mapped to `{ status: false, msg, status_code }` with the
  error's `statusCode` (400) or a 500 fallback, exactly as now.
- Frontend: `api.js` converts non-`status:true` responses into thrown `Error`s; views catch
  these locally and render an inline error state or toast — a failed fetch never leaves a
  view blank/unresponsive.
- Session expiry mid-session: any API call returning 401 triggers an automatic redirect to
  `/login`, no manual "session expired" handling needed per view.

## Deployment

`dashboard/Dockerfile`, multi-stage:

1. `node:22-alpine` builder — `npm ci`, `npm run build` (Vite, `dashboard/frontend/` → `dashboard/dist/`).
2. `node:22-alpine` runtime — copies `dashboard/dist/`, `dashboard/server.js`,
   `dashboard/public/join.html`, and the repo-root `src/` (the `PlugNMeetClient` library, so
   `server.js`'s `../src/PlugNMeetClient.js` import resolves). `EXPOSE 3000`,
   `CMD ["node", "server.js"]`.

Coolify: same application, Base Directory changed to `dashboard/`, otherwise identical env
vars (`PLUGNMEET_SERVER_URL`, `PLUGNMEET_API_KEY`, `PLUGNMEET_API_SECRET`, `ADMIN_PASSWORD`)
and port (3000).

## Testing approach

Manual verification via Playwright against a running `dashboard/server.js` (same approach
used throughout this session): login flow, create/list/end room, generate + open both link
types, recordings/artifacts list+delete, past-rooms list, session-expiry redirect, and a
repeat of the link-tampering security checks (room/role escalation attempts) against the new
route shapes.
