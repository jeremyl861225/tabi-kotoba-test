// Ferðaorð service worker
// 同一個 github.io origin 上還有別的 PWA：只刪自己的舊快取、只攔自己子路徑的請求。
const CACHE_VERSION = 'ferdaord-v1';
const AUDIO_CACHE = 'ferdaord-audio'; // 不帶版本號：改版不清掉已下載的發音
const CORE = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/letters.js',
  'js/splash.js',
  'js/sky.js',
  'js/tabbar.js',
  'js/store.js',
  'js/audio.js',
  'js/ruby.js',
  'js/quiz.js',
  'js/dict.js',
  'data/dict.json',
  'data/cards.json',
  'fonts/zenold-500.woff2',
  'fonts/zenold-900.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const SCOPE_PATH = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ferdaord-v') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Safari 播放音檔會送 Range 請求，快取裡是完整檔，要切成 206 回應才播得出來
async function sliceForRange(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  const buf = await response.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); }
    else {
      start = Number(m[1] || 0);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
  }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function audioFetch(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const url = request.url.split('#')[0];
  let res = await cache.match(url);
  if (!res) {
    const net = await fetch(url);
    if (!net.ok) return net;
    await cache.put(url, net.clone());
    res = net;
  }
  return sliceForRange(request, res);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  let fresh;
  try { fresh = new Request(request, { cache: 'reload' }); } catch (e) { fresh = request; }
  const network = fetch(fresh)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const res = await network;
  if (res) return res;
  if (request.mode === 'navigate') return cache.match('index.html');
  return new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (url.pathname.startsWith(SCOPE_PATH + 'audio/')) {
    event.respondWith(audioFetch(req).catch(() => new Response('', { status: 504 })));
    return;
  }
  if (req.mode === 'navigate') {
    // 只有 App 本身（根目錄、index.html）回 App 殼；其他子頁（例如聲音試聽頁 voices/）照常上網抓，不能被攔成 App 首頁
    if (url.pathname !== SCOPE_PATH && url.pathname !== SCOPE_PATH + 'index.html') return;
    event.respondWith(
      caches.open(CACHE_VERSION)
        .then((c) => c.match('index.html'))
        .then((cached) => {
          const net = fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put('index.html', copy));
            }
            return res;
          }).catch(() => cached);
          return cached || net;
        })
    );
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
