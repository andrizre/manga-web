// ---------- Navigasi umum (injeksi, tanpa edit tiap HTML) ----------

(function injectNav() {
  const header = document.querySelector("header");
  if (header) {
    const nav = document.createElement("nav");
    nav.className = "main-nav";
    const cur = location.pathname;
    [
      ["/", "Home"],
      ["/browse.html", "Jelajah"],
      ["/favorites.html", "Favorit"],
      ["#logout", "Kunci"],
    ].forEach(([href, label]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (
        (href === "/" && (cur === "/" || cur === "/index.html")) ||
        (href !== "/" && href !== "#logout" && cur === href)
      ) {
        a.classList.add("on");
      }
      if (href === "#logout") {
        a.onclick = async (e) => {
          e.preventDefault();
          try { await fetch("/api/logout", { method: "POST" }); } catch (_) {}
          location.href = "/gate.html";
        };
      }
      nav.appendChild(a);
    });
    header.appendChild(nav);
    const q = new URLSearchParams(location.search).get("q");
    const input = header.querySelector('input[name="q"]');
    if (q && input) input.value = q;
  }
  if (!document.querySelector("footer.site-foot")) {
    const f = document.createElement("footer");
    f.className = "site-foot";
    f.innerHTML = 'Sumber data: <a href="https://komiku.org" rel="noopener">komiku.org</a> · Dibuat oleh <a href="https://github.com/andrizre" rel="noopener">andrizre</a>';
    document.body.appendChild(f);
  }
})();

// ---------- Favorit & riwayat baca (localStorage) ----------

function loadStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch (_) {
    return {};
  }
}

function saveStore(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

const favStore = {
  all: () => loadStore("kmn_fav"),
  has: (slug) => Boolean(loadStore("kmn_fav")[slug]),
  toggle(slug, meta) {
    const all = loadStore("kmn_fav");
    if (all[slug]) {
      delete all[slug];
    } else {
      all[slug] = { ...meta, saved_at: Date.now() };
    }
    saveStore("kmn_fav", all);
    return Boolean(all[slug]);
  },
};

function saveHistory(slug, meta, ch) {
  const all = loadStore("kmn_hist");
  all[slug] = {
    ...meta,
    chapter_endpoint: ch.chapter_endpoint,
    chapter_title: ch.chapter_title || "",
    saved_at: Date.now(),
  };
  saveStore("kmn_hist", all);
}

function getHistory() {
  return loadStore("kmn_hist");
}

const $app = () => document.getElementById("app");

async function api(path, { retry = true } = {}) {
  const res = await fetch(path);
  if (res.status === 401 && retry && !document.body.dataset.page.includes("gate")) {
    location.href = `/gate.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error("Butuh kunci akses.");
  }
  if (!res.ok) {
    let msg = `Gagal memuat data (${res.status})`;
    try {
      const j = await res.json();
      if (j.message) msg = j.message;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function imgSrc(raw, w = 0) {
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("/api/img")) return w > 0 && !/[?&]w=/.test(raw) ? `${raw}&w=${w}` : raw;
  return `/api/img?u=${encodeURIComponent(raw)}${w > 0 ? `&w=${w}` : ""}`;
}

function armImg(img, alt, { eager = false } = {}) {
  img.loading = eager ? "eager" : "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.alt = alt || "";
  if (eager) img.fetchPriority = "high";
  img.onerror = () => {
    img.onerror = null;
    img.src = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="#22262f"/><text x="50%" y="50%" fill="#9aa0a6" font-size="22" text-anchor="middle">Cover hilang</text></svg>`);
  };
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

function typeClass(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("manhwa")) return "t-manhwa";
  if (s.includes("manhua")) return "t-manhua";
  if (s.includes("manga")) return "t-manga";
  return "";
}

function renderCard(item) {
  const a = document.createElement("a");
  a.className = "card";
  a.href = `/detail.html?slug=${encodeURIComponent(item.endpoint)}`;
  const wrap = document.createElement("div");
  wrap.className = "thumb-wrap";
  const img = document.createElement("img");
  img.src = imgSrc(item.thumb, 400);
  armImg(img, item.title);
  wrap.appendChild(img);
  if (item.type) {
    const badge = document.createElement("span");
    badge.className = `badge ${typeClass(item.type)}`;
    badge.textContent = item.type;
    wrap.appendChild(badge);
  }
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = item.title;
  a.appendChild(wrap);
  a.appendChild(title);
  if (item.updated_on || item.chapter) {
    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.textContent = [item.chapter, item.updated_on].filter(Boolean).join(" · ");
    a.appendChild(sub);
  }
  return a;
}

function renderGrid(container, items) {
  const grid = document.createElement("div");
  grid.className = "grid";
  items.forEach((it) => grid.appendChild(renderCard(it)));
  container.appendChild(grid);
}

function renderError(container, err, retryFn) {
  container.innerHTML = "";
  const p = document.createElement("p");
  p.className = "error-msg";
  p.textContent = err.message || "Terjadi kesalahan.";
  container.appendChild(p);
  if (retryFn) {
    const b = document.createElement("button");
    b.className = "btn secondary";
    b.style.marginTop = "12px";
    b.textContent = "Coba lagi";
    b.onclick = retryFn;
    container.appendChild(b);
  }
}

function paginate(container, page, renderFn) {
  const nav = document.createElement("div");
  nav.className = "pagination";
  const prev = document.createElement("button");
  prev.className = "btn secondary";
  prev.textContent = "← Sebelumnya";
  prev.disabled = page <= 1;
  prev.onclick = () => renderFn(page - 1);
  const info = document.createElement("span");
  info.className = "page-counter";
  info.style.padding = "8px 6px";
  info.textContent = `Halaman ${page}`;
  const next = document.createElement("button");
  next.className = "btn secondary";
  next.textContent = "Selanjutnya →";
  next.onclick = () => renderFn(page + 1);
  nav.appendChild(prev);
  nav.appendChild(info);
  nav.appendChild(next);
  container.appendChild(nav);
}

function skeletonGrid(n = 6) {
  const skel = document.createElement("div");
  skel.className = "grid";
  skel.setAttribute("aria-hidden", "true");
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "card skel";
    s.innerHTML = '<div class="thumb-wrap"></div><div class="card-title"> </div>';
    skel.appendChild(s);
  }
  return skel;
}

async function loadGridSection(container, url, heading, page, renderFn, { clear = true } = {}) {
  const token = Symbol();
  container.__loadToken = token;
  if (clear) container.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = heading;
  container.appendChild(h);
  const skel = skeletonGrid(6);
  container.appendChild(skel);
  try {
    const data = await api(url);
    if (container.__loadToken !== token) return;
    skel.remove();
    if (!data.manga_list || data.manga_list.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Tidak ditemukan.";
      container.appendChild(p);
      return;
    }
    renderGrid(container, data.manga_list);
    if (renderFn) paginate(container, page, renderFn);
  } catch (err) {
    if (container.__loadToken === token) { skel.remove(); renderError(container, err, () => loadGridSection(container, url, heading, page, renderFn, { clear: true })); }
  }
}

// ---------- Home ----------

async function pageHome() {
  document.title = "KomikuNesia - Baca Manga, Manhwa, Manhua";
  const app = $app();
  let page = parseInt(getParam("page"), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const hero = document.createElement("section");
  hero.className = "hero";
  hero.innerHTML = `<h1>Baca <span>Manga, Manhwa &amp; Manhua</span> Bahasa Indonesia</h1>
    <p>Update tercepat, tampilan cepat di HP, dan mode baca full-fit tanpa jeda. Simpan favorit dan lanjutkan bacaanmu kapan saja.</p>
    <div class="hero-row">
      <a class="btn" href="/browse.html">Mulai Jelajah →</a>
      <a class="btn secondary" href="/browse.html?tipe=manhwa">Manhwa Populer</a>
    </div>
    <div class="hero-stats">
      <div><b>3</b>Tipe komik</div>
      <div><b>∞</b>Chapter gratis</div>
      <div><b>📱</b>Ramah HP &amp; desktop</div>
    </div>`;
  app.appendChild(hero);

  const hist = Object.entries(getHistory())
    .filter(([, meta]) => meta && meta.chapter_endpoint)
    .sort((a, b) => b[1].saved_at - a[1].saved_at)
    .slice(0, 8);
  if (hist.length) {
    const sec = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = "Lanjut Baca";
    const link = document.createElement("a");
    link.className = "see-all";
    link.href = "/favorites.html";
    link.textContent = "Semua →";
    h.appendChild(link);
    sec.appendChild(h);
    const hs = document.createElement("div");
    hs.className = "hscroll";
    hist.forEach(([slug, meta]) => {
      const a = document.createElement("a");
      a.className = "card";
      a.href = `/read.html?c=${encodeURIComponent(meta.chapter_endpoint)}&m=${encodeURIComponent(slug)}`;
      const wrap = document.createElement("div");
      wrap.className = "thumb-wrap";
      const img = document.createElement("img");
      img.src = imgSrc(meta.thumb || "", 400);
      armImg(img, meta.title || slug);
      wrap.appendChild(img);
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = meta.title || slug;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = meta.chapter_title || "";
      a.appendChild(wrap);
      a.appendChild(title);
      a.appendChild(sub);
      hs.appendChild(a);
    });
    sec.appendChild(hs);
    app.appendChild(sec);
  }

  const pop = document.createElement("section");
  app.appendChild(pop);
  const popSkel = skeletonGrid(5);
  popSkel.className = "hscroll";
  pop.appendChild(popSkel);
  api("/api/manga/popular/1")
    .then((data) => {
      popSkel.remove();
      if (data.manga_list && data.manga_list.length) {
        const h = document.createElement("h2");
        h.textContent = "🔥 Populer";
        pop.appendChild(h);
        const hs = document.createElement("div");
        hs.className = "hscroll";
        data.manga_list.forEach((it) => hs.appendChild(renderCard(it)));
        pop.appendChild(hs);
      }
    })
    .catch(() => { popSkel.remove(); }); // bagian populer opsional

  // Section tambahan: manhwa & manhua (endpoint API tersedia, opsional)
  [
    ["/api/manhwa/1", "Manhwa", "manhwa"],
    ["/api/manhua/1", "Manhua", "manhua"],
  ].forEach(([url, heading, tipe]) => {
    const sec = document.createElement("section");
    app.appendChild(sec);
    api(url)
      .then((data) => {
        if (!data.manga_list || !data.manga_list.length) return;
        const h = document.createElement("h2");
        h.textContent = heading;
        const link = document.createElement("a");
        link.className = "see-all";
        link.href = `/browse.html?tipe=${tipe}`;
        link.textContent = "Lihat semua →";
        h.appendChild(link);
        sec.appendChild(h);
        const hs = document.createElement("div");
        hs.className = "hscroll";
        data.manga_list.forEach((it) => hs.appendChild(renderCard(it)));
        sec.appendChild(hs);
      })
      .catch(() => {});
  });

  await loadGridSection(app, `/api/manga/page/${page}`, "✨ Update Terbaru", page,
    (p) => {
      location.search = `?page=${p}`;
      window.scrollTo(0, 0);
    }, { clear: false });
}

// ---------- Browse ----------

async function pageBrowse() {
  const app = $app();
  const state = {
    tipe: getParam("tipe") || "manga",
    orderby: getParam("orderby") || "modified",
    genre: getParam("genre"),
    page: Math.max(1, parseInt(getParam("page"), 10) || 1),
  };

  const filters = document.createElement("div");
  filters.className = "filters";
  app.appendChild(filters);

  ["manga", "manhwa", "manhua"].forEach((t) => {
    const b = document.createElement("button");
    b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (t === state.tipe) b.classList.add("active");
    b.onclick = () => { state.tipe = t; state.page = 1; apply(); };
    filters.appendChild(b);
  });

  const orderby = document.createElement("select");
  orderby.setAttribute("aria-label", "Urutkan");
  [
    ["modified", "Terbaru"],
    ["popular", "Populer"],
    ["date", "Tanggal"],
  ].forEach(([v, label]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    if (v === state.orderby) o.selected = true;
    orderby.appendChild(o);
  });
  orderby.onchange = () => { state.orderby = orderby.value; state.page = 1; apply(); };
  filters.appendChild(orderby);

  const genreSel = document.createElement("select");
  genreSel.setAttribute("aria-label", "Genre");
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "Semua Genre";
  genreSel.appendChild(optAll);
  api("/api/genres")
    .then((data) => {
      (data.list_genre || []).forEach((g) => {
        const o = document.createElement("option");
        o.value = g.endpoint;
        o.textContent = g.genre_name;
        if (g.endpoint === state.genre) o.selected = true;
        genreSel.appendChild(o);
      });
    })
    .catch(() => {});
  genreSel.onchange = () => { state.genre = genreSel.value; state.page = 1; apply(); };
  filters.appendChild(genreSel);

  function orderLabel(v) {
    return v === "popular" ? "Populer" : v === "date" ? "Terbaru (tanggal)" : "Update terbaru";
  }

  function apply({ scroll = true } = {}) {
    [...filters.querySelectorAll("button")].forEach((b) => {
      b.classList.toggle("active", b.textContent.toLowerCase() === state.tipe);
    });
    const qs = new URLSearchParams();
    if (state.tipe !== "manga") qs.set("tipe", state.tipe);
    if (state.orderby !== "modified") qs.set("orderby", state.orderby);
    if (state.genre) qs.set("genre", state.genre);
    if (state.page > 1) qs.set("page", String(state.page));
    const s = qs.toString();
    history.replaceState(null, "", "/browse.html" + (s ? `?${s}` : ""));
    document.title = `Jelajah ${state.tipe}${state.genre ? ` - ${state.genre}` : ""} - KomikuNesia`;
    if (scroll) window.scrollTo(0, 0);
    render();
  }

  const gridSection = document.createElement("section");
  app.appendChild(gridSection);

  function render() {
    const qs = new URLSearchParams();
    if (state.tipe !== "manga") qs.set("tipe", state.tipe);
    if (state.orderby !== "modified") qs.set("orderby", state.orderby);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    const url = state.genre
      ? `/api/genres/${encodeURIComponent(state.genre)}/${state.page}${tail}`
      : state.tipe === "manga"
        ? `/api/manga/page/${state.page}${state.orderby !== "modified" ? `?orderby=${state.orderby}` : ""}`
        : `/api/${state.tipe}/${state.page}${state.orderby !== "modified" ? `?orderby=${state.orderby}` : ""}`;
    return loadGridSection(gridSection, url,
      `${state.tipe[0].toUpperCase() + state.tipe.slice(1)} · ${orderLabel(state.orderby)}${state.genre ? ` · ${state.genre}` : ""}`,
      state.page,
      (p) => { state.page = p; apply(); });
  }

  await render();
}


// ---------- Search ----------

async function pageSearch() {
  const app = $app();
  const q = getParam("q").trim();
  document.title = q ? `Cari ${q} - KomikuNesia` : "Cari - KomikuNesia";
  const h = document.createElement("h2");
  h.textContent = q ? `Hasil untuk “${q}”` : "Cari komik";
  app.appendChild(h);
  if (!q) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Ketik kata kunci di kolom pencarian.";
    app.appendChild(p);
    return;
  }
  const skel = skeletonGrid(8);
  app.appendChild(skel);
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    skel.remove();
    if (!data.manga_list || data.manga_list.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Tidak ditemukan. Coba kata kunci lain.";
      app.appendChild(p);
      return;
    }
    renderGrid(app, data.manga_list);
  } catch (err) {
    skel.remove();
    renderError(app, err, () => pageSearch());
  }
}

// ---------- Detail ----------

async function pageDetail() {
  const app = $app();
  const slug = getParam("slug");
  if (!slug) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Slug komik tidak ada.";
    app.appendChild(p);
    return;
  }
  const skelHead = document.createElement("div");
  skelHead.className = "detail-head";
  skelHead.innerHTML = '<div class="detail-cover" style="background:linear-gradient(100deg,#1d232e 40%,#2a3342 50%,#1d232e 60%);background-size:200% 100%"></div><div class="detail-info"><h1>Memuat…</h1><p class="empty">Mengambil sinopsis &amp; chapter.</p></div>';
  app.appendChild(skelHead);
  let d;
  try {
    d = await api(`/api/manga/detail/${encodeURIComponent(slug)}`);
    document.title = `${d.title || slug} - KomikuNesia`;
    try { sessionStorage.setItem(`kmn_ch:${slug}`, JSON.stringify({ meta: { title: d.title, thumb: d.thumb, type: d.type }, list: d.chapter, t: Date.now() })); } catch (_) {}
  } catch (err) {
    return renderError(app, err, () => pageDetail());
  }
  skelHead.remove();

  if (d.thumb) {
    const bg = document.createElement("div");
    bg.className = "detail-hero-bg";
    bg.style.backgroundImage = `url("${imgSrc(d.thumb, 400)}")`;
    app.appendChild(bg);
  }

  const head = document.createElement("div");
  head.className = "detail-head";

  const cover = document.createElement("div");
  cover.className = "detail-cover";
  const cimg = document.createElement("img");
  cimg.src = imgSrc(d.thumb, 400);
  armImg(cimg, d.title, { eager: true });
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.href = cimg.src;
  document.head.appendChild(preload);
  cover.appendChild(cimg);
  head.appendChild(cover);

  const info = document.createElement("div");
  info.className = "detail-info";
  const h1 = document.createElement("h1");
  h1.textContent = d.title;
  info.appendChild(h1);

  const sub = document.createElement("div");
  sub.className = "detail-sub";
  sub.textContent = [d.type, d.status, d.author].filter(Boolean).join(" · ");
  info.appendChild(sub);

  const metaGrid = document.createElement("div");
  metaGrid.className = "meta-grid";
  [
    ["Tipe", d.type],
    ["Status", d.status],
    ["Author", d.author],
    ["Rating", d.rating],
    ["Tema", d.tema],
    ["Arah baca", d.reading_direction],
  ].forEach(([k, v]) => {
    if (!v) return;
    const row = document.createElement("div");
    row.className = "meta-row";
    const kEl = document.createElement("span");
    kEl.className = "k";
    kEl.textContent = k;
    const vEl = document.createElement("span");
    vEl.className = "v";
    vEl.textContent = v;
    row.appendChild(kEl);
    row.appendChild(vEl);
    metaGrid.appendChild(row);
  });
  info.appendChild(metaGrid);

  if (d.alt_title) {
    const alt = document.createElement("div");
    alt.className = "detail-sub";
    alt.textContent = `Alias: ${d.alt_title}`;
    info.appendChild(alt);
  }

  if (d.genre_list && d.genre_list.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    d.genre_list.forEach((g) => {
      const a = document.createElement("a");
      a.className = "chip";
      a.href = `/browse.html?genre=${encodeURIComponent(g)}`;
      a.textContent = g;
      chips.appendChild(a);
    });
    info.appendChild(chips);
  }

  if (d.synopsis) {
    const p = document.createElement("p");
    p.className = "synopsis";
    p.textContent = d.synopsis;
    info.appendChild(p);
    if (d.synopsis.length > 260) {
      const more = document.createElement("button");
      more.className = "link-more";
      more.textContent = "Selengkapnya ↓";
      more.onclick = () => {
        const open = p.classList.toggle("open");
        more.textContent = open ? "Ringkas ↑" : "Selengkapnya ↓";
      };
      info.appendChild(more);
    }
  }

  if (d.chapter && d.chapter.length) {
    const actions = document.createElement("div");
    actions.className = "detail-actions";
    const slugNoSlash = slug.replace(/\/+$/, "");
    const latest = d.chapter[0];
    const bNew = document.createElement("a");
    bNew.className = "btn";
    bNew.href = `/read.html?c=${encodeURIComponent(latest.chapter_endpoint)}&m=${encodeURIComponent(slugNoSlash)}`;
    bNew.textContent = `▶ Baca Terbaru (${String(latest.chapter_title || "").replace(/^Chapter\s*/i, "Ch. ")})`;
    const first = d.chapter[d.chapter.length - 1];
    const bFirst = document.createElement("a");
    bFirst.className = "btn secondary";
    bFirst.href = `/read.html?c=${encodeURIComponent(first.chapter_endpoint)}&m=${encodeURIComponent(slugNoSlash)}`;
    bFirst.textContent = "Chapter Awal";
    actions.appendChild(bNew);
    actions.appendChild(bFirst);
    const meta = { title: d.title, thumb: d.thumb, type: d.type };
    const bFav = document.createElement("button");
    bFav.className = "btn secondary";
    const syncFav = () => {
      const on = favStore.has(slug);
      bFav.textContent = on ? "★ Favorit" : "☆ Favoritkan";
      bFav.classList.toggle("active", on);
    };
    bFav.onclick = () => { favStore.toggle(slug, meta); syncFav(); };
    syncFav();
    actions.appendChild(bFav);

    const hist = getHistory()[slug];
    if (hist && hist.chapter_endpoint) {
      const bCont = document.createElement("a");
      bCont.className = "btn secondary";
      bCont.href = `/read.html?c=${encodeURIComponent(hist.chapter_endpoint)}&m=${encodeURIComponent(slugNoSlash)}`;
      bCont.textContent = `Lanjut: ${String(hist.chapter_title || "").replace(/^Chapter\s*/i, "Ch. ")}`;
      actions.appendChild(bCont);
    }
    info.appendChild(actions);
  }

  head.appendChild(info);
  app.appendChild(head);

  // Daftar chapter (cari + virtualisasi 50 per halaman)
  if (d.chapter && d.chapter.length) {
    const slugNoSlash = slug.replace(/\/+$/, "");
    const readMap = loadStore("kmn_read");
    const readSet = new Set(Object.keys(readMap[slug] || {}));

    const bar = document.createElement("div");
    bar.className = "chapter-bar";
    const h2 = document.createElement("h2");
    h2.textContent = `Daftar Chapter (${d.chapter.length})`;
    const sortBtn = document.createElement("button");
    sortBtn.className = "btn secondary";
    let asc = false; // API terbaru → terlama
    let query = "";
    let shown = 50;
    const syncSort = () => { sortBtn.textContent = asc ? "Terlama ↑" : "Terbaru ↓"; };
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Cari chapter...";
    search.setAttribute("aria-label", "Cari chapter");
    search.oninput = () => { query = search.value.toLowerCase(); shown = 50; renderList(); };
    sortBtn.onclick = () => { asc = !asc; syncSort(); renderList(); };
    syncSort();
    bar.appendChild(h2);
    bar.appendChild(search);
    bar.appendChild(sortBtn);
    app.appendChild(bar);

    const ul = document.createElement("ul");
    ul.className = "chapter-list";
    app.appendChild(ul);
    const moreWrap = document.createElement("div");
    moreWrap.className = "pagination";
    const moreBtn = document.createElement("button");
    moreBtn.className = "btn secondary";
    moreBtn.textContent = "Muat lagi";
    moreBtn.onclick = () => { shown += 50; renderList(); };
    moreWrap.appendChild(moreBtn);
    app.appendChild(moreWrap);

    function renderList() {
      ul.innerHTML = "";
      const base = asc ? [...d.chapter].reverse() : d.chapter;
      const filtered = query ? base.filter((ch) => ch.chapter_title.toLowerCase().includes(query)) : base;
      if (!filtered.length) {
        const li = document.createElement("li");
        li.innerHTML = '<p class="empty">Chapter tidak cocok.</p>';
        ul.appendChild(li);
      }
      filtered.slice(0, shown).forEach((ch) => {
        const li = document.createElement("li");
        const ep = ch.chapter_endpoint.replace(/\/+$/, "");
        if (readSet.has(ep)) li.classList.add("read");
        const a = document.createElement("a");
        a.href = `/read.html?c=${encodeURIComponent(ch.chapter_endpoint)}&m=${encodeURIComponent(slugNoSlash)}`;
        const t = document.createElement("span");
        t.textContent = ch.chapter_title + (readSet.has(ep) ? " ✓" : "");
        const dt = document.createElement("span");
        dt.className = "date";
        dt.textContent = ch.release_date;
        a.appendChild(t);
        a.appendChild(dt);
        li.appendChild(a);
        ul.appendChild(li);
      });
      moreWrap.style.display = filtered.length > shown ? "" : "none";
    }
    renderList();
  }
}

// ---------- Favorit & Lanjut Baca ----------

function favCard(slug, meta, href, sub) {
  const a = document.createElement("a");
  a.className = "card";
  a.href = href;
  const wrap = document.createElement("div");
  wrap.className = "thumb-wrap";
  const img = document.createElement("img");
  img.src = imgSrc(meta.thumb || "", 400);
  armImg(img, meta.title || slug);
  wrap.appendChild(img);
  if (meta.type) {
    const badge = document.createElement("span");
    badge.className = `badge ${typeClass(meta.type)}`;
    badge.textContent = meta.type;
    wrap.appendChild(badge);
  }
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = meta.title || slug;
  a.appendChild(wrap);
  a.appendChild(title);
  if (sub) {
    const s = document.createElement("div");
    s.className = "card-sub";
    s.textContent = sub;
    a.appendChild(s);
  }
  return a;
}

function pageFavorites() {
  const app = $app();
  document.title = "Favorit - KomikuNesia";

  const tools = document.createElement("div");
  tools.className = "detail-actions";
  const expBtn = document.createElement("button");
  expBtn.className = "btn secondary";
  expBtn.textContent = "Ekspor JSON";
  expBtn.onclick = () => {
    const blob = new Blob([JSON.stringify({ fav: favStore.all(), hist: getHistory() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "komikunesia-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const impLabel = document.createElement("label");
  impLabel.className = "btn secondary";
  impLabel.textContent = "Impor JSON";
  impLabel.style.cursor = "pointer";
  const imp = document.createElement("input");
  imp.type = "file";
  imp.accept = "application/json";
  imp.hidden = true;
  imp.onchange = () => {
    const f = imp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.fav) saveStore("kmn_fav", j.fav);
        if (j.hist) saveStore("kmn_hist", j.hist);
        location.reload();
      } catch (_) { alert("File tidak valid."); }
    };
    r.readAsText(f);
  };
  impLabel.appendChild(imp);
  tools.appendChild(expBtn);
  tools.appendChild(impLabel);
  app.appendChild(tools);

  const favs = Object.entries(favStore.all());
  const hF = document.createElement("h2");
  hF.textContent = `Favorit (${favs.length})`;
  app.appendChild(hF);
  if (!favs.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Belum ada favorit. Tandai komik lewat tombol ☆ di halaman detail.";
    app.appendChild(p);
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    favs
      .sort((a, b) => b[1].saved_at - a[1].saved_at)
      .forEach(([slug, meta]) => {
        grid.appendChild(favCard(slug, meta, `/detail.html?slug=${encodeURIComponent(slug)}`, meta.type || ""));
      });
    app.appendChild(grid);
  }

  const hist = Object.entries(getHistory());
  const hH = document.createElement("h2");
  hH.textContent = "Lanjut Baca";
  app.appendChild(hH);
  if (!hist.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Riwayat baca masih kosong.";
    app.appendChild(p);
    return;
  }
  const gridH = document.createElement("div");
  gridH.className = "grid";
  hist
    .filter(([, meta]) => meta && meta.chapter_endpoint)
    .sort((a, b) => b[1].saved_at - a[1].saved_at)
    .forEach(([slug, meta]) => {
      gridH.appendChild(favCard(slug, meta, `/read.html?c=${encodeURIComponent(meta.chapter_endpoint)}&m=${encodeURIComponent(slug)}`, meta.chapter_title || meta.chapter_endpoint));
    });
  app.appendChild(gridH);
}

// ---------- Router ----------

const routes = {
  home: typeof pageHome !== "undefined" ? pageHome : null,
  browse: typeof pageBrowse !== "undefined" ? pageBrowse : null,
  search: typeof pageSearch !== "undefined" ? pageSearch : null,
  detail: typeof pageDetail !== "undefined" ? pageDetail : null,
  favorites: typeof pageFavorites !== "undefined" ? pageFavorites : null,
};

const page = document.body.dataset.page;
if (routes[page]) routes[page]();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW gagal didaftarkan:", err.message);
    });
  });
}