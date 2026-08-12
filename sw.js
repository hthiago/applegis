// Service worker: guarda a casca do aplicativo para abrir rápido e sobreviver a
// uma queda de rede. Os dados do gabinete nunca são cacheados — eles vêm sempre
// do Firestore, que já tem cache próprio e controle de permissão.

const VERSAO = 'gabinete-v5';
const CASCA = [
  './',
  './index.html',
  './app.css',
  './manifest.json',
  './js/app.js',
  './js/config.js',
  './js/firebase.js',
  './js/sessao.js',
  './js/dados.js',
  './js/modulos.js',
  './js/crud.js',
  './js/paineis.js',
  './js/admin.js',
  './js/camara.js',
  './js/minuta.js',
  './js/cachelocal.js',
  './js/votos.js',
  './js/temas.js',
  './js/planilha.js',
  './js/emendas.js',
  './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Rede primeiro para manter o aplicativo atualizado; o cache entra quando ela falha.
  e.respondWith(
    fetch(e.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia)).catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
