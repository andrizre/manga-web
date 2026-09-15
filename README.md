# KomikuNesia (manga-web)

Situs baca manga / manhwa / manhua bahasa Indonesia — **pemakaian pribadi, terkunci kunci akses**. Data live dari scraper komiku.org, frontend statis + PWA, deploy di Vercel.

## Fitur

- Home: populer, manhwa, manhua, update terbaru + paginasi
- Jelajah: filter tipe (manga/manhwa/manhua), urutan, genre
- Cari, detail (sinopsis + daftar chapter + cari/sort chapter), baca (prev/next, posisi baca tersimpan)
- Favorit + riwayat baca + status chapter terbaca (localStorage), ekspor/impor JSON
- PWA: service worker (app shell cache-first, API network-first), ikon + manifest
- **Kunci akses**: semua halaman/API 401 tanpa cookie `kmn_auth`; halaman `gate.html` untuk buka kunci; tombol nav "Kunci" untuk logout
- **Privat**: `robots.txt` = `Disallow: /`, semua HTML kirim `X-Robots-Tag: noindex, nofollow`, respons API `private`

## Struktur

```
manga-web/
├── api/index.js          # entry serverless Vercel → src/server.js
├── src/
│   ├── server.js         # Express: lock, rate-limit, cache header, proxy img, static
│   └── scraper.js        # scraper komiku.org (semua selector di sini)
├── public/
│   ├── *.html            # index, browse, search, detail, read, favorites, gate
│   ├── js/app.js         # seluruh frontend (router per data-page)
│   ├── css/style.css
│   ├── sw.js             # service worker (naikkan VERSION tiap deploy besar)
│   └── manifest.webmanifest, icon.*, robots.txt
└── vercel.json           # rewrite /api/:path* → /api
```

## API

Kontrak respons mengikuti manga-api v2 (zakirkun/manga-api). Semua butuh cookie kunci kecuali login/logout.

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/login` | body `{ "key": "<SITE_KEY>" }` → set cookie `kmn_auth` 1 tahun |
| POST | `/api/logout` | hapus cookie |
| GET | `/api/manga/page/:n?orderby=` | list manga (`modified`/`popular`/`date`) |
| GET | `/api/manga/popular/:n` | list populer |
| GET | `/api/manhwa/:n`, `/api/manhua/:n` | list per tipe |
| GET | `/api/genres/:slug/:n?tipe=&orderby=` | list per genre |
| GET | `/api/genres` | daftar genre |
| GET | `/api/search?q=` | cari (tanpa cache) |
| GET | `/api/manga/detail/:slug` | detail + daftar chapter |
| GET | `/api/chapter/:slug` | gambar chapter (cache 1 jam) |
| GET | `/api/img?u=<https-url>` | proxy gambar, host `*.komiku.org` / `*.komiku.to` saja, streaming |

Tanpa kunci: `{ "status": false, "message": "Butuh kunci akses", "code": "NEED_KEY" }` (401).

## Konfigurasi

| Env | Default | Keterangan |
|---|---|---|
| `SITE_KEY` | `andrizre` | **Ganti di Vercel** agar kunci tidak terpampang di repo publik |
| `PORT` | `3000` | port lokal |
| `NODE_ENV` | — | `production` → cookie `Secure` |

## Jalan lokal

```bash
cd manga-web
npm install
npm start          # http://localhost:3000
SITE_KEY=rahasia-baru npm start   # kunci custom
```

## Deploy (Vercel)

1. Import repo / folder `manga-web` ke Vercel
2. Set env `SITE_KEY` ke kunci pribadi
3. Deploy — `vercel.json` sudah me-rewrite `/api/*` ke function

## Catatan teknis

- Cache: respons API pakai header CDN (`s-maxage` 10 mnt, chapter 1 jam) — bukan memori lokal (tidak dishare antar instance serverless). `search` = `no-store`.
- Rate-limit: best-effort per instance (60 req/mnt/IP, `trust proxy` on); batas global atur di dashboard Vercel.
- Proxy gambar streaming (`Readable.fromWeb().pipe()`), limit 8 MB via `content-length`, cache CDN 1 hari.
- Halaman baca: 2 gambar pertama `eager` + prioritas tinggi, sisanya `lazy`; daftar chapter di-cache 30 mnt di `sessionStorage` (hemat 1 fetch detail→read); preload chapter berikut di scroll 80%.
- Scraper rapuh terhadap perubahan DOM komiku: bila list/detail/chapter kosong, cek log `[scraper:*]` lalu perbaiki selector di `src/scraper.js`.

## Sumber & legalitas

Data + gambar milik komiku.org / penerbit masing-masing. Proyek ini untuk pemakaian pribadi — jangan dipublikasikan tanpa izin pemegang hak. Atribusi tampil di footer situs.
