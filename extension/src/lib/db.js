import { DB_NAME, DB_VERSION } from './constants.js';

let dbInstance = null;

export async function openDB() {
  if (dbInstance) {
    try {
      // Test if connection is still alive
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

      if (!db.objectStoreNames.contains('snapshots')) {
        const snapshots = db.createObjectStore('snapshots', {
          keyPath: 'id',
          autoIncrement: true,
        });
        snapshots.createIndex('timestamp', 'timestamp');
        snapshots.createIndex('userId', 'userId');
      }

      if (!db.objectStoreNames.contains('followers')) {
        const followers = db.createObjectStore('followers', {
          keyPath: 'userId',
        });
        followers.createIndex('screenName', 'screenName');
        followers.createIndex('lastSeen', 'lastSeen');
      }

      if (!db.objectStoreNames.contains('unfollowers')) {
        const unfollowers = db.createObjectStore('unfollowers', {
          keyPath: 'id',
          autoIncrement: true,
        });
        unfollowers.createIndex('detectedAt', 'detectedAt');
        unfollowers.createIndex('userId', 'userId');
      }

      if (!db.objectStoreNames.contains('scanHistory')) {
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

export async function getLatestSnapshot(userId) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readonly');
  const store = tx.objectStore('snapshots');
  const index = store.index('userId');

  return new Promise((resolve, reject) => {
    const results = [];
    const range = IDBKeyRange.only(userId);
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

export async function getSecondLatestSnapshot(userId) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readonly');
  const store = tx.objectStore('snapshots');
  const index = store.index('userId');

  return new Promise((resolve, reject) => {
    const results = [];
    const range = IDBKeyRange.only(userId);
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

export async function upsertFollower(record) {
  const db = await openDB();
  const tx = db.transaction('followers', 'readwrite');
  const store = tx.objectStore('followers');
  // Merge with existing record to preserve firstSeen
  const existing = await promisifyRequest(store.get(record.userId));
  const merged = existing
    ? { ...existing, ...record, firstSeen: existing.firstSeen }
    : { ...record, firstSeen: record.firstSeen || Date.now() };
  await promisifyRequest(store.put(merged));
  await promisifyTransaction(tx);
}

export async function upsertFollowersBatch(records) {
  const db = await openDB();
  const tx = db.transaction('followers', 'readwrite');
  const store = tx.objectStore('followers');

  for (const record of records) {
    const existing = await promisifyRequest(store.get(record.userId));
    const merged = existing
      ? { ...existing, ...record, firstSeen: existing.firstSeen }
      : { ...record, firstSeen: record.firstSeen || Date.now() };
    store.put(merged);
  }

  await promisifyTransaction(tx);
}

export async function getFollower(userId) {
  const db = await openDB();
  const tx = db.transaction('followers', 'readonly');
  const store = tx.objectStore('followers');
  return promisifyRequest(store.get(userId));
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

export async function getStats(userId) {
  const latestSnapshot = userId ? await getLatestSnapshot(userId) : null;
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
