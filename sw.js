/* Service worker: abre offline, acelera as visitas seguintes e trata cliques nas notificações. */
const V = "af-v16";
const SHELL = ["./", "index.html", "css/style.css", "css/temas.css", "css/design.css", "js/app.js", "js/ui.js", "js/simulado.js", "js/lembretes.js", "js/pwa.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "apple-touch-icon.png"];
const EXT = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "www.gstatic.com"]; // fontes, PDF.js e Firebase SDK

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== V + "-ext").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (r.mode === "navigate") { // páginas: rede primeiro, cache se estiver offline
      e.respondWith(fetch(r).then((x) => { const c = x.clone(); caches.open(V).then((ca) => ca.put("index.html", c)); return x; }).catch(() => caches.match("index.html")));
      return;
    }
    e.respondWith(caches.open(V).then((ca) => ca.match(r).then((hit) => { // arquivos: cache já, atualiza ao fundo
      const net = fetch(r).then((x) => { if (x.ok) ca.put(r, x.clone()); return x; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (EXT.includes(u.hostname)) { // bibliotecas e fontes: cache primeiro
    e.respondWith(caches.open(V + "-ext").then((ca) => ca.match(r).then((hit) => hit || fetch(r).then((x) => { if (x.ok || x.type === "opaque") ca.put(r, x.clone()); return x; }))));
  }
  // dados (Firestore, login) passam direto pela rede
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.url) || "./#revisao";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ("focus" in c) { c.postMessage({ ir: alvo }); return c.focus(); } }
    return self.clients.openWindow(alvo);
  }));
});
