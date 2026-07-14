# plugnmeet-client

Cliente Node.js (ESM, sem dependências de runtime) para a API do [plugNmeet](https://www.plugnmeet.org).

## Instalação

```bash
npm install
cp .env.example .env
```

## Uso

```js
import PlugNMeetClient from './src/index.js';

const client = new PlugNMeetClient({
  serverUrl: process.env.PLUGNMEET_SERVER_URL,
  apiKey: process.env.PLUGNMEET_API_KEY,
  apiSecret: process.env.PLUGNMEET_API_SECRET,
});
```

### Criar sala e gerar link de entrada

```js
await client.createRoom('room01', {
  metadata: { room_title: 'Reunião de equipa' },
});

const { token } = await client.getJoinToken('room01', {
  name: 'Guilherme',
  user_id: 'guilherme-1',
  is_admin: true,
});

const joinUrl = client.buildJoinUrl(token);
console.log(joinUrl); // https://meet.digitalrocket.pt/?access_token=<TOKEN>
```

### Listar salas ativas

```js
const { rooms } = await client.getActiveRoomsInfo();
console.log(rooms);
```

### Encerrar sala

```js
await client.endRoom('room01');
```

### Listar e apagar gravações

```js
const { result } = await client.fetchRecordings(['room01']);
console.log(result.rooms_list);

await client.deleteRecording('RM_xxx');
```

### Obter URL de download de uma gravação

```js
const url = await client.getRecordingDownloadUrl('RM_xxx');
console.log(url); // https://meet.digitalrocket.pt/download/recording/<TOKEN>
```

### Enviar mensagem de chat / notificação para a sala

```js
await client.sendChatMessage('room01', 'Olá a todos');
await client.sendNotification('room01', 'A gravação vai começar', { type: 1 });
```

### Upload de ficheiro para o whiteboard

```js
await client.uploadWhiteboardFile('room01', { filePath: './slides.pdf' });
// ou
await client.uploadWhiteboardFile('room01', { documentLink: 'https://example.com/slides.pdf' });
```

### Embutir o client sem iframe

```js
const { cssUrls, jsUrls } = await client.getClientFiles();
// <link rel="stylesheet" href="..."> para cada cssUrls
// <script src="..." defer> (ou type="module" para o ficheiro main-module.*) para cada jsUrls
// div de montagem: <div id="plugNmeet-app"></div>
```

## API

Ver `plugnmeet-nodejs-client-handoff.md` para a especificação completa dos 20 endpoints implementados (Room, Recording, Artifact, Get Client Files).

Todos os métodos são `async` e lançam um `Error` (com `.statusCode` e `.response`) quando a API devolve `status: false`.
