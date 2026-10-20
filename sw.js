/*
 * オフラインでも開けるようにするための Service Worker。
 * 同じサイトのファイルは「ネットを優先、つながらなければ保存しておいたもの」。
 * こうしておけば、マージした新しい版はすぐ反映され、オフラインでも前回の版で起動できる。
 * Google Fonts は一度読んだら保存したものを使う。Gemini などの API には手を出さない。
 */
const CACHE = "daily-flash-v1";
const SHELL = [
  "./", "index.html", "css/style.css", "manifest.webmanifest",
  "js/storage.js", "js/scheduler.js", "js/ipa.js", "js/haptic.js", "js/swipe.js",
  "js/ai.js", "js/explain.js", "js/test.js", "js/summary.js", "js/home.js", "js/app.js",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
      )
    );
  }
});
