const path = require("path");
const express = require("express");
const scraper = require("./scraper");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Cache in-memory (TTL 10 menit, max 300 entri, key ternormalisasi) ----------

const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();
const ALLOWED_QUERY = new Set(["tipe", "orderby", "q", "page"]);

function cacheKey(req) {
  const qm = req.originalUrl.indexOf("?");
  if (qm === -1) return `GET ${req.path}`;
  const params = new URLSearchParams(req.originalUrl.slice(qm + 1));
  const clean = new URLSearchParams();
  [...params.keys()].sort().forEach((k) => {
    if (ALLOWED_QUERY.has(k)) clean.set(k, params.get(k));
  });
  const s = clean.toString();
  return `GET ${req.path}${s ? `?${s}` : ""}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { t: Date.now(), data });
}

// ---------- Rate-limit sederhana (60 req/menit per IP untuk /api) ----------

const RL_WINDOW = 60 * 1000;
const RL_MAX = 60;
const rl = new Map();

function rateLimit(req, res, next) {
  if (!(req.path === "/api" || req.path.startsWith("/api/"))) return next();
  const ip = req.ip || req.socket.remoteAddress || "?";
  const now = Date.now();
  let st = rl.get(ip);
  if (!st || now > st.reset) st = { count: 0, reset: now + RL_WINDOW };
  st.count += 1;
  rl.set(ip, st);
  if (st.count > RL_MAX) {
    res.set("Retry-After", Math.ceil((st.reset - now) / 1000));
    return res.status(429).json({ status: false, message: "Terlalu banyak permintaan, coba lagi sebentar." });
  }
  next();
}

app.use(rateLimit);

// ---------- Wrapper handler scraper ----------

function wrap(fn) {
  return async (req, res) => {
    const key = cacheKey(req);
    try {
      const cached = cacheGet(key);
      if (cached) return res.json(cached);
      const data = await fn(req);
      cacheSet(key, data);
      res.json(data);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ${key}:`, err.message);
      res
        .status(502)
        .json({ status: false, message: "Gagal mengambil data dari sumber" });
    }
  };
}

// ---------- Normalisasi param ----------

function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return String(raw || "");
  }
}

function cleanSlug(raw) {
  return safeDecode(String(raw || "")).replace(/^\/+|\/+$/g, "");
}

function cleanPage(raw) {
  const n = parseInt(String(raw || "1"), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function cleanOrderby(raw) {
  const v = String(raw || "modified").toLowerCase();
  return ["modified", "popular", "date"].includes(v) ? v : "modified";
}

function mangaListShape(data) {
  return { status: true, message: "success", manga_list: data };
}

// ---------- Rute API (kontrak manga-api v2) ----------

app.get("/api/manga/page/:pagenumber", wrap((req) =>
  scraper
    .fetchList({ tipe: "manga", orderby: cleanOrderby(req.query.orderby), page: cleanPage(req.params.pagenumber) })
    .then(mangaListShape)
));

app.get("/api/manga/popular/:pagenumber", wrap((req) =>
  scraper
    .fetchList({ tipe: "manga", orderby: "popular", page: cleanPage(req.params.pagenumber) })
    .then(mangaListShape)
));

app.get("/api/manhwa/:pagenumber", wrap((req) =>
  scraper
    .fetchList({ tipe: "manhwa", orderby: cleanOrderby(req.query.orderby), page: cleanPage(req.params.pagenumber) })
    .then(mangaListShape)
));

// ---------- Proxy gambar (kurangi hotlink langsung + blokir referrer) ----------

const IMG_ALLOW = new Set(["komiku.org", "komiku.to", "cdn.komiku.org", "cdn.komiku.to", "api.komiku.org"]);

app.get("/api/img", async (req, res) => {
  const raw = String(req.query.u || "");
  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return res.status(400).json({ status: false, message: "URL gambar tidak valid" });
  }
  if (target.protocol !== "https:" || !IMG_ALLOW.has(target.hostname)) {
    return res.status(403).json({ status: false, message: "Host gambar tidak diizinkan" });
  }
  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://komiku.org/" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const ct = upstream.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) throw new Error("bukan gambar");
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("gambar terlalu besar");
    res.send(buf);
  } catch (err) {
    res.status(502).json({ status: false, message: "Gagal memuat gambar" });
  }
});

app.get("/api/manhua/:pagenumber", wrap((req) =>
  scraper
    .fetchList({ tipe: "manhua", orderby: cleanOrderby(req.query.orderby), page: cleanPage(req.params.pagenumber) })
    .then(mangaListShape)
));

app.get("/api/genres/:slug/:pagenumber", wrap((req) =>
  scraper
    .fetchList({
      tipe: ["manga", "manhwa", "manhua"].includes(req.query.tipe) ? req.query.tipe : "manga",
      orderby: cleanOrderby(req.query.orderby),
      genre: cleanSlug(req.params.slug),
      page: cleanPage(req.params.pagenumber),
    })
    .then(mangaListShape)
));

app.get("/api/genres", wrap(() => scraper.genreList().then((list) => ({
  status: true,
  message: "success",
  list_genre: list,
}))));

app.get("/api/search", wrap((req) => {
  const q = safeDecode(String(req.query.q || ""));
  return scraper.searchManga(q).then((data) => mangaListShape(data));
}));

app.get("/api/manga/detail/:slug", wrap((req) => scraper.detailManga(cleanSlug(req.params.slug))));

app.get("/api/chapter/:slug", wrap((req) => scraper.chapterDetail(cleanSlug(req.params.slug))));
// ---------- Static frontend & fallback ----------

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api", (req, res) => {
  res.json({
    status: true,
    message: "API komik aktif. Endpoint: /api/manga/page/:n, /api/manga/popular/:n, /api/manhwa/:n, /api/manhua/:n, /api/genres/:slug/:n, /api/genres, /api/search?q=, /api/manga/detail/:slug, /api/chapter/:slug",
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "api path not found" });
});

// Express decode param gagal sebelum handler (mis. %ZZ): jawab JSON, bukan HTML
app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    return res.status(400).json({ status: false, message: "Parameter tidak valid" });
  }
  next(err);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
