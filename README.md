# plugnmeet-client

Node.js client (ESM, no runtime dependencies) for the [plugNmeet](https://www.plugnmeet.org) API.

## Install

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your plugNmeet server URL, API key, and API secret.

## Usage

```js
import PlugNMeetClient from './src/index.js';

const client = new PlugNMeetClient({
  serverUrl: process.env.PLUGNMEET_SERVER_URL,
  apiKey: process.env.PLUGNMEET_API_KEY,
  apiSecret: process.env.PLUGNMEET_API_SECRET,
});
```

### Create a room and generate a join link

```js
await client.createRoom('room01', {
  metadata: { room_title: 'Team meeting' },
});

const { token } = await client.getJoinToken('room01', {
  name: 'Guilherme',
  user_id: 'guilherme-1',
  is_admin: true,
});

const joinUrl = client.buildJoinUrl(token);
console.log(joinUrl); // https://your-server.example.com/?access_token=<TOKEN>
```

### List active rooms

```js
const { rooms } = await client.getActiveRoomsInfo();
console.log(rooms);
```

### End a room

```js
await client.endRoom('room01');
```

### List and delete recordings

```js
const { result } = await client.fetchRecordings(['room01']);
console.log(result.rooms_list);

await client.deleteRecording('RM_xxx');
```

### Get a recording download URL

```js
const url = await client.getRecordingDownloadUrl('RM_xxx');
console.log(url); // https://your-server.example.com/download/recording/<TOKEN>
```

### Send a chat message / notification to a room

```js
await client.sendChatMessage('room01', 'Hello everyone');
await client.sendNotification('room01', 'Recording is about to start', { type: 1 });
```

### Upload a whiteboard file

```js
await client.uploadWhiteboardFile('room01', { filePath: './slides.pdf' });
// or
await client.uploadWhiteboardFile('room01', { documentLink: 'https://example.com/slides.pdf' });
```

### Embed the official client without an iframe

```js
const { cssUrls, jsUrls } = await client.getClientFiles();
// <link rel="stylesheet" href="..."> for each cssUrls
// <script src="..." defer> (or type="module" for the main-module.* file) for each jsUrls
// mount point: <div id="plugNmeet-app"></div>
```

## Testing with the HTML page (local)

`examples/` has a small tester — a native Node server (no deps) that serves an HTML page and calls `PlugNMeetClient` on the backend (the API secret never reaches the browser).

```bash
node --env-file=.env examples/server.js
```

Open `http://localhost:3000`. The page lets you: create a room, generate a join link (as admin or guest), check if a room is active, list active rooms, and end a room. All actions share a single Room ID field, so create the room first before generating a join link for it.

## API coverage

All methods are `async` and throw an `Error` (with `.statusCode` and `.response`) when the API returns `status: false`.

### Room
`createRoom`, `getJoinToken` + `buildJoinUrl`, `isRoomActive`, `getActiveRoomInfo`, `getActiveRoomsInfo`, `sendChatMessage`, `sendNotification`, `uploadWhiteboardFile`, `fetchPastRooms`, `endRoom`

### Recording
`fetchRecordings`, `getRecordingInfo`, `getRecordingDownloadUrl`, `deleteRecording`, `updateRecordingMetadata`, `mergeRecordingsBySession`, `mergeRecordingsByIds`

### Artifact
`fetchArtifacts`, `getArtifactInfo`, `getArtifactDownloadUrl`, `deleteArtifact`

### Client files
`getClientFiles` — for embedding the official plugNmeet web client without an iframe

## Notes

- Join tokens are one-time-use and short-lived — generate one and consume it immediately, don't cache it.
- Live in-call moderation (e.g. force-muting a participant who's already talking) is not part of the documented `/auth` REST API this client wraps — it goes through plugNmeet's internal real-time protocol (NATS + protobuf) used by the official web client. `is_admin` and `lock_settings` (at join time or as room defaults) control permissions before/at join; use the official client (via `getClientFiles`) for live moderation controls.
