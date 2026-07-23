const headRow = document.getElementById('stats-head-row');
const statsBody = document.getElementById('stats-body');
const connectionState = document.getElementById('connection-state');
const toastElement = document.getElementById('toast');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, isError = false) {
  toastElement.textContent = message;
  toastElement.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastElement.timer);
  toastElement.timer = setTimeout(() => { toastElement.className = 'toast'; }, 3200);
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = '/factory';
    throw new Error('Factory session expired');
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function dayLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function heatClass(value, max) {
  if (!value) return 'heat-0';
  if (max <= 0) return 'heat-0';
  const ratio = value / max;
  if (ratio >= 0.75) return 'heat-4';
  if (ratio >= 0.5) return 'heat-3';
  if (ratio >= 0.25) return 'heat-2';
  return 'heat-1';
}

function timeAgo(iso) {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function renderStats({ days, rows }) {
  const today = days[days.length - 1];
  headRow.innerHTML = `
    <th class="stats-source-col">Fetcher</th>
    ${days.map((date) => `<th class="mono">${escapeHtml(dayLabel(date))}${date === today ? ' <span class="today-mark">today</span>' : ''}</th>`).join('')}
    <th class="mono">7-day total</th>
  `;

  if (!rows.length) {
    statsBody.innerHTML = `<tr><td colspan="${days.length + 2}" class="mono">No fetchers configured.</td></tr>`;
    return;
  }

  const max = Math.max(1, ...rows.flatMap((row) => row.daily));
  statsBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="stats-source-col" data-label="Fetcher"><strong>${escapeHtml(row.source)}</strong><span class="mono">${escapeHtml(row.id)}</span></td>
      ${row.daily.map((value, index) => `<td class="stats-count ${heatClass(value, max)}" data-label="${escapeHtml(dayLabel(days[index]))}">${value}</td>`).join('')}
      <td class="stats-total mono" data-label="Total">${row.total}</td>
    </tr>
  `).join('');
}

async function refreshStats() {
  try {
    const data = await api('/api/factory/fetch-stats?days=7');
    renderStats(data);
    document.getElementById('last-updated').textContent = `Updated ${timeAgo(data.generatedAt)}`;
    connectionState.textContent = 'live';
    connectionState.className = 'connection-state online';
  } catch (error) {
    connectionState.textContent = 'offline';
    connectionState.className = 'connection-state offline';
    toast(error.message, true);
  }
}

document.getElementById('refresh-button').addEventListener('click', refreshStats);

refreshStats();
