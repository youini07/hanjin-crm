/**
 * 한진택배 스마트 송장 PWA 서비스 워커 (Network-First 전략)
 * 왜 Network-First인가:
 * 실시간 소켓·API 통신이 핵심인 업무용 CRM 특성상 오래된 캐시 때문에 구버전 JS가 고정되는 문제를 막고,
 * 온라인 시 항상 최신 배포본을 불러오되 오프라인/일시적 순단 시에만 정적 아이콘·셸 캐시를 보조로 사용함.
 */
const CACHE_NAME = 'hanjin-smart-crm-v1';
const STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // API 요청 및 Socket.IO 폴링 요청은 절대 서비스 워커가 가로채지 않음
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || caches.match('/'))
    )
  );
});
