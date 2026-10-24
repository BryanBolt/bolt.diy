// Service worker : le jeu complet est mis en cache à l'installation (liste générée au build) pour jouer hors ligne.
// Hors ligne : solo, local, entraînement, rediffusions locales. Le jeu en ligne et le classement demandent le serveur.
const BUILD = /*BUILD*/'dev';
const PRECACHE = /*PRECACHE*/['./'];
const CACHE = 'aif2-' + BUILD;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/ws') || url.pathname.startsWith('/api') || url.pathname === '/health' || url.pathname.startsWith('/ideas')) return;
  if (req.mode === 'navigate') {
    // page : réseau d'abord (nouvelle version), cache si hors ligne
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; }).catch(() => caches.match('./index.html').then((m) => m || caches.match('./'))));
    return;
  }
  // fichiers du jeu : cache d'abord (noms hachés), réseau en secours
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
});
