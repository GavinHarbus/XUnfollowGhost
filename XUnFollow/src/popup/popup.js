import { MSG } from '../lib/messages.js';

// --- DOM Elements ---
const $ = (id) => document.getElementById(id);

const els = {
  setupSection: $('setup-section'),
  dashboardSection: $('dashboard-section'),
  settingsPanel: $('settings-panel'),

  statFollowers: $('stat-followers'),
  statUnfollowers: $('stat-unfollowers'),
  statScans: $('stat-scans'),

  accountName: $('account-name'),
  lastScanTime: $('last-scan-time'),

  scanBtn: $('scan-btn'),
  progressContainer: $('progress-container'),
  progressText: $('progress-text'),
  progressPercent: $('progress-percent'),
  progressFill: $('progress-fill'),
  cancelScanBtn: $('cancel-scan-btn'),
  firstScanMsg: $('first-scan-msg'),

  unfollowerCount: $('unfollower-count'),
  unfollowerList: $('unfollower-list'),
  unfollowerEmpty: $('unfollower-empty'),
  loadMoreBtn: $('load-more-unfollowers'),

  historyToggle: $('history-toggle'),
  historyList: $('history-list'),

  settingsBtn: $('settings-btn'),
  settingsBackBtn: $('settings-back-btn'),
  exportBtn: $('export-btn'),
  clearDataBtn: $('clear-data-btn'),
};

let unfollowerOffset = 0;
const UNFOLLOWER_PAGE_SIZE = 20;

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
  const status = await sendMessage({ type: MSG.GET_STATUS });

  // Always show dashboard — scan button must be accessible
  els.setupSection.classList.add('hidden');
  els.dashboardSection.classList.remove('hidden');

  if (status.screenName) {
    els.accountName.textContent = `@${status.screenName}`;
  }

  if (status.isScanning) {
    showProgress();
    updateProgress(status.progress || 0, `Resuming scan...`);
  }

  await loadStats();
  await loadUnfollowers();

  setupEventListeners();
  setupMessageListener();
});

// --- Data Loading ---

async function loadStats() {
  const stats = await sendMessage({ type: MSG.GET_STATS });
  els.statFollowers.textContent = formatNumber(stats.totalFollowers);
  els.statUnfollowers.textContent = formatNumber(stats.totalUnfollowers);
  els.statScans.textContent = formatNumber(stats.totalScans);
  els.lastScanTime.textContent = stats.lastScanTimestamp
    ? timeAgo(stats.lastScanTimestamp)
    : 'Never';

  const badge = els.unfollowerCount;
  if (stats.totalUnfollowers === 0) {
    badge.classList.add('zero');
  } else {
    badge.classList.remove('zero');
  }
}

async function loadUnfollowers(append = false) {
  if (!append) {
    unfollowerOffset = 0;
    els.unfollowerList.innerHTML = '';
  }

  const result = await sendMessage({
    type: MSG.GET_UNFOLLOWERS,
    limit: UNFOLLOWER_PAGE_SIZE,
    offset: unfollowerOffset,
  });

  const { items, totalCount } = result;

  els.unfollowerCount.textContent = totalCount || 0;

  if (totalCount === 0 && unfollowerOffset === 0) {
    els.unfollowerEmpty.classList.remove('hidden');
    els.loadMoreBtn.classList.add('hidden');
    return;
  }

  els.unfollowerEmpty.classList.add('hidden');

  for (const u of items) {
    els.unfollowerList.appendChild(createUnfollowerCard(u));
  }

  unfollowerOffset += items.length;

  if (unfollowerOffset < totalCount) {
    els.loadMoreBtn.classList.remove('hidden');
  } else {
    els.loadMoreBtn.classList.add('hidden');
  }
}

async function loadScanHistory() {
  const items = await sendMessage({
    type: MSG.GET_SCAN_HISTORY,
    limit: 10,
  });

  els.historyList.innerHTML = '';

  if (items.length === 0) {
    els.historyList.innerHTML =
      '<li class="empty-state"><p>No scan history yet.</p></li>';
    return;
  }

  for (const scan of items) {
    els.historyList.appendChild(createHistoryItem(scan));
  }
}

// --- UI Rendering ---

function createUnfollowerCard(u) {
  const li = document.createElement('li');
  li.className = 'unfollower-card';

  const verifiedSvg = u.isBlueVerified
    ? `<svg class="verified-badge" viewBox="0 0 22 22" width="16" height="16">
        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.143.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.225 1.261.272 1.893.143.636-.131 1.22-.437 1.69-.884.445-.47.75-1.055.88-1.691.131-.634.08-1.292-.143-1.896.587-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/>
      </svg>`
    : '';

  li.innerHTML = `
    <img class="avatar" src="${escapeAttr(u.avatarUrl)}" alt=""
         onerror="this.style.display='none'">
    <div class="user-info">
      <div class="user-name-row">
        <span class="display-name">${escapeHtml(u.displayName)}</span>
        ${verifiedSvg}
      </div>
      <div class="screen-name">@${escapeHtml(u.screenName)}</div>
      <div class="detect-time">${formatDate(u.detectedAt)}</div>
    </div>
    <a class="view-link" href="https://x.com/${encodeURIComponent(u.screenName)}"
       target="_blank">View</a>
  `;

  return li;
}

function createHistoryItem(scan) {
  const li = document.createElement('li');
  li.className = 'history-item';

  const statusClass =
    scan.status === 'completed'
      ? 'status-completed'
      : scan.status === 'failed'
        ? 'status-failed'
        : 'status-cancelled';

  const detail = scan.status === 'completed'
    ? `${scan.totalFollowers} followers, ${scan.unfollowersCount} unfollowed, ${scan.newFollowersCount} new`
    : scan.error || scan.status;

  li.innerHTML = `
    <div class="history-left">
      <span class="history-date">${formatDate(scan.startedAt)}</span>
      <span class="history-detail">${escapeHtml(detail)}</span>
    </div>
    <span class="history-status ${statusClass}">${scan.status}</span>
  `;

  return li;
}

// --- Event Listeners ---

function setupEventListeners() {
  // Scan button
  els.scanBtn.addEventListener('click', async () => {
    els.scanBtn.disabled = true;
    showProgress();
    updateProgress(0, 'Starting scan...');
    await sendMessage({ type: MSG.START_SCAN });
  });

  // Cancel scan
  els.cancelScanBtn.addEventListener('click', async () => {
    await sendMessage({ type: MSG.CANCEL_SCAN });
  });

  // Load more unfollowers
  els.loadMoreBtn.addEventListener('click', () => {
    loadUnfollowers(true);
  });

  // History toggle
  els.historyToggle.addEventListener('click', () => {
    const body = els.historyList;
    const isHidden = body.classList.contains('hidden');

    body.classList.toggle('hidden');
    els.historyToggle.classList.toggle('expanded', isHidden);

    if (isHidden) {
      loadScanHistory();
    }
  });

  // Settings
  els.settingsBtn.addEventListener('click', () => {
    els.dashboardSection.classList.add('hidden');
    els.setupSection.classList.add('hidden');
    els.settingsPanel.classList.remove('hidden');
  });

  els.settingsBackBtn.addEventListener('click', () => {
    els.settingsPanel.classList.add('hidden');
    els.dashboardSection.classList.remove('hidden');
  });

  // Export
  els.exportBtn.addEventListener('click', async () => {
    const result = await sendMessage({ type: MSG.EXPORT_CSV });
    if (result.csv) {
      downloadFile('unfollowers.csv', result.csv, 'text/csv');
    }
  });

  // Clear data
  els.clearDataBtn.addEventListener('click', async () => {
    if (confirm('Are you sure? This will delete all scan data and settings.')) {
      await sendMessage({ type: MSG.CLEAR_ALL_DATA });
      els.settingsPanel.classList.add('hidden');
      els.dashboardSection.classList.remove('hidden');
      els.accountName.textContent = '';
      els.lastScanTime.textContent = 'Never';
      await loadStats();
      await loadUnfollowers();
    }
  });
}

// --- Listen for progress from service worker ---

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case MSG.SCAN_PROGRESS:
        if (message.progress === -1) {
          els.progressFill.classList.add('indeterminate');
          updateProgress(-1, message.message || 'Waiting...');
        } else {
          els.progressFill.classList.remove('indeterminate');
          updateProgress(message.progress, `Fetched ${message.fetched} followers...`);
        }
        break;

      case MSG.SCAN_COMPLETE:
        hideProgress();
        els.scanBtn.disabled = false;

        // After first scan, switch from setup to dashboard
        els.setupSection.classList.add('hidden');
        els.dashboardSection.classList.remove('hidden');

        if (message.isFirstScan) {
          els.firstScanMsg.classList.remove('hidden');
          setTimeout(() => els.firstScanMsg.classList.add('hidden'), 8000);
        }

        // Warn if scan appears incomplete
        if (message.expectedCount && message.isComplete === false) {
          const pct = Math.round((message.totalFollowers / message.expectedCount) * 100);
          alert(`Scan may be incomplete: found ${message.totalFollowers} of ${message.expectedCount} expected followers (${pct}%). Try scanning again.`);
        }

        loadStats();
        loadUnfollowers();
        break;

      case MSG.SCAN_ERROR:
        hideProgress();
        els.scanBtn.disabled = false;

        if (message.error !== 'cancelled') {
          alert(`Scan failed: ${message.error || message.message}`);
        }
        break;
    }
  });
}

// --- Progress UI ---

function showProgress() {
  els.progressContainer.classList.remove('hidden');
  els.scanBtn.classList.add('hidden');
}

function hideProgress() {
  els.progressContainer.classList.add('hidden');
  els.scanBtn.classList.remove('hidden');
  els.progressFill.style.width = '0%';
  els.progressFill.classList.remove('indeterminate');
}

function updateProgress(percent, text) {
  if (percent >= 0) {
    els.progressFill.style.width = `${Math.round(percent)}%`;
    els.progressPercent.textContent = `${Math.round(percent)}%`;
  }
  if (text) {
    els.progressText.textContent = text;
  }
}

// --- Messaging ---

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// --- Utilities ---

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(timestamp);
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const month = d.toLocaleString('en', { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${hours}:${mins}`;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
