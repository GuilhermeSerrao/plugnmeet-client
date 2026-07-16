import { api } from '../api.js';
import { toast } from '../toast.js';
import { openModal, closeModal } from '../modal.js';
import { escapeHtml, formatTimestamp } from '../util.js';
import { refreshCurrentView } from '../router.js';

const LOCK_FIELDS = [
  ['lock_microphone', 'Disable microphone for everyone', false],
  ['lock_webcam', 'Disable webcam for everyone', false],
  ['lock_screen_sharing', 'Disable screen sharing for everyone', true],
  ['lock_whiteboard', 'Disable whiteboard for everyone', true],
  ['lock_shared_notepad', 'Disable shared notepad for everyone', true],
  ['lock_reactions', 'Disable reactions for everyone', false],
  ['lock_chat', 'Disable public chat', false],
  ['lock_chat_send_message', 'Disable sending chat messages', false],
  ['lock_chat_file_share', 'Disable file sharing in chat', false],
  ['lock_private_chat', 'Disable private chat', false],
];

export async function render(container) {
  container.innerHTML = `
    <div style="margin-bottom:1rem;">
      <button class="btn" id="createRoomBtn">+ Create room</button>
    </div>
    <div id="roomsGrid" class="card-grid"></div>
  `;

  document.getElementById('createRoomBtn').addEventListener('click', openCreateModal);

  await loadRooms();
}

async function loadRooms() {
  const grid = document.getElementById('roomsGrid');
  const data = await api.listRooms();
  const rooms = data.rooms || [];

  if (rooms.length === 0) {
    grid.innerHTML = '<p class="empty-state">No active rooms. Create one to get started.</p>';
    return;
  }

  grid.innerHTML = rooms.map(({ room_info }) => `
    <div class="card">
      <h3>${escapeHtml(room_info.room_title)}</h3>
      <div class="meta">
        ${escapeHtml(room_info.room_id)}<br>
        ${room_info.joined_participants} participant(s) · created ${formatTimestamp(room_info.creation_time)}
      </div>
      <div class="actions">
        <button class="btn secondary" data-action="details" data-id="${escapeHtml(room_info.room_id)}">Details</button>
        <button class="btn secondary" data-action="links" data-id="${escapeHtml(room_info.room_id)}">Links</button>
        <button class="btn danger" data-action="end" data-id="${escapeHtml(room_info.room_id)}">End</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-action="details"]').forEach((el) => {
    el.addEventListener('click', () => openDetailsModal(el.dataset.id));
  });
  grid.querySelectorAll('[data-action="links"]').forEach((el) => {
    el.addEventListener('click', () => openLinksModal(el.dataset.id));
  });
  grid.querySelectorAll('[data-action="end"]').forEach((el) => {
    el.addEventListener('click', () => endRoom(el.dataset.id));
  });
}

function openCreateModal() {
  const backdrop = openModal(`
    <h2>Create room</h2>
    <div class="field">
      <label>Room ID</label>
      <input type="text" id="newRoomId" placeholder="e.g. team-standup">
    </div>
    <div class="field">
      <label>Title</label>
      <input type="text" id="newRoomTitle" placeholder="e.g. Team standup">
    </div>
    <div class="field">
      <label>Lock settings (applies to everyone except admins/presenters)</label>
      ${LOCK_FIELDS.map(([key, label, defaultChecked]) => `
        <div class="checkbox-row">
          <input type="checkbox" id="lock_${key}" ${defaultChecked ? 'checked' : ''}>
          <label for="lock_${key}" style="margin:0;">${label}</label>
        </div>
      `).join('')}
    </div>
    <div class="actions">
      <button class="btn" id="submitCreate">Create</button>
      <button class="btn secondary" id="cancelCreate">Cancel</button>
    </div>
  `);

  document.getElementById('cancelCreate').addEventListener('click', () => closeModal(backdrop));
  document.getElementById('submitCreate').addEventListener('click', async () => {
    const roomId = document.getElementById('newRoomId').value.trim();
    const title = document.getElementById('newRoomTitle').value.trim();
    if (!roomId) return toast('Room ID is required', 'error');

    const lockSettings = {};
    for (const [key] of LOCK_FIELDS) {
      lockSettings[key] = document.getElementById(`lock_${key}`).checked;
    }

    try {
      await api.createRoom(roomId, title, lockSettings);
      closeModal(backdrop);
      toast('Room created');
      await loadRooms();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function openDetailsModal(roomId) {
  const backdrop = openModal('<p>Loading…</p>');
  try {
    const data = await api.getRoom(roomId);
    const participants = data.room?.participants_info || [];
    backdrop.querySelector('.modal').innerHTML = `
      <h2>${escapeHtml(data.room?.room_info?.room_title || roomId)}</h2>
      <p class="meta">${escapeHtml(roomId)}</p>
      <h3 style="font-size:0.9rem;">Participants (${participants.length})</h3>
      ${participants.length === 0 ? '<p class="empty-state">No one online.</p>' : `
        <table>
          <thead><tr><th>Name</th><th>Role</th></tr></thead>
          <tbody>
            ${participants.map((p) => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${p.is_admin ? 'Admin/Presenter' : 'Listener'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
      <div class="actions" style="margin-top:1rem;">
        <button class="btn secondary" id="closeDetails">Close</button>
      </div>
    `;
    backdrop.querySelector('#closeDetails').addEventListener('click', () => closeModal(backdrop));
  } catch (err) {
    backdrop.querySelector('.modal').innerHTML = `<p class="empty-state">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function openLinksModal(roomId) {
  const backdrop = openModal(`
    <h2>Shareable links</h2>
    <p class="meta">${escapeHtml(roomId)}</p>
    <div class="actions">
      <button class="btn secondary" id="genListener">Generate listener link</button>
      <button class="btn secondary" id="genPresenter">Generate presenter link</button>
    </div>
    <div id="listenerLinkResult"></div>
    <div id="presenterLinkResult"></div>
    <div class="actions" style="margin-top:1rem;">
      <button class="btn secondary" id="closeLinks">Close</button>
    </div>
  `);

  backdrop.querySelector('#closeLinks').addEventListener('click', () => closeModal(backdrop));

  async function generate(isAdmin, targetId) {
    try {
      const { token } = await api.createLink(roomId, isAdmin);
      const url = `${location.origin}/join?t=${encodeURIComponent(token)}`;
      backdrop.querySelector(`#${targetId}`).innerHTML =
        `<div class="link-row"><a href="${url}" target="_blank">${url}</a></div>`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  backdrop.querySelector('#genListener').addEventListener('click', () => generate(false, 'listenerLinkResult'));
  backdrop.querySelector('#genPresenter').addEventListener('click', () => generate(true, 'presenterLinkResult'));
}

async function endRoom(roomId) {
  if (!confirm(`End room "${roomId}"? This disconnects everyone.`)) return;
  try {
    await api.endRoom(roomId);
    toast('Room ended');
    refreshCurrentView();
  } catch (err) {
    toast(err.message, 'error');
  }
}
