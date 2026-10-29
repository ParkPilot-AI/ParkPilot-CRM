// ParkPilot CRM – service worker.
// Makes the portal installable as an app. It keeps a copy of the app's own files (styles,
// scripts, images) to fall back on, and shows a clear message when there's no signal. Lead data (/api/*) and sign-in (/auth/*) always go to the server
// and are never stored on the device.
const VERSION = 'parkpilot-crm-v1';
const SHELL = ['/', '/index.html', '/css/app.css', '/css/page.css', '/fonts/instrument-sans.woff2', '/fonts/montserrat-800.woff2', '/img/mark.png', '/img/favicon.png',
  '/js/app.js', '/js/core.js', '/js/dialogs.js', '/js/views/today.js', '/js/views/contacts.js', '/js/views/contact.js', '/js/views/diary.js',
  '/js/views/funnel.js', '/js/views/funnelchart.js', '/js/views/settings.js', '/js/views/duplicates.js',
  '/js/views/parts.js', '/js/views/importui.js', '/js/views/captain.js', '/offline.html', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/.netlify/')) return; // always live
  if (e.request.mode === 'navigate') {
    // Pages: the network first, so updates and sign-in redirects work; the saved copy if offline.
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
    return;
  }
  // App files: always the latest from the server (so an update is never half-applied), keeping a
  // copy to fall back on when there's no signal.
  e.respondWith(caches.open(VERSION).then(c => fetch(e.request)
    .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
    .catch(() => c.match(e.request))));
});
