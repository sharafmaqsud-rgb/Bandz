// Saves the whole data object in this browser's private storage, IndexedDB. Nothing here
// touches the network. Passphrase encryption wraps this in Phase 4.
const DB_NAME = 'finance';
const STORE = 'snapshots';
const KEY = 'state';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, action) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export const loadState = () => run('readonly', (s) => s.get(KEY));
export const saveState = (state) => run('readwrite', (s) => s.put(state, KEY));
export const clearState = () => run('readwrite', (s) => s.delete(KEY));
