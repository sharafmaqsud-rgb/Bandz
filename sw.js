// The service worker: keeps a complete copy of the app on this device, so it opens with no
// connection. It holds app code only, never your data, which is in IndexedDB. Once installed
// it answers every request from that copy. It only ever handles this app's own files.

// BEGIN GENERATED
const VERSION = '0c9481ec18fdea21';
const FILES = [
  "./",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "manifest.webmanifest",
  "src/app.js",
  "src/core/analysis.js",
  "src/core/categorise.js",
  "src/core/crypto.js",
  "src/core/csv.js",
  "src/core/dates.js",
  "src/core/defaults.js",
  "src/core/highlights.js",
  "src/core/insights.js",
  "src/core/merchants.js",
  "src/core/merge.js",
  "src/core/model.js",
  "src/core/money.js",
  "src/core/palette.js",
  "src/core/pdf-statements.js",
  "src/core/pdf-text.js",
  "src/core/report-pdf.js",
  "src/core/report-xlsx.js",
  "src/core/review.js",
  "src/core/statements.js",
  "src/core/summary.js",
  "src/core/xlsx.js",
  "src/pwa.js",
  "src/store.js",
  "src/ui/accounts.js",
  "src/ui/chart.js",
  "src/ui/dom.js",
  "src/ui/goals.js",
  "src/ui/import.js",
  "src/ui/overview.js",
  "src/ui/reports.js",
  "src/ui/review.js",
  "src/ui/security.js",
  "src/ui/spending.js",
  "src/ui/styles.css",
  "src/ui/viz.js",
  "vendor/pdfjs/LICENSE",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs"
];
// END GENERATED

const CACHE = `finance-${VERSION}`;

self.addEventListener('install', (event) => {
  // All or nothing: if any file fails to download, this version does not install.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((n) => n.startsWith('finance-') && n !== CACHE).map((n) => caches.delete(n)),
  )).then(() => self.clients.claim()));
});

// A new version waits until you choose to update, so the app never changes under you.
self.addEventListener('message', (event) => {
  if (event.data === 'apply-update') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    if (event.request.mode === 'navigate') return cache.match('index.html');
    return new Response('', { status: 404 }); // nothing outside the app's own copy is served
  }));
});
