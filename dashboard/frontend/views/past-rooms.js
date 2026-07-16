import { api } from '../api.js';
import { escapeHtml, formatDate } from '../util.js';

export async function render(container) {
  const data = await api.listPastRooms();
  const rooms = data.result?.rooms_list || [];

  if (rooms.length === 0) {
    container.innerHTML = '<p class="empty-state">No past rooms yet.</p>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Title</th><th>Room ID</th><th>Started</th><th>Ended</th></tr></thead>
      <tbody>
        ${rooms.map((r) => `
          <tr>
            <td>${escapeHtml(r.room_title)}</td>
            <td>${escapeHtml(r.room_id)}</td>
            <td>${formatDate(r.created)}</td>
            <td>${formatDate(r.ended)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
