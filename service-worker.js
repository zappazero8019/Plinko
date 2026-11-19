/**
 * Service Worker — Memory Quest Alpha
 * Estratégia: Cache First para arquivos essenciais, rede com fallback para o restante.
 * Compatível com subdiretórios do GitHub Pages (usando self.registration.scope).
 */

const CACHE_NAME = 'memory-quest-v21';
const OFFLINE_URL = './index.html';

// Arquivos essenciais para funcionamento offline (caminhos relativos ao escopo do SW)
const ESSENTIAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-72.png',
  './assets/icons/icon-96.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-144.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-72-maskable.png',
  './assets/icons/icon-96-maskable.png',
  './assets/icons/icon-128-maskable.png',
  './assets/icons/icon-144-maskable.png',
  './assets/icons/icon-152-maskable.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-384-maskable.png',
  './assets/icons/icon-512-maskable.png',
  // Ícone original da habilidade Visão total (arquivo existente, não copiado).
  './assets/icons/visao.png',
  './styles/main.css',
  './src/app/main.js',
  './src/core/database.js',
  './src/core/migrations.js',
  './src/core/wallet.js',
  './src/core/transactions.js',
  './src/core/backup.js',
  './src/core/game-stats.js',
  './src/core/stats-insights.js',
  './src/core/settings.js',
  './src/core/profile.js',
  './src/core/selfies.js',
  './src/core/mq-economy.js',
  './src/core/mq-shop.js',
  './src/core/mq-habilidade.js',
  './src/app/router.js',
  './src/ui/components.js',
  './src/ui/panels.js',
  './src/ui/charts.js',
  './src/ui/profile.js',
  './src/ui/shop.js',
  './src/games/cards/index.js',
  './src/games/cards/recompensas.js',
  './src/games/cards/previa.js',
  './src/games/cards/board.js',
  './src/games/cards/visao-total.js',
  './src/games/cards/cards-data.js',
  './src/games/cards/expanded.js',
  './src/games/cards/renderer.js',
  './src/games/cards/difficulty.js',
  './src/games/cards/tentativas.js',
  './src/games/cards/styles.css',
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
