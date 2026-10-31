// 手機端資料庫（IndexedDB）：資料只存在這支 iPhone 的瀏覽器裡
// stores:
//   cards  - 名片欄位
//   images - 名片照片（Blob），和名片分開存，列表載入比較快
//   meta   - 設定值（分組清單、上次備份時間、OpenCode 設定…）

const DB_NAME = "mycards";
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")) {
        const s = db.createObjectStore("cards", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("交易中止"));
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function getAllCards() {
  return tx(["cards"], "readonly", (t) => req2p(t.objectStore("cards").getAll()));
}

export async function getCard(id) {
  return tx(["cards"], "readonly", (t) => req2p(t.objectStore("cards").get(id)));
}

export async function putCard(card) {
  card.updatedAt = Date.now();
  if (!card.createdAt) card.createdAt = card.updatedAt;
  await tx(["cards"], "readwrite", (t) => { t.objectStore("cards").put(card); });
  return card;
}

// 原樣寫入（還原備份用，不改動建立/修改時間）
export async function putCardRaw(card) {
  if (!card.createdAt) card.createdAt = Date.now();
  if (!card.updatedAt) card.updatedAt = card.createdAt;
  await tx(["cards"], "readwrite", (t) => { t.objectStore("cards").put(card); });
  return card;
}

export async function deleteCard(card) {
  await tx(["cards", "images"], "readwrite", (t) => {
    t.objectStore("cards").delete(card.id);
    for (const imgId of [card.frontImageId, card.backImageId, card.thumbId]) {
      if (imgId) t.objectStore("images").delete(imgId);
    }
  });
}

export async function putImage(blob, id = uid()) {
  await tx(["images"], "readwrite", (t) => { t.objectStore("images").put({ id, blob }); });
  return id;
}

export async function getImage(id) {
  if (!id) return null;
  const r = await tx(["images"], "readonly", (t) => req2p(t.objectStore("images").get(id)));
  return r ? r.blob : null;
}

export async function deleteImage(id) {
  if (!id) return;
  await tx(["images"], "readwrite", (t) => { t.objectStore("images").delete(id); });
}

export async function getMeta(key, fallback = null) {
  const r = await tx(["meta"], "readonly", (t) => req2p(t.objectStore("meta").get(key)));
  return r ? r.value : fallback;
}

export async function setMeta(key, value) {
  await tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ key, value }); });
}

export async function getAllMeta() {
  return tx(["meta"], "readonly", (t) => req2p(t.objectStore("meta").getAll()));
}

export async function getAllImageIds() {
  return tx(["images"], "readonly", (t) => req2p(t.objectStore("images").getAllKeys()));
}

// 請瀏覽器把資料標成「重要、不要自動清掉」
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* 不支援就算了 */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}
