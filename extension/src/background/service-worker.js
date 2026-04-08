import {
  openDB,
  addSnapshot,
  getLatestSnapshot,
  getSecondLatestSnapshot,
  upsertFollowersBatch,
  addUnfollowers,
  getFollower,
  addScanRecord,
  updateScanRecord,
  getUnfollowers,
  getUnfollowerCount,
  getScanHistory,
  getStats,
  clearAllData,
} from '../lib/db.js';
import {
  diffSnapshots,
  computeSnapshotFromFollowers,
} from '../lib/diff-engine.js';
import {
  DEFAULT_SETTINGS,
  SCAN_ALARM_NAME,
  STORAGE_KEYS,
} from '../lib/constants.js';
import { MSG } from '../lib/messages.js';

// --- State ---

// Accumulated followers from SCAN_BATCH messages during an active scan
let scanFollowers = [];
let activeScanTabId = null;
let autoCreatedTab = false;

// --- Initialization ---

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.SCAN_STATE]: {
        isScanning: false,
        progress: 0,
        currentPage: 0,
        totalFetched: 0,
        startedAt: null,
      },
      [STORAGE_KEYS.AUTH_CONFIG]: {
        bearerToken: null,
        followersQueryId: null,
        userId: null,
        screenName: null,
      },
    });
    await openDB();
  }
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  const { scanState } = await chrome.storage.local.get(STORAGE_KEYS.SCAN_STATE);
  if (scanState?.isScanning) {
    await updateScanState({ isScanning: false, progress: 0 });
  }
  await setupAlarm();
});

// --- Alarm ---

async function setupAlarm() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const s = settings || DEFAULT_SETTINGS;
  await chrome.alarms.clear(SCAN_ALARM_NAME);
  if (s.autoScanEnabled) {
    chrome.alarms.create(SCAN_ALARM_NAME, {
      delayInMinutes: s.scanIntervalMinutes,
      periodInMinutes: s.scanIntervalMinutes,
    });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SCAN_ALARM_NAME) {
    await runScan({ fromAlarm: true });
  }
});

// --- Scan State Helpers ---

async function updateScanState(updates) {
  const { scanState } = await chrome.storage.local.get(STORAGE_KEYS.SCAN_STATE);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SCAN_STATE]: { ...(scanState || {}), ...updates },
  });
}

async function getScanState() {
  const { scanState } = await chrome.storage.local.get(STORAGE_KEYS.SCAN_STATE);
  return scanState || { isScanning: false };
}

async function getAuthConfig() {
  const { authConfig } = await chrome.storage.local.get(STORAGE_KEYS.AUTH_CONFIG);
  return authConfig || {};
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return settings || DEFAULT_SETTINGS;
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Tab Management ---

async function findOrCreateXTab(createIfMissing) {
  const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
  if (tabs.length > 0) {
    return { tabId: tabs[0].id, autoCreated: false };
  }

  if (!createIfMissing) {
    return null;
  }

  // Create a background tab for auto-scan
  const tab = await chrome.tabs.create({ url: 'https://x.com', active: false });
  await new Promise((resolve) => {
    function onUpdated(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 30000);
  });
  // Wait for content script to inject
  await sleep(2000);
  return { tabId: tab.id, autoCreated: true };
}

// --- Core Scan ---

async function runScan({ fromAlarm = false } = {}) {
  const state = await getScanState();
  if (state.isScanning) return;

  const authConfig = await getAuthConfig();
  const userId = authConfig.userId;

  if (!userId) {
    broadcastToPopup({
      type: MSG.SCAN_ERROR,
      error: 'no_user_id',
      message: 'Please visit x.com first to connect your account.',
    });
    return;
  }

  // Find an x.com tab (create one only for alarm-triggered scans)
  const tabInfo = await findOrCreateXTab(fromAlarm);
  if (!tabInfo) {
    broadcastToPopup({
      type: MSG.SCAN_ERROR,
      error: 'no_tab',
      message: 'Please open x.com in a tab first.',
    });
    return;
  }

  activeScanTabId = tabInfo.tabId;
  autoCreatedTab = tabInfo.autoCreated;
  scanFollowers = [];

  // Save scan context
  const previousSnapshot = await getLatestSnapshot(userId);

  const scanRecordId = await addScanRecord({
    startedAt: Date.now(),
    completedAt: null,
    status: 'running',
    totalFollowers: 0,
    newFollowersCount: 0,
    unfollowersCount: 0,
    error: null,
    pagesScanned: 0,
  });

  await updateScanState({
    isScanning: true,
    progress: 0,
    currentPage: 0,
    totalFetched: 0,
    startedAt: Date.now(),
    scanRecordId,
    previousSnapshotId: previousSnapshot?.id || null,
    userId,
  });

  broadcastToPopup({
    type: MSG.SCAN_PROGRESS,
    progress: 0,
    fetched: 0,
    page: 0,
  });

  // Send scan command to page world via content script
  try {
    await chrome.tabs.sendMessage(activeScanTabId, {
      type: MSG.PAGE_START_SCAN,
      userId,
      queryId: authConfig.followersQueryId || null,
    });
  } catch (e) {
    await updateScanRecord(scanRecordId, {
      completedAt: Date.now(),
      status: 'failed',
      error: 'Failed to start scan: ' + e.message,
    });
    await updateScanState({ isScanning: false, progress: 0 });
    await cleanupTab();
    broadcastToPopup({
      type: MSG.SCAN_ERROR,
      error: 'Failed to communicate with x.com tab. Please refresh the page and try again.',
    });
  }
}

async function cleanupTab() {
  if (autoCreatedTab && activeScanTabId) {
    try {
      await chrome.tabs.remove(activeScanTabId);
    } catch { /* tab may already be closed */ }
  }
  activeScanTabId = null;
  autoCreatedTab = false;
}

// --- Scan Event Handlers (from page world) ---

async function handleScanBatch(message) {
  if (message.users && message.users.length > 0) {
    scanFollowers.push(...message.users);
    await upsertFollowersBatch(
      message.users.map((u) => ({ ...u, lastSeen: Date.now() }))
    );
  }
  return { ok: true };
}

async function handleScanPageDone(message) {
  const progress = message.hasMore
    ? Math.min(95, (message.fetched / (message.fetched + 100)) * 100)
    : 100;

  await updateScanState({
    progress,
    currentPage: message.page,
    totalFetched: message.fetched,
  });

  if (message.rateLimited) {
    broadcastToPopup({
      type: MSG.SCAN_PROGRESS,
      progress: -1,
      message: `Rate limited. Waiting ${Math.round(message.backoffMs / 1000)}s...`,
      fetched: message.fetched,
      page: message.page,
    });
  } else {
    broadcastToPopup({
      type: MSG.SCAN_PROGRESS,
      progress,
      fetched: message.fetched,
      page: message.page,
    });
  }
  return { ok: true };
}

async function handleScanFinished(message) {
  const scanState = await getScanState();
  const scanRecordId = scanState.scanRecordId;
  const userId = scanState.userId;

  if (message.cancelled) {
    if (scanRecordId) {
      await updateScanRecord(scanRecordId, {
        completedAt: Date.now(),
        status: 'cancelled',
        pagesScanned: message.totalPages,
        totalFollowers: message.totalUsers,
      });
    }
    await updateScanState({ isScanning: false, progress: 0 });
    await cleanupTab();
    broadcastToPopup({ type: MSG.SCAN_ERROR, error: 'cancelled' });
    scanFollowers = [];
    return { ok: true };
  }

  // Use allUsers from the finished message (complete data from page world)
  const allFollowers = message.allUsers || scanFollowers;

  try {
    // Build new snapshot
    const newSnapshot = computeSnapshotFromFollowers(userId, allFollowers);
    await addSnapshot(newSnapshot);

    // Get previous snapshot for diff
    const previousSnapshot = await getSecondLatestSnapshot(userId);

    let unfollowedIds = [];
    let newFollowerIds = [];
    const isFirstScan = !previousSnapshot;

    if (previousSnapshot) {
      const diff = diffSnapshots(previousSnapshot, newSnapshot);
      unfollowedIds = diff.unfollowedIds;
      newFollowerIds = diff.newFollowerIds;

      if (unfollowedIds.length > 0) {
        const unfollowerRecords = [];
        for (const uid of unfollowedIds) {
          const profile = await getFollower(uid);
          unfollowerRecords.push({
            userId: uid,
            screenName: profile?.screenName || 'unknown',
            displayName: profile?.displayName || 'Unknown User',
            avatarUrl: profile?.avatarUrl || '',
            isBlueVerified: profile?.isBlueVerified || false,
            detectedAt: Date.now(),
            snapshotId: newSnapshot.id,
          });
        }
        await addUnfollowers(unfollowerRecords);
      }

      if (unfollowedIds.length > 0) {
        await sendNotification(unfollowedIds.length);
      }
    }

    // Update scan record
    if (scanRecordId) {
      await updateScanRecord(scanRecordId, {
        completedAt: Date.now(),
        status: 'completed',
        totalFollowers: allFollowers.length,
        newFollowersCount: newFollowerIds.length,
        unfollowersCount: unfollowedIds.length,
        pagesScanned: message.totalPages,
      });
    }

    // Update last scan timestamp
    const settings = await getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...settings, lastScanTimestamp: Date.now() },
    });

    broadcastToPopup({
      type: MSG.SCAN_COMPLETE,
      totalFollowers: allFollowers.length,
      unfollowers: unfollowedIds.length,
      newFollowers: newFollowerIds.length,
      isFirstScan,
    });
  } catch (error) {
    console.error('[XUnfollowGhost] Scan processing failed:', error);
    if (scanRecordId) {
      await updateScanRecord(scanRecordId, {
        completedAt: Date.now(),
        status: 'failed',
        error: error.message,
        totalFollowers: allFollowers.length,
        pagesScanned: message.totalPages,
      });
    }
    broadcastToPopup({ type: MSG.SCAN_ERROR, error: error.message });
  } finally {
    await updateScanState({ isScanning: false, progress: 0 });
    await cleanupTab();
    scanFollowers = [];
  }

  return { ok: true };
}

async function handleScanPageError(message) {
  const scanState = await getScanState();
  const scanRecordId = scanState.scanRecordId;

  if (scanRecordId) {
    await updateScanRecord(scanRecordId, {
      completedAt: Date.now(),
      status: 'failed',
      error: message.error || message.message || 'Unknown scan error',
    });
  }

  await updateScanState({ isScanning: false, progress: 0 });
  await cleanupTab();
  scanFollowers = [];

  const errorMsg = message.message || message.error || 'Scan failed';
  broadcastToPopup({ type: MSG.SCAN_ERROR, error: errorMsg });
  return { ok: true };
}

// --- Notifications ---

async function sendNotification(count) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: 'XUnfollowGhost',
    message: `${count} user${count > 1 ? 's' : ''} unfollowed you!`,
    priority: 2,
  });
}

// --- CSV Export ---

async function generateCsvExport() {
  const unfollowers = await getUnfollowers({ limit: 10000 });
  let csv = 'Screen Name,Display Name,Blue Verified,Detected At\n';
  for (const u of unfollowers) {
    const date = new Date(u.detectedAt).toISOString();
    csv += `@${u.screenName},${u.displayName.replace(/,/g, ' ')},${u.isBlueVerified},${date}\n`;
  }
  return csv;
}

// --- Message Handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((e) => {
    sendResponse({ error: e.message });
  });
  return true; // async response
});

async function handleMessage(message) {
  switch (message.type) {
    case MSG.AUTH_CAPTURED:
      return handleAuthCaptured(message);

    case MSG.USER_IDENTIFIED:
      return handleUserIdentified(message);

    case MSG.START_SCAN: {
      runScan(); // Fire and forget
      return { started: true };
    }

    case MSG.CANCEL_SCAN: {
      // Forward cancel to page world via content script
      if (activeScanTabId) {
        try {
          await chrome.tabs.sendMessage(activeScanTabId, {
            type: MSG.PAGE_CANCEL_SCAN,
          });
        } catch { /* tab may be gone */ }
      }
      return { cancelled: true };
    }

    // Page world scan events
    case MSG.SCAN_BATCH:
      return handleScanBatch(message);

    case MSG.SCAN_PAGE_DONE:
      return handleScanPageDone(message);

    case MSG.SCAN_FINISHED:
      return handleScanFinished(message);

    case MSG.SCAN_PAGE_ERROR:
      return handleScanPageError(message);

    case MSG.GET_STATUS: {
      const scanState = await getScanState();
      const authConfig = await getAuthConfig();
      return {
        ...scanState,
        hasUserId: !!authConfig.userId,
        screenName: authConfig.screenName,
      };
    }

    case MSG.GET_UNFOLLOWERS: {
      const items = await getUnfollowers({
        limit: message.limit || 20,
        offset: message.offset || 0,
      });
      const totalCount = await getUnfollowerCount();
      return { items, totalCount };
    }

    case MSG.GET_SCAN_HISTORY: {
      return getScanHistory({
        limit: message.limit || 20,
        offset: message.offset || 0,
      });
    }

    case MSG.GET_STATS: {
      const authConfig = await getAuthConfig();
      const stats = await getStats(authConfig.userId);
      const settings = await getSettings();
      return {
        ...stats,
        lastScanTimestamp: settings.lastScanTimestamp,
      };
    }

    case MSG.UPDATE_SETTINGS: {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, ...message.settings };
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: newSettings,
      });
      await setupAlarm();
      return { success: true };
    }

    case MSG.GET_SETTINGS: {
      return getSettings();
    }

    case MSG.CLEAR_ALL_DATA: {
      await clearAllData();
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
        [STORAGE_KEYS.SCAN_STATE]: { isScanning: false, progress: 0 },
      });
      return { success: true };
    }

    case MSG.EXPORT_CSV: {
      return { csv: await generateCsvExport() };
    }

    default:
      return null;
  }
}

async function handleAuthCaptured(message) {
  const authConfig = await getAuthConfig();
  const updates = {};

  if (message.bearerToken) {
    updates.bearerToken = message.bearerToken;
  }
  if (message.queryId && message.operationName === 'Followers') {
    updates.followersQueryId = message.queryId;
  }
  if (message.csrfToken) {
    updates.csrfToken = message.csrfToken;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_CONFIG]: { ...authConfig, ...updates },
    });
  }

  return { success: true };
}

async function handleUserIdentified(message) {
  const authConfig = await getAuthConfig();
  const updates = {};

  if (message.userId) {
    updates.userId = message.userId;
  }
  if (message.screenName) {
    updates.screenName = message.screenName;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_CONFIG]: { ...authConfig, ...updates },
    });
  }

  return { success: true };
}
