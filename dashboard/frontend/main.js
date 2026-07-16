import { registerView, startRouter } from './router.js';
import { api } from './api.js';
import * as rooms from './views/rooms.js';
import * as recordings from './views/recordings.js';
import * as artifacts from './views/artifacts.js';
import * as pastRooms from './views/past-rooms.js';

registerView('rooms', { title: 'Rooms', render: rooms.render });
registerView('recordings', { title: 'Recordings', render: recordings.render });
registerView('artifacts', { title: 'Artifacts', render: artifacts.render });
registerView('past-rooms', { title: 'Past Rooms', render: pastRooms.render });

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api.logout();
  location.href = '/login';
});

startRouter();
