import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, formatDate, formatBytes } from '../util.js';

export async function render(container) {
  container.innerHTML = '<div id="artifactsTable"></div>';
  await load(container);
}

async function load(container) {
  const data = await api.listArtifacts();
  const artifacts = data.result?.artifacts_list || [];
  const target = document.getElementById('artifactsTable');

  if (artifacts.length === 0) {
    target.innerHTML = '<p class="empty-state">No artifacts yet.</p>';
    return;
  }

  target.innerHTML = `
    <table>
      <thead><tr><th>Room</th><th>Type</th><th>Created</th><th>Size</th><th></th></tr></thead>
      <tbody>
        ${artifacts.map((a) => `
          <tr>
            <td>${escapeHtml(a.room_id)}</td>
            <td>${escapeHtml(a.type)}</td>
            <td>${formatDate(a.created)}</td>
            <td>${formatBytes(a.metadata?.file_info?.file_size)}</td>
            <td>
              <a class="btn secondary" href="/api/artifacts/${encodeURIComponent(a.artifact_id)}/download" target="_blank">Download</a>
              <button class="btn danger" data-id="${escapeHtml(a.artifact_id)}">Delete</button>
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
  if (!confirm('Delete this artifact? This cannot be undone.')) return;
  try {
    await api.deleteArtifact(id);
    toast('Artifact deleted');
    await load(container);
  } catch (err) {
    toast(err.message, 'error');
  }
}
