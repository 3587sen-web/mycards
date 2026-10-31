// Service worker：讓 App 離線也能開、辨識模型只下載一次
const VERSION = "2ebd029abb";
const SHELL_CACHE = "mycards-shell-" + VERSION;
const BIG_CACHE = "mycards-big-v1"; // 模型、wasm 等大檔，跨版本保留，避免每次更新都重新下載 40 MB
const SHELL = ["./","assets/ai-A5YHFLOO.js","assets/app.js","assets/backup-KMUOC7RA.js","assets/chunk-2D6I5VM7.js","assets/chunk-FOKWMY3J.js","assets/chunk-ZWRDP37E.js","assets/ort.wasm.bundle.min-4BBX6W6S.js","assets/styles.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","manifest.webmanifest"];
const BIG = ["assets/ocr-CZAOBOXP.js","models/PP-OCRv5_mobile_det.tar","models/PP-OCRv5_mobile_rec.tar","ort/ort-wasm-simd-threaded.mjs","ort/ort-wasm-simd-threaded.wasm"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("mycards-shell-") && k !== SHELL_CACHE) await caches.delete(k);
    }
    // 清掉舊版本留下、現在已用不到的大檔
    const big = await caches.open(BIG_CACHE);
    const keep = new Set(BIG.map((p) => new URL(p, self.registration.scope).href));
    for (const req of await big.keys()) if (!keep.has(req.url)) await big.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 頁面導覽：一律回傳 App 外殼
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./", { cacheName: SHELL_CACHE }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(SHELL.some((p) => new URL(p, self.registration.scope).href === url.href) ? SHELL_CACHE : BIG_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
