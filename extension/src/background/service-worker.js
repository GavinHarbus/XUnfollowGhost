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
  STORAGE_KEYS,
} from '../lib/constants.js';
import { MSG } from '../lib/messages.js';

// --- State ---

let scanFollowers = [];
let activeScanTabId = null;

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
    });
    await openDB();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { scanState } = await chrome.storage.local.get(STORAGE_KEYS.SCAN_STATE);
  if (scanState?.isScanning) {
    await updateScanState({ isScanning: false, progress: 0 });
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

async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return settings || DEFAULT_SETTINGS;
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// --- Find x.com tab ---

async function findXTab() {
  const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
  if (tabs.length > 0) {
    return tabs[0].id;
  }
  return null;
}

// --- Core Scan ---

async function runScan() {
  const state = await getScanState();
  if (state.isScanning) return;

  const tabId = await findXTab();
  if (!tabId) {
    broadcastToPopup({
      type: MSG.SCAN_ERROR,
      error: 'no_tab',
      message: 'Please open x.com in a tab first.',
    });
    return;
  }

  activeScanTabId = tabId;
  scanFollowers = [];

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
    });
  } catch (e) {
    await updateScanRecord(scanRecordId, {
      completedAt: Date.now(),
      status: 'failed',
      error: 'Failed to start scan: ' + e.message,
    });
    await updateScanState({ isScanning: false, progress: 0 });
    activeScanTabId = null;
    broadcastToPopup({
      type: MSG.SCAN_ERROR,
      error: 'Failed to communicate with x.com tab. Please refresh the page and try again.',
    });
  }
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

  broadcastToPopup({
    type: MSG.SCAN_PROGRESS,
    progress,
    fetched: message.fetched,
    page: message.page,
  });

  return { ok: true };
}

async function handleScanFinished(message) {
  const scanState = await getScanState();
  const scanRecordId = scanState.scanRecordId;
  const ownerScreenName = message.ownerScreenName;

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
    activeScanTabId = null;
    broadcastToPopup({ type: MSG.SCAN_ERROR, error: 'cancelled' });
    scanFollowers = [];
    return { ok: true };
  }

  const allFollowers = message.allUsers || scanFollowers;

  try {
    // Store ownerScreenName for future stats lookups
    const settings = await getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: {
        ...settings,
        lastScanTimestamp: Date.now(),
        ownerScreenName,
      },
    });

    // Build new snapshot
    const newSnapshot = computeSnapshotFromFollowers(ownerScreenName, allFollowers);
    await addSnapshot(newSnapshot);

    // Get previous snapshot for diff
    const previousSnapshot = await getSecondLatestSnapshot(ownerScreenName);

    let unfollowedScreenNames = [];
    let newFollowerScreenNames = [];
    const isFirstScan = !previousSnapshot;

    if (previousSnapshot) {
      const diff = diffSnapshots(previousSnapshot, newSnapshot);
      unfollowedScreenNames = diff.unfollowedScreenNames;
      newFollowerScreenNames = diff.newFollowerScreenNames;

      if (unfollowedScreenNames.length > 0) {
        const unfollowerRecords = [];
        for (const sn of unfollowedScreenNames) {
          const profile = await getFollower(sn);
          unfollowerRecords.push({
            screenName: sn,
            displayName: profile?.displayName || sn,
            avatarUrl: profile?.avatarUrl || '',
            isBlueVerified: profile?.isBlueVerified || false,
            detectedAt: Date.now(),
          });
        }
        await addUnfollowers(unfollowerRecords);
      }
    }

    // Update scan record
    if (scanRecordId) {
      await updateScanRecord(scanRecordId, {
        completedAt: Date.now(),
        status: 'completed',
        totalFollowers: allFollowers.length,
        newFollowersCount: newFollowerScreenNames.length,
        unfollowersCount: unfollowedScreenNames.length,
        pagesScanned: message.totalPages,
      });
    }

    broadcastToPopup({
      type: MSG.SCAN_COMPLETE,
      totalFollowers: allFollowers.length,
      unfollowers: unfollowedScreenNames.length,
      newFollowers: newFollowerScreenNames.length,
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
    activeScanTabId = null;
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
  activeScanTabId = null;
  scanFollowers = [];

  const errorMsg = message.message || message.error || 'Scan failed';
  broadcastToPopup({ type: MSG.SCAN_ERROR, error: errorMsg });
  return { ok: true };
}

// --- CSV Export ---

async function generateCsvExport() {
  const unfollowers = await getUnfollowers({ limit: 10000 });
  let csv = 'Screen Name,Display Name,Blue Verified,Detected At\n';
  for (const u of unfollowers) {
    const date = new Date(u.detectedAt).toISOString();
    csv += `@${u.screenName},${(u.displayName || '').replace(/,/g, ' ')},${u.isBlueVerified},${date}\n`;
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
    case MSG.START_SCAN: {
      runScan();
      return { started: true };
    }

    case MSG.CANCEL_SCAN: {
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
      const settings = await getSettings();
      return {
        ...scanState,
        hasScreenName: !!settings.ownerScreenName,
        screenName: settings.ownerScreenName,
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
      const settings = await getSettings();
      const stats = await getStats(settings.ownerScreenName);
      return {
        ...stats,
        lastScanTimestamp: settings.lastScanTimestamp,
      };
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
