// 딩동 폰 보기: 화면 파일만 저장해 두어 인터넷이 없어도 열린다(데이터는 앱이 이 폰의 저장소에 따로 보관).
const CACHE = 'dd-app-v2';
const SHELL = ['./', 'index.html', 'app.js', 'view.js', 'ops.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 구글 로그인·드라이브 요청은 건드리지 않는다
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});
