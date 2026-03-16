// SAFE Action Service Worker
const CACHE_NAME = 'safe-action-v84';
const ASSETS = [
    '/',
    '/index.html',
    '/outreach.html',
    '/tracker.html',
    '/directory.html',
    '/action.html',
    '/quiz.html',
    '/candidate.html',
    '/pledge.html',
    '/admin.html',
    '/feed.html',
    '/volunteer.html',
    '/nda.html',
    '/css/styles.css',
    '/js/config.js',
    '/js/sheets.js',
    '/js/quiz.js',
    '/js/legislation-api.js',
    '/js/intelligence.js',
    '/js/main.js',
    '/js/directory.js',
    '/js/my-reps.js',
    '/js/email-templates.js',
    '/js/my-reps-page.js',
    '/js/volunteer.js',
    '/js/nda.js',
    '/js/pwa.js',
    '/data/bills.json',
    '/data/legislators.json',
    '/data/seats.json'
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
