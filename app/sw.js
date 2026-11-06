/* أهل الأثر: cache only the local app shell and static files.
   Authenticated/API and third-party responses are deliberately never cached. */
'use strict';

var CACHE_NAME = 'ahl-athar-v17';
var APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.svg',
  './icon-512.svg',
  './tailwind.css',
  './app.js',
  './community.js',
  './auth-client.js',
  './supabase-config.js',
  './runtime-config.js',
  './vendor/adhan.umd.min.js',
  './vendor/ADHAN-LICENSE.txt',
  './vendor/SUPABASE-LICENSE.txt'
];
var STATIC_FILE = /\.(?:css|js|mjs|json|svg|png|jpe?g|webp|ico|woff2?|ttf|eot)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys
      .filter(function (key) {
        return key.indexOf('ahl-athar-') === 0 && key !== CACHE_NAME;
      })
      .map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET' ||
      request.headers.has('authorization') ||
      request.headers.has('range') ||
      request.cache === 'no-store') {
    return;
  }

  var url = new URL(request.url);
  var appScope = new URL(self.registration.scope);

  // Never intercept third-party requests or URLs outside this app's scope.
  if (url.origin !== self.location.origin ||
      url.pathname.indexOf(appScope.pathname) !== 0) {
    return;
  }

  // API responses can contain private or rapidly changing user data.
  if (url.pathname.indexOf('/api/') !== -1 || /\/api$/.test(url.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE_NAME);
      var shellUrl = new URL('index.html', appScope).href;
      try {
        var response = await fetch(request);
        if (response.ok && response.status === 200 && response.type === 'basic') {
          await cache.put(shellUrl, response.clone());
        }
        return response;
      } catch (error) {
        return (await cache.match(shellUrl)) || new Response(
          'لا يوجد اتصال بالإنترنت. اتصل بالشبكة ثم أعد المحاولة.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Cache-first is limited to local static assets with no query-string tokens.
  if (!STATIC_FILE.test(url.pathname) || url.search) {
    return;
  }

  event.respondWith((async function () {
    var cache = await caches.open(CACHE_NAME);
    var cached = await cache.match(request);
    if (cached) return cached;

    var response = await fetch(request);
    if (response.ok && response.status === 200 && response.type === 'basic') {
      await cache.put(request, response.clone()).catch(function () {});
    }
    return response;
  })());
});
