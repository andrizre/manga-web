const crypto = require("crypto");
const path = require("path");
const express = require("express");
const scraper = require("./scraper");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Cache via CDN (Vercel): memori lokal tidak dishare antar instance serverless ----------

// TTL per jenis respons (detik). freshness dijamin CDN; stale-while-revalidate menutup jeda scraper.
const CACHE_LIST = 600; // list, search, genre, detail: 10 menit
const CACHE_CHAPTER = 3600; // chapter: 1 jam (isi halaman jarang berubah)

// ---------- Kunci akses pribadi: situs terkunci sebelum dipakai penuh ----------
// Kunci default "andrizre"; ganti via env SITE_KEY di Vercel agar tidak terpampang di repo publik.
// Token cookie = SHA-256 stateless sehingga valid antar instance serverless tanpa sesi.

const SITE_KEY = process.env.SITE_KEY || "andrizre";
const AUTH_TOKEN = crypto.createHash("sha256").update(`kmn-auth:${SITE_KEY}`).digest("hex");

function getCookie(req, name) {
  const parts = String(req.headers.cookie || "").split(";");
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    if (p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return "";
}

function isAuthed(req) {
  const v = getCookie(req, "kmn_auth");
  if (!v || v.length !== AUTH_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(AUTH_TOKEN));
  } catch (_) {
    return false;
  }
}

// API selain login/logout: 401 bila cookie kunci tidak cocok
function authApi(req, res, next) {
  if (req.path === "/api/login" || req.path === "/api/logout") return next();
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    if (!isAuthed(req)) return res.status(401).json({ status: false, message: "Butuh kunci akses", code: "NEED_KEY" });
  }
  next();
}

// Halaman HTML selain gate: sajikan gate.html bila belum buka kunci
// Termasuk "/" yang oleh express.static dipetakan ke index.html — tangani eksplisit di sini.
function authPage(req, res, next) {
  if (req.method !== "GET") return next();
  const p = req.path;
  if (p === "/gate.html") return next();
  if (p === "/" || p.endsWith(".html")) {
    if (isAuthed(req)) return next();
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (p === "/") res.set("Cache-Control", "private, no-store");
    return res.sendFile(path.join(__dirname, "..", "public", "gate.html"));
  }
  next();
}

// ---------- Rate-limit best-effort per instance (60 req/menit per IP untuk /api) ----------
// Batas global antar instance diatur di dashboard Vercel; ini hanya penahan burst lokal.

app.set("trust proxy", 1);
app.use(express.json());

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
  if (rl.size > 2000) rl.delete(rl.keys().next().value);
  next();
}

app.use(rateLimit);
app.use(authApi);
app.use(authPage);

// ---------- Wrapper handler scraper: cache di CDN, bukan memori lokal ----------

function wrap(fn, ttl = CACHE_LIST) {
  return async (req, res) => {
    const key = `${req.method} ${req.originalUrl}`;
    try {
      const data = await fn(req);
      if (ttl > 0) res.set("Cache-Control", `private, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`);
      else res.set("Cache-Control", "private, no-store");
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

function imgHostAllowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "komiku.org" || h === "komiku.to" || h.endsWith(".komiku.org") || h.endsWith(".komiku.to");
}

app.get("/api/img", async (req, res) => {
  const raw = String(req.query.u || "");
  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return res.status(400).json({ status: false, message: "URL gambar tidak valid" });
  }
  if (target.protocol !== "https:" || !imgHostAllowed(target.hostname)) {
    return res.status(403).json({ status: false, message: "Host gambar tidak diizinkan" });
  }
  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://komiku.org/" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`HTTP ${upstream.status}`);
    const ct = upstream.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) throw new Error("bukan gambar");
    const len = upstream.headers.get("content-length");
    if (len && Number(len) > 8 * 1024 * 1024) throw new Error("gambar terlalu besar");
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    const nodeStream = require("stream").Readable.fromWeb(upstream.body);
    nodeStream.on("error", () => { if (!res.headersSent) res.status(502).json({ status: false, message: "Gagal memuat gambar" }); else res.end(); });
    nodeStream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ status: false, message: "Gagal memuat gambar" });
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
}, 0));

app.get("/api/manga/detail/:slug", wrap((req) => scraper.detailManga(cleanSlug(req.params.slug))));

app.get("/api/chapter/:slug", wrap((req) => scraper.chapterDetail(cleanSlug(req.params.slug)), CACHE_CHAPTER));

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders(res, filePath) {
    // HTML: revalidasi tiap request; aset hash-less (app.js) dijamin segar via SW VERSION
    if (filePath.endsWith(".html")) {
      res.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
      res.set("X-Robots-Tag", "noindex, nofollow"); // situs pribadi: jangan diindeks
    }
  },
}));

app.post("/api/login", (req, res) => {
  const key = String((req.body && req.body.key) || "");
  if (key.length !== SITE_KEY.length) return res.status(401).json({ status: false, message: "Kunci salah" });
  try {
    if (!crypto.timingSafeEqual(Buffer.from(key), Buffer.from(SITE_KEY))) {
      return res.status(401).json({ status: false, message: "Kunci salah" });
    }
  } catch (_) {
    return res.status(401).json({ status: false, message: "Kunci salah" });
  }
  res.cookie("kmn_auth", AUTH_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 3600 * 1000, // buka sekali, ingat 1 tahun
    path: "/",
  });
  res.json({ status: true, message: "Kunci diterima" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("kmn_auth", { path: "/" });
  res.json({ status: true, message: "Terkunci kembali" });
});

app.get("/api", (req, res) => {
  res.json({
    status: true,
    message: "API komik aktif. Endpoint: /api/manga/page/:n, /api/manga/popular/:n, /api/manhwa/:n, /api/manhua/:n, /api/genres/:slug/:n, /api/genres, /api/search?q=, /api/manga/detail/:slug, /api/chapter/:slug",
  });
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
