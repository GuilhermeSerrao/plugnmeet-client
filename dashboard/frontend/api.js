async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (data.status === false) {
    throw new Error(data.msg || 'Request failed');
  }
  return data;
}

export const api = {
  logout: () => request('POST', '/api/logout'),

  listRooms: () => request('GET', '/api/rooms'),
  createRoom: (roomId, title, lockSettings) => request('POST', '/api/rooms', { roomId, title, lockSettings }),
  getRoom: (id) => request('GET', `/api/rooms/${encodeURIComponent(id)}`),
  endRoom: (id) => request('DELETE', `/api/rooms/${encodeURIComponent(id)}`),
  createLink: (id, isAdmin) => request('POST', `/api/rooms/${encodeURIComponent(id)}/links`, { isAdmin }),

  listRecordings: () => request('GET', '/api/recordings'),
  deleteRecording: (id) => request('DELETE', `/api/recordings/${encodeURIComponent(id)}`),

  listArtifacts: () => request('GET', '/api/artifacts'),
  deleteArtifact: (id) => request('DELETE', `/api/artifacts/${encodeURIComponent(id)}`),

  listPastRooms: () => request('GET', '/api/past-rooms'),
};
