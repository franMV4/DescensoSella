/* Service worker del Descenso del Sella.
 *
 * En los Picos y en el río no hay cobertura, así que:
 *   - la guía (shell) va cache-first  -> abre siempre, con o sin datos
 *   - los datos vivos van network-first -> si no hay red, sale lo último guardado
 *   - las teselas del mapa se guardan solo según se visitan (la política de uso
 *     de OpenStreetMap prohíbe descargarlas en bloque)
 *
 * Rutas relativas a propósito: así funciona igual en usuario.github.io que en
 * usuario.github.io/LoQueSea/ sin tocar nada.
 */
const V = 'sella-2026-v1';
const SHELL = V + '-shell';
const DATOS = V + '-datos';
const TILES = V + '-tiles';
const TOPE_TILES = 400;

const APP = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

const esDatos = u => /open-meteo\.com|minetur\.gob\.es|news\.google\.com|codetabs\.com|allorigins\.win|corsproxy\.io/.test(u);
const esTesela = u => /tile\.openstreetmap\.org/.test(u);
const esCDN = u => /unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u);
// opaque = respuesta sin CORS (teselas, fuentes): no se puede leer, pero sí guardar
const guardable = r => r && (r.ok || r.type === 'opaque');

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(APP);                                  // local: obligatorio
    await Promise.allSettled(CDN.map(u => c.add(u)));     // CDN: si falla, ya caerá al vuelo
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (!/^https?:/.test(url)) return;

  if (req.mode === 'navigate') return e.respondWith(redPrimero(req, SHELL, './index.html'));
  if (esDatos(url)) return e.respondWith(redPrimero(req, DATOS));
  if (esTesela(url)) return e.respondWith(cachePrimero(req, TILES, TOPE_TILES));
  if (esCDN(url)) return e.respondWith(cachePrimero(req, SHELL));
  if (new URL(url).origin === self.location.origin) return e.respondWith(cachePrimero(req, SHELL));
});

async function redPrimero(req, nombre, respaldo) {
  const c = await caches.open(nombre);
  try {
    const r = await fetch(req);
    if (guardable(r)) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = (await c.match(req)) || (respaldo && (await c.match(respaldo)));
    if (hit) return hit;
    throw err;
  }
}

async function cachePrimero(req, nombre, tope) {
  const c = await caches.open(nombre);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (guardable(r)) {
    c.put(req, r.clone());
    if (tope) recorta(c, tope);
  }
  return r;
}

// ponytail: FIFO a pelo. Con 400 teselas (~15 MB) sobra para la comarca;
// si algún día hiciera falta expirar por fecha, tocaría guardar timestamps.
async function recorta(c, tope) {
  const ks = await c.keys();
  for (const k of ks.slice(0, Math.max(0, ks.length - tope))) c.delete(k);
}
