import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DEFAULT_ROOM_METADATA = {
  room_title: 'Test room',
  welcome_message: 'Welcome to room',
  room_features: {
    allow_webcams: true,
    mute_on_start: false,
    allow_screen_share: true,
    admin_only_webcams: false,
    allow_view_other_webcams: true,
    allow_view_other_users_list: true,
    enable_analytics: true,
    allow_virtual_bg: true,
    allow_raise_hand: true,
    auto_gen_user_id: false,
    room_duration: 0,
    recording_features: {
      is_allow: true,
      is_allow_cloud: true,
      is_allow_local: true,
      enable_auto_cloud_recording: false,
      only_record_admin_webcams: false,
      recorder_bot_options: { enable_auto_close_chat_panel: true, duration_after_last_message: 10 },
    },
    chat_features: { is_allow: true, is_allow_file_upload: true },
    shared_note_pad_features: { is_allow: true },
    whiteboard_features: { is_allow: true },
    external_media_player_features: { is_allow: true },
    external_broadcasting_features: {
      is_allow: true,
      is_allow_rtmp: true,
      recorder_bot_options: { enable_auto_close_chat_panel: true, duration_after_last_message: 10 },
    },
    waiting_room_features: { is_active: false },
    breakout_room_features: { is_allow: true, allowed_number_rooms: 6 },
    display_external_link_features: { is_allow: true },
    ingress_features: { is_allow: true },
    polls_features: { is_allow: true },
    insights_features: {
      is_allow: false,
      transcription_features: { is_allow: false, is_allow_translation: false, is_allow_speech_synthesis: false },
      chat_translation_features: { is_allow: false },
      ai_features: {
        is_allow: false,
        ai_text_chat_features: { is_allow: false },
        meeting_summarization_features: { is_allow: false },
      },
    },
    sip_dial_in_features: { is_allow: false, enable_dial_in_on_create: false, hide_phone_number: false },
    end_to_end_encryption_features: {
      is_enabled: false,
      enabled_self_insert_encryption_key: false,
      included_chat_messages: false,
      included_whiteboard: false,
    },
  },
  default_lock_settings: {
    lock_microphone: false,
    lock_webcam: false,
    lock_screen_sharing: true,
    lock_whiteboard: true,
    lock_shared_notepad: true,
    lock_chat: false,
    lock_chat_send_message: false,
    lock_chat_file_share: false,
    lock_private_chat: false,
  },
  copyright_conf: {
    display: true,
    text: 'Powered by <a href="https://www.plugnmeet.org" target="_blank">plugNmeet</a>',
  },
  extra_data: {},
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep(target, source) {
  const output = { ...target };
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const key of Object.keys(source)) {
      output[key] = isPlainObject(source[key]) && isPlainObject(target[key])
        ? mergeDeep(target[key], source[key])
        : source[key];
    }
  }
  return output;
}

export default class PlugNMeetClient {
  #apiSecret;

  constructor({ serverUrl, apiKey, apiSecret }) {
    if (!serverUrl || !apiKey || !apiSecret) {
      throw new Error('serverUrl, apiKey and apiSecret are required');
    }
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.#apiSecret = apiSecret;
  }

  async #request(path, body = {}) {
    const bodyStr = JSON.stringify(body);
    const signature = createHmac('sha256', this.#apiSecret).update(bodyStr).digest('hex');

    const res = await fetch(`${this.serverUrl}/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-KEY': this.apiKey,
        'HASH-SIGNATURE': signature,
      },
      body: bodyStr,
    });

    return this.#handleResponse(res);
  }

  async #handleResponse(res) {
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`plugNmeet API: invalid response (HTTP ${res.status})`);
    }
    if (data.status === false) {
      const err = new Error(data.msg || 'plugNmeet API error');
      err.statusCode = data.status_code;
      err.response = data;
      throw err;
    }
    return data;
  }

  // ---- Room ----

  async createRoom(roomId, options = {}) {
    const metadata = mergeDeep(DEFAULT_ROOM_METADATA, options.metadata || {});
    const body = { room_id: roomId, metadata };
    if (options.max_participants !== undefined) body.max_participants = options.max_participants;
    if (options.empty_timeout !== undefined) body.empty_timeout = options.empty_timeout;
    return this.#request('/room/create', body);
  }

  async getJoinToken(roomId, userInfo) {
    return this.#request('/room/getJoinToken', { room_id: roomId, user_info: userInfo });
  }

  buildJoinUrl(token, { customDesign } = {}) {
    const url = new URL(this.serverUrl);
    url.searchParams.set('access_token', token);
    if (customDesign) {
      const value = typeof customDesign === 'string' ? customDesign : JSON.stringify(customDesign);
      url.searchParams.set('custom_design', value);
    }
    return url.toString();
  }

  async isRoomActive(roomId) {
    return this.#request('/room/isRoomActive', { room_id: roomId });
  }

  async getActiveRoomInfo(roomId) {
    return this.#request('/room/getActiveRoomInfo', { room_id: roomId });
  }

  async getActiveRoomsInfo() {
    return this.#request('/room/getActiveRoomsInfo', {});
  }

  async #broadcastToRoom(roomId, { onlyToAdmins = false, toUserId = '', chatMsg, notificationMsg } = {}) {
    const body = {
      room_id: roomId,
      only_to_admins: onlyToAdmins,
      to_user_id: toUserId,
    };
    if (chatMsg) body.chat_msg = chatMsg;
    if (notificationMsg) body.notification_msg = notificationMsg;
    return this.#request('/room/broadcastToRoom', body);
  }

  async sendChatMessage(roomId, message, { onlyToAdmins, toUserId } = {}) {
    return this.#broadcastToRoom(roomId, { onlyToAdmins, toUserId, chatMsg: { message } });
  }

  async sendNotification(roomId, text, { type = 0, withSound = false, onlyToAdmins, toUserId } = {}) {
    return this.#broadcastToRoom(roomId, {
      onlyToAdmins,
      toUserId,
      notificationMsg: { text, type, with_sound: withSound },
    });
  }

  async uploadWhiteboardFile(roomId, { filePath, documentLink } = {}) {
    if (!filePath && !documentLink) {
      throw new Error('Provide filePath or documentLink');
    }
    if (filePath && documentLink) {
      throw new Error('Provide only one of filePath or documentLink, not both');
    }

    const signature = createHmac('sha256', this.#apiSecret).update(roomId).digest('hex');
    const form = new FormData();
    if (filePath) {
      const fileBuffer = await readFile(filePath);
      form.append('document', new Blob([fileBuffer]), basename(filePath));
    } else {
      form.append('document_link', documentLink);
    }

    const res = await fetch(`${this.serverUrl}/auth/room/uploadWhiteboardFile`, {
      method: 'POST',
      headers: {
        'API-KEY': this.apiKey,
        'HASH-SIGNATURE': signature,
        'Room-Id': roomId,
      },
      body: form,
    });

    return this.#handleResponse(res);
  }

  async fetchPastRooms(roomIds, { from = 0, limit = 20, orderBy = 'DESC' } = {}) {
    return this.#request('/room/fetchPastRooms', {
      room_ids: roomIds,
      from,
      limit,
      order_by: orderBy,
    });
  }

  async endRoom(roomId) {
    return this.#request('/room/endRoom', { room_id: roomId });
  }

  // ---- Recording ----

  async fetchRecordings(roomIds, { roomSid = '', from = 0, limit = 20, orderBy = 'DESC' } = {}) {
    return this.#request('/recording/fetch', {
      room_ids: roomIds,
      room_sid: roomSid,
      from,
      limit,
      order_by: orderBy,
    });
  }

  async getRecordingInfo(recordId) {
    return this.#request('/recording/info', { record_id: recordId });
  }

  async getRecordingDownloadUrl(recordId) {
    const { token } = await this.#request('/recording/getDownloadToken', { record_id: recordId });
    return `${this.serverUrl}/download/recording/${token}`;
  }

  async deleteRecording(recordId) {
    return this.#request('/recording/delete', { record_id: recordId });
  }

  async updateRecordingMetadata(recordId, metadata) {
    return this.#request('/recording/updateMetadata', { record_id: recordId, metadata });
  }

  async mergeRecordingsBySession(roomSid, excludeRecordingIds = []) {
    return this.#request('/recording/mergeRecordings', {
      by_session: { room_sid: roomSid, exclude_recording_ids: excludeRecordingIds },
    });
  }

  async mergeRecordingsByIds(roomId, recordingIds) {
    return this.#request('/recording/mergeRecordings', {
      by_ids: { room_id: roomId, recording_ids: recordingIds },
    });
  }

  // ---- Artifact ----

  async fetchArtifacts({ roomIds, roomSid, type, from = 0, limit = 20, orderBy = 'DESC' } = {}) {
    const body = { from, limit, order_by: orderBy };
    if (roomIds !== undefined) body.room_ids = roomIds;
    if (roomSid !== undefined) body.room_sid = roomSid;
    if (type !== undefined) body.type = type;
    return this.#request('/artifact/fetch', body);
  }

  async getArtifactInfo(artifactId) {
    return this.#request('/artifact/info', { artifact_id: artifactId });
  }

  async getArtifactDownloadUrl(artifactId) {
    const { token } = await this.#request('/artifact/getDownloadToken', { artifact_id: artifactId });
    return `${this.serverUrl}/download/artifact/${token}`;
  }

  async deleteArtifact(artifactId) {
    return this.#request('/artifact/delete', { artifact_id: artifactId });
  }

  // ---- Client files ----

  async getClientFiles() {
    const { css_files, js_files } = await this.#request('/getClientFiles', {});
    return {
      cssUrls: (css_files || []).map((file) => `${this.serverUrl}/assets/css/${file}`),
      jsUrls: (js_files || []).map((file) => `${this.serverUrl}/assets/js/${file}`),
    };
  }
}
