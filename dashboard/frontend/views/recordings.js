import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, formatDate, formatBytes } from '../util.js';

export async function render(container) {
  container.innerHTML = '<div id="recordingsTable"></div>';
  await load(container);
}

async function load(container) {
  const data = await api.listRecordings();
  const recordings = data.result?.recordings_list || [];
  const target = document.getElementById('recordingsTable');

  if (recordings.length === 0) {
    target.innerHTML = '<p class="empty-state">No recordings yet.</p>';
    return;
  }

  target.innerHTML = `
    <table>
      <thead><tr><th>Room</th><th>Created</th><th>Size</th><th></th></tr></thead>
      <tbody>
        ${recordings.map((r) => `
          <tr>
            <td>${escapeHtml(r.room_id)}</td>
            <td>${formatDate(r.creation_time)}</td>
            <td>${formatBytes(r.file_size * 1024 * 1024)}</td>
            <td>
              <a class="btn secondary" href="/api/recordings/${encodeURIComponent(r.record_id)}/download" target="_blank">Download</a>
              <button class="btn danger" data-id="${escapeHtml(r.record_id)}">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  target.querySelectorAll('button[data-id]').forEach((el) => {
    el.addEventListener('click', () => remove(el.dataset.id, container));
  });
}

async function remove(id, container) {
  if (!confirm('Delete this recording? This cannot be undone.')) return;
  try {
    await api.deleteRecording(id);
    toast('Recording deleted');
    await load(container);
  } catch (err) {
    toast(err.message, 'error');
  }
}
