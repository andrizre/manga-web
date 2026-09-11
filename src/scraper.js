// Scraper komiku.org live — semua selector terpusat di file ini.
// Kontrak respons mengikuti manga-api v2.0 (zakirkun/manga-api).

const cheerio = require("cheerio");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
};

function warn(where, msg) {
  console.warn(`[scraper:${where}] ${msg}`);
}

async function httpGet(url, retries = 1) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------- List & search ----------

function parseCards(html) {
  const $ = cheerio.load(html);
  const out = [];
  const cards = $(".bge");
  if (!cards.length) warn("parseCards", "selector .bge tidak cocok, kemungkinan DOM sumber berubah");
  cards.each((_, el) => {
    const $el = $(el);
    const rawHref = $el.find("a").first().attr("href") || "";
    const endpoint = rawHref
      .replace(/^.*\/manga\//, "")
      .replace(/^\/+|\/+$/g, "");
    const title = $el.find(".kan h3").text().trim();
    const thumb = $el.find(".bgei img").attr("src") || $el.find(".bgei img").attr("data-src") || "";
    const type = $el.find(".tpe1_inf b").text().trim();
    const spanText = $el.find(".kan span.judul2").text().trim();
    const parts = spanText.split("|");
    const updated_on =
      (parts.length > 1 ? parts[1] : spanText).trim() || "";
    let chapter = "";
    const new1 = $el.find(".kan div.new1").last();
    if (new1.length) {
      chapter = new1.find("a span").last().text().trim();
    }
    if (!endpoint || !title) return;
    out.push({ title, thumb, type, updated_on, endpoint, chapter });
  });
  return out;
}

async function fetchList({ tipe = "manga", orderby = "modified", genre, page = 1 } = {}) {
  let url = "https://api.komiku.org/manga/";
  if (page > 1) url += `page/${page}/`;
  url += `?tipe=${encodeURIComponent(tipe)}&orderby=${encodeURIComponent(orderby)}`;
  if (genre) url += `&genre=${encodeURIComponent(genre)}`;
  const html = await httpGet(url);
  return parseCards(html);
}

async function searchManga(q) {
  if (!q || !q.trim()) return [];
  const url = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(q.trim())}`;
  const html = await httpGet(url);
  return parseCards(html);
}

// ---------- Detail manga ----------

function detailManga(slug) {
  return httpGet(`https://komiku.org/manga/${slug}`).then((html) => {
    const $ = cheerio.load(html);

    const title = $("#Judul h1").text().trim().replace(/^Komik\s+/, "")
      || $("h1").first().text().trim().replace(/^Komik\s+/, "");
    if (!title) warn("detailManga", `judul kosong untuk slug ${slug}`);
    const thumb = $(".ims img[src]").attr("src") || $(".ims img").attr("data-src") || $("#Judul img").attr("src") || "";

    const metaMap = {
      "Judul Alternatif": "alt_title",
      Tipe: "type",
      Tema: "tema",
      Author: "author",
      Status: "status",
      Rating: "rating",
      "Cara Baca": "reading_direction",
    };
    const meta = {};
    $(".inftable tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 2) return;
      const label = tds.first().text().replace(/:/g, "").trim();
      const field = metaMap[label];
      if (field) {
        meta[field] = tds.eq(1).text().trim();
      }
    });

    const genre_list = [];
    $("ul.genre li a span").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genre_list.push(g);
    });

    const synopsis = $("#Sinopsis p").text().trim() || $(".desc p").first().text().trim();

    const chapter = [];
    const rows = $("#Daftar_Chapter tbody tr");
    if (!rows.length) warn("detailManga", `chapter kosong untuk slug ${slug}`);
    rows.each((_, tr) => {
      const $tr = $(tr);
      const a = $tr.find("td.judulseries a");
      const href = a.attr("href") || "";
      const chapter_title = a.text().trim();
      const chapter_endpoint = href.replace(/^\/+|\/+$/g, "");
      const release_date = $tr.find("td.tanggalseries").text().trim();
      if (chapter_endpoint) {
        chapter.push({ chapter_title, chapter_endpoint, release_date });
      }
    });

    return {
      title,
      alt_title: meta.alt_title || "",
      type: meta.type || "",
      tema: meta.tema || "",
      author: meta.author || "",
      status: meta.status || "",
      rating: meta.rating || "",
      reading_direction: meta.reading_direction || "",
      thumb,
      genre_list,
      synopsis,
      manga_endpoint: slug,
      chapter,
    };
  });
}

// ---------- Detail chapter ----------

function chapterDetail(slug) {
  return httpGet(`https://komiku.org/${slug}/`).then((html) => {
    const $ = cheerio.load(html);

    let title = $("h1").first().text().trim();
    if (!title) {
      title = $("#Judul > header > p > a > b").text().trim();
    }

    const chapter_image = [];
    let imgs = $("#Baca_Komik img.klazy");
    if (!imgs.length) imgs = $("#Baca_Komik img");
    if (!imgs.length) warn("chapterDetail", `gambar kosong untuk slug ${slug}`);
    imgs.each((i, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src") || "";
      if (!src || src.includes("placeholder") || src.includes("loading")) return;
      if (src) {
        chapter_image.push({
          chapter_image_link: src,
          image_number: i + 1,
        });
      }
    });

    return {
      chapter_endpoint: slug,
      chapter_name: slug.split("-").join(" "),
      title,
      chapter_pages: chapter_image.length,
      chapter_image,
    };
  });
}

// ---------- Daftar genre ----------

async function genreList() {
  const html = await httpGet("https://komiku.org/pustaka/");
  const $ = cheerio.load(html);
  const out = [];
  $('select[name="genre"] option').each((_, el) => {
    const $el = $(el);
    const value = ($el.attr("value") || "").trim();
    if (!value) return;
    out.push({ genre_name: $el.text().trim(), endpoint: value });
  });
  return out;
}

module.exports = {
  fetchList,
  searchManga,
  detailManga,
  chapterDetail,
  genreList,
};
