/* =====================================================================
 * sw.js — Dra. Dayane Vieira · Crias + Infância
 * Service Worker (cache-first inteligente)
 * ---------------------------------------------------------------------
 * Estratégia híbrida por tipo de recurso:
 *   1. Navegação / HTML (index.html) → NETWORK-FIRST com timeout 3s
 *   2. Assets estáticos (icons, manifest, fontes, CSS, JS internos) → CACHE-FIRST
 *   3. Apps Script (dados do bebê)   → NEVER-CACHE (sempre atual)
 *   4. Default                       → NETWORK-FIRST timeout 5s
 * ===================================================================== */

'use strict';

const CACHE_VERSION = 'v1';
const CACHE_STATIC  = `acompanha-bebe-static-${CACHE_VERSION}`;
const CACHE_RUNTIME = `acompanha-bebe-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './perfil.jpg'
];

// Apps Script nunca deve ser interceptado pelo SW — dados do bebê sempre em tempo real
const NEVER_CACHE_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install falhou:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const respondWithCache = () => caches.match(request).then(cached => {
      resolve(cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; respondWithCache(); } }, timeoutMs);
    fetch(request).then(response => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
        const clone = response.clone();
        caches.open(CACHE_RUNTIME).then(c => c.put(request, clone));
      }
      resolve(response);
    }).catch(() => { if (!settled) { settled = true; clearTimeout(timer); respondWithCache(); } });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
        const clone = response.clone();
        caches.open(CACHE_RUNTIME).then(c => c.put(request, clone));
      }
      return response;
    }).catch(() => new Response('', { status: 504 }));
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NEVER_CACHE_HOSTS.some(h => url.hostname.includes(h))) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, 3000));
    return;
  }
  if (['style', 'script', 'image', 'font', 'manifest'].includes(req.destination)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req, 5000));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
