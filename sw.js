// SAFE Action Service Worker
const CACHE_NAME = 'safe-action-v6';
const ASSETS = [
    '/',
    '/index.html',
    '/tracker.html',
    '/directory.html',
    '/outreach.html',
    '/action.html',
    '/updates.html',
    '/quiz.html',
    '/candidate.html',
    '/intelligence.html',
    '/pledge.html',
    '/css/styles.css',
    '/js/config.js',
    '/js/sheets.js',
    '/js/legislation-api.js',
    '/js/intelligence.js',
    '/js/intelligence-page.js',
    '/js/main.js',
    '/js/tracker.js',
    '/js/directory.js',
    '/js/outreach.js',
    '/js/updates.js'
];

// Install: cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network first, fall back to cache
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
