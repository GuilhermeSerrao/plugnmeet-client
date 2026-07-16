export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function formatTimestamp(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return '—';
  return new Date(n * 1000).toLocaleString();
}

// Handles both unix-seconds numbers (e.g. room creation_time) and ISO date
// strings (e.g. past-room "created"/"ended") since the API mixes both.
export function formatDate(value) {
  if (!value) return '—';
  if (/^\d+$/.test(String(value))) return formatTimestamp(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
