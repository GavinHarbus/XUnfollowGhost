import { DB_NAME, DB_VERSION } from './constants.js';

let dbInstance = null;

export async function openDB() {
  if (dbInstance) {
    try {
      dbInstance.transaction('scanHistory', 'readonly');
      return dbInstance;
    } catch {
      dbInstance = null;
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // Clean slate or migration from v1
      if (oldVersion < 2) {
        // Delete old stores if they exist (v1 used userId-based keys)
        for (const name of ['snapshots', 'followers', 'unfollowers', 'scanHistory']) {
          if (db.objectStoreNames.contains(name)) {
            db.deleteObjectStore(name);
          }
        }

        // Snapshots: keyed by auto-increment id, indexed by ownerScreenName
        const snapshots = db.createObjectStore('snapshots', {
          keyPath: 'id',
          autoIncrement: true,
        });
        snapshots.createIndex('timestamp', 'timestamp');
        snapshots.createIndex('ownerScreenName', 'ownerScreenName');

        // Followers: keyed by screenName
        const followers = db.createObjectStore('followers', {
          keyPath: 'screenName',
        });
        followers.createIndex('lastSeen', 'lastSeen');

        // Unfollowers: auto-increment, indexed by detectedAt and screenName
        const unfollowers = db.createObjectStore('unfollowers', {
          keyPath: 'id',
          autoIncrement: true,
        });
        unfollowers.createIndex('detectedAt', 'detectedAt');
        unfollowers.createIndex('screenName', 'screenName');

        // Scan history
        const scanHistory = db.createObjectStore('scanHistory', {
          keyPath: 'id',
          autoIncrement: true,
        });
        scanHistory.createIndex('startedAt', 'startedAt');
        scanHistory.createIndex('status', 'status');
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB open failed: ${event.target.error}`));
    };
  });
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// --- Snapshots ---

export async function addSnapshot(snapshot) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readwrite');
  const store = tx.objectStore('snapshots');
  const id = await promisifyRequest(store.add(snapshot));
  await promisifyTransaction(tx);
  return id;
}

export async function getLatestSnapshot(ownerScreenName) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readonly');
  const store = tx.objectStore('snapshots');
  const index = store.index('ownerScreenName');

  return new Promise((resolve, reject) => {
    const results = [];
    const range = IDBKeyRange.only(ownerScreenName);
    const request = index.openCursor(range, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && results.length < 1) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results[0] || null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getSecondLatestSnapshot(ownerScreenName) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readonly');
  const store = tx.objectStore('snapshots');
  const index = store.index('ownerScreenName');

  return new Promise((resolve, reject) => {
    const results = [];
    const range = IDBKeyRange.only(ownerScreenName);
    const request = index.openCursor(range, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && results.length < 2) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results[1] || null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// --- Followers ---

export async function upsertFollowersBatch(records) {
  const db = await openDB();
  const tx = db.transaction('followers', 'readwrite');
  const store = tx.objectStore('followers');

  for (const record of records) {
    // Normalize key to lowercase to match diff-engine output
    const key = record.screenName.toLowerCase();
    const existing = await promisifyRequest(store.get(key));
    const merged = existing
      ? { ...existing, ...record, screenName: key, firstSeen: existing.firstSeen }
      : { ...record, screenName: key, firstSeen: record.firstSeen || Date.now() };
    store.put(merged);
  }

  await promisifyTransaction(tx);
}

export async function getFollower(screenName) {
  const db = await openDB();
  const tx = db.transaction('followers', 'readonly');
  const store = tx.objectStore('followers');
  return promisifyRequest(store.get(screenName));
}

// --- Unfollowers ---

export async function addUnfollowers(records) {
  const db = await openDB();
  const tx = db.transaction('unfollowers', 'readwrite');
  const store = tx.objectStore('unfollowers');
  for (const record of records) {
    store.add(record);
  }
  await promisifyTransaction(tx);
}

export async function getUnfollowers({ limit = 20, offset = 0 } = {}) {
  const db = await openDB();
  const tx = db.transaction('unfollowers', 'readonly');
  const store = tx.objectStore('unfollowers');
  const index = store.index('detectedAt');

  return new Promise((resolve, reject) => {
    const results = [];
    let skipped = 0;
    const request = index.openCursor(null, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      if (skipped < offset) {
        skipped++;
        cursor.continue();
      } else {
        results.push(cursor.value);
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getUnfollowerCount() {
  const db = await openDB();
  const tx = db.transaction('unfollowers', 'readonly');
  const store = tx.objectStore('unfollowers');
  return promisifyRequest(store.count());
}

export async function removeUnfollowersByScreenName(screenNames) {
  if (!screenNames || screenNames.length === 0) return;
  const nameSet = new Set(screenNames.map((n) => n.toLowerCase()));
  const db = await openDB();
  const tx = db.transaction('unfollowers', 'readwrite');
  const store = tx.objectStore('unfollowers');

  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) { resolve(); return; }
      if (nameSet.has((cursor.value.screenName || '').toLowerCase())) {
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
  });
}

// --- Scan History ---

export async function addScanRecord(record) {
  const db = await openDB();
  const tx = db.transaction('scanHistory', 'readwrite');
  const store = tx.objectStore('scanHistory');
  const id = await promisifyRequest(store.add(record));
  await promisifyTransaction(tx);
  return id;
}

export async function updateScanRecord(id, updates) {
  const db = await openDB();
  const tx = db.transaction('scanHistory', 'readwrite');
  const store = tx.objectStore('scanHistory');
  const existing = await promisifyRequest(store.get(id));
  if (existing) {
    await promisifyRequest(store.put({ ...existing, ...updates }));
  }
  await promisifyTransaction(tx);
}

export async function getScanHistory({ limit = 20, offset = 0 } = {}) {
  const db = await openDB();
  const tx = db.transaction('scanHistory', 'readonly');
  const store = tx.objectStore('scanHistory');
  const index = store.index('startedAt');

  return new Promise((resolve, reject) => {
    const results = [];
    let skipped = 0;
    const request = index.openCursor(null, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      if (skipped < offset) {
        skipped++;
        cursor.continue();
      } else {
        results.push(cursor.value);
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getScanCount() {
  const db = await openDB();
  const tx = db.transaction('scanHistory', 'readonly');
  const store = tx.objectStore('scanHistory');
  return promisifyRequest(store.count());
}

// --- Stats ---

export async function getStats(ownerScreenName) {
  const latestSnapshot = ownerScreenName ? await getLatestSnapshot(ownerScreenName) : null;
  const totalUnfollowers = await getUnfollowerCount();
  const totalScans = await getScanCount();

  return {
    totalFollowers: latestSnapshot ? latestSnapshot.followerCount : 0,
    totalUnfollowers,
    totalScans,
    lastSnapshotTimestamp: latestSnapshot ? latestSnapshot.timestamp : null,
  };
}

// --- Clear all ---

export async function clearAllData() {
  const db = await openDB();
  const storeNames = ['snapshots', 'followers', 'unfollowers', 'scanHistory'];
  const tx = db.transaction(storeNames, 'readwrite');
  for (const name of storeNames) {
    tx.objectStore(name).clear();
  }
  await promisifyTransaction(tx);
}
