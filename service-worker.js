/**
 * Service Worker — Arcade Collection Alpha
 * Estratégia: Cache First para arquivos essenciais, rede com fallback para o restante.
 * Compatível com subdiretórios do GitHub Pages (usando self.registration.scope).
 */

const CACHE_NAME = 'arcade-collection-v1';
const OFFLINE_URL = './index.html';

// Arquivos essenciais para funcionamento offline (caminhos relativos ao escopo do SW)
const ESSENTIAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles/main.css',
  './src/app/main.js',
  './src/core/database.js',
  './src/core/wallet.js',
  './src/core/transactions.js',
  './src/core/backup.js',
  './src/app/router.js',
  './vendor/matter.min.js'
];

// Instalação: coloca os essenciais em cache
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ESSENTIAL_ASSETS).catch((err) => {
        console.warn('[SW] Falha ao cachear alguns assets essenciais:', err);
      });
    })
  );
});

// Ativação: remove caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Cache First para essenciais, rede primeiro para o restante com fallback offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET
  if (request.method !== 'GET') {
    return;
  }

  // Ignora chrome-extension, etc.
  if (!url.protocol.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        // Só cacheia respostas bem-sucedidas do mesmo escopo/origem
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Fallback offline para navegações
        if (request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
