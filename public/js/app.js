// ---------- Navigasi umum (injeksi, tanpa edit tiap HTML) ----------

(function injectNav() {
  const header = document.querySelector("header");
  if (header) {
    const nav = document.createElement("nav");
    nav.className = "main-nav";
    [
      ["/", "Home"],
      ["/browse.html", "Jelajah"],
      ["/favorites.html", "Favorit"],
    ].forEach(([href, label]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      nav.appendChild(a);
    });
    header.appendChild(nav);
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

async function api(path) {
  const res = await fetch(path);
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

function imgSrc(raw) {
  if (!raw) return "";
  if (raw.startsWith("/api/img") || raw.startsWith("data:")) return raw;
  return `/api/img?u=${encodeURIComponent(raw)}`;
}

function armImg(img, alt) {
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.alt = alt || "";
  img.onerror = () => {
    img.onerror = null;
    img.src = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="#22262f"/><text x="50%" y="50%" fill="#9aa0a6" font-size="22" text-anchor="middle">Cover hilang</text></svg>`);
  };
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

function renderCard(item) {
  const a = document.createElement("a");
  a.className = "card";
  a.href = `/detail.html?slug=${encodeURIComponent(item.endpoint)}`;
  const wrap = document.createElement("div");
  wrap.className = "thumb-wrap";
  const img = document.createElement("img");
  img.src = imgSrc(item.thumb);
  armImg(img, item.title);
  if (item.type) {
    const badge = document.createElement("span");
    badge.className = "badge";
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

function renderError(container, err) {
  container.innerHTML = "";
  const p = document.createElement("p");
  p.className = "error-msg";
  p.textContent = err.message || "Terjadi kesalahan.";
  container.appendChild(p);
}

function paginate(container, page, renderFn) {
  const nav = document.createElement("div");
  nav.className = "pagination";
  const prev = document.createElement("button");
  prev.className = "btn secondary";
  prev.textContent = "Sebelumnya";
  prev.disabled = page <= 1;
  prev.onclick = () => renderFn(page - 1);
  const next = document.createElement("button");
  next.className = "btn secondary";
  next.textContent = "Selanjutnya";
  next.onclick = () => renderFn(page + 1);
  nav.appendChild(prev);
  nav.appendChild(next);
  container.appendChild(nav);
}

async function loadGridSection(container, url, heading, page, renderFn, { clear = true } = {}) {
  const token = Symbol();
  container.__loadToken = token;
  if (clear) container.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = heading;
  container.appendChild(h);
  const skel = document.createElement("div");
  skel.className = "grid";
  skel.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("div");
    s.className = "card skel";
    s.innerHTML = '<div class="thumb-wrap"></div><div class="card-title"> </div>';
    skel.appendChild(s);
  }
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
    if (container.__loadToken === token) { skel.remove(); renderError(container, err); }
  }
}

// ---------- Home ----------

async function pageHome() {
  document.title = "KomikuNesia - Baca Manga, Manhwa, Manhua";
  const app = $app();
  let page = parseInt(getParam("page"), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const pop = document.createElement("section");
  app.appendChild(pop);
  const popSkel = document.createElement("div");
  popSkel.className = "hscroll";
  popSkel.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("div");
    s.className = "card skel";
    s.innerHTML = '<div class="thumb-wrap"></div><div class="card-title"> </div>';
    popSkel.appendChild(s);
  }
  pop.appendChild(popSkel);
  api("/api/manga/popular/1")
    .then((data) => {
      popSkel.remove();
      if (data.manga_list && data.manga_list.length) {
        const h = document.createElement("h2");
        h.textContent = "Populer";
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
    ["/api/manhwa/1", "Manhwa"],
    ["/api/manhua/1", "Manhua"],
  ].forEach(([url, heading]) => {
    const sec = document.createElement("section");
    app.appendChild(sec);
    api(url)
      .then((data) => {
        if (!data.manga_list || !data.manga_list.length) return;
        const h = document.createElement("h2");
        h.textContent = heading;
        const link = document.createElement("a");
        link.className = "see-all";
        link.href = `/browse.html?tipe=${heading.toLowerCase()}`;
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

  await loadGridSection(app, `/api/manga/page/${page}`, "Update Terbaru", page,
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
      `Komik ${state.tipe}${state.genre ? ` · genre ${state.genre}` : ""}`,
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
  h.textContent = q ? `Hasil untuk \u201C${q}\u201D` : "Cari komik";
  if (!q) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Ketik kata kunci di kolom pencarian.";
    app.appendChild(p);
    return;
  }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (!data.manga_list || data.manga_list.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Tidak ditemukan.";
      app.appendChild(p);
      return;
    }
    renderGrid(app, data.manga_list);
  } catch (err) {
    renderError(app, err);
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
  let d;
  try {
    d = await api(`/api/manga/detail/${encodeURIComponent(slug)}`);
    document.title = `${d.title || slug} - KomikuNesia`;
  } catch (err) {
    return renderError(app, err);
  }

  const head = document.createElement("div");
  head.className = "detail-head";

  const cover = document.createElement("div");
  cover.className = "detail-cover";
  const cimg = document.createElement("img");
  cimg.src = imgSrc(d.thumb);
  armImg(cimg, d.title);
  cover.appendChild(cimg);
  head.appendChild(cover);

  const info = document.createElement("div");
  info.className = "detail-info";
  const h1 = document.createElement("h1");
  h1.textContent = d.title;
  info.appendChild(h1);

  [
    ["Tipe", d.type],
    ["Tema", d.tema],
    ["Author", d.author],
    ["Status", d.status],
    ["Rating", d.rating],
    ["Cara Baca", d.reading_direction],
    ["Judul Alternatif", d.alt_title],
  ].forEach(([k, v]) => {
    if (!v) return;
    const row = document.createElement("div");
    row.className = "meta-row";
    const kEl = document.createElement("span");
    kEl.className = "k";
    kEl.textContent = k;
    const vEl = document.createElement("span");
    vEl.textContent = v;
    row.appendChild(kEl);
    row.appendChild(vEl);
    info.appendChild(row);
  });

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
  }

  if (d.chapter && d.chapter.length) {
    const actions = document.createElement("div");
    actions.className = "detail-actions";
    const slugNoSlash = slug.replace(/\/+$/, "");
    const latest = d.chapter[0];
    const bNew = document.createElement("a");
    bNew.className = "btn";
    bNew.href = `/read.html?c=${encodeURIComponent(latest.chapter_endpoint)}&m=${encodeURIComponent(slugNoSlash)}`;
    bNew.textContent = `Baca Terbaru (${latest.chapter_title.replace(/^Chapter\s*/i, "Chapter ")})`;
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
      bFav.textContent = on ? "\u2605 Favorit" : "\u2606 Favoritkan";
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
      bCont.textContent = `Lanjut: ${hist.chapter_title.replace(/^Chapter\s*/i, "Ch. ")}`;
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
    h2.textContent = "Daftar Chapter";
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

// ---------- Read ----------

async function pageRead() {
  const app = $app();
  const c = getParam("c");
  const m = getParam("m");
  if (!c) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Chapter tidak ada.";
    app.appendChild(p);
    return;
  }
  let ch;
  try {
    ch = await api(`/api/chapter/${encodeURIComponent(c)}`);
  } catch (err) {
    return renderError(app, err);
  }

  const h1 = document.createElement("h1");
  h1.textContent = ch.title || ch.chapter_name;
  h1.style.fontSize = "20px";
  document.title = `${ch.title || ch.chapter_name} - KomikuNesia`;
  app.appendChild(h1);

  // Nav prev/next dari daftar chapter detail
  let prevCh = null, nextCh = null, mangaMeta = null;
  if (m) {
    try {
      const d = await api(`/api/manga/detail/${encodeURIComponent(m)}`);
      mangaMeta = { title: d.title || m, thumb: d.thumb || "", type: d.type || "" };
      const idx = (d.chapter || []).findIndex(
        (x) => x.chapter_endpoint.replace(/\/+$/, "") === c.replace(/\/+$/, "")
      );
      if (idx !== -1) {
        // Daftar terbaru → terlama: index+1 lebih tua (sebelumnya), index-1 lebih baru (selanjutnya)
        if (idx + 1 < d.chapter.length) prevCh = d.chapter[idx + 1];
        if (idx - 1 >= 0) nextCh = d.chapter[idx - 1];
      }
    } catch (_) {}
  }

  const navTop = buildReadNav(prevCh, nextCh, m);
  app.appendChild(navTop);

  const imgs = document.createElement("div");
  imgs.className = "read-wrap";
  (ch.chapter_image || []).forEach((im) => {
    const img = document.createElement("img");
    img.src = imgSrc(im.chapter_image_link);
    armImg(img, `Halaman ${im.image_number}`);
    img.loading = "eager";
    imgs.appendChild(img);
  });

  app.appendChild(imgs);

  const counter = document.createElement("div");
  counter.className = "page-counter";
  const total = (ch.chapter_image || []).length;
  const seen = new Set();
  const updateCounter = () => counter.textContent = `${seen.size} / ${total} halaman`;
  updateCounter();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !seen.has(e.target.src)) {
        seen.add(e.target.src);
        updateCounter();
      }
    });
  }, { threshold: 0.5 });
  imgs.querySelectorAll("img").forEach((img) => io.observe(img));
  app.appendChild(counter);

  if (m) {
    saveHistory(m, mangaMeta || favStore.all()[m] || { title: m }, { chapter_endpoint: c, chapter_title: ch.title || ch.chapter_name });
    const readMap = loadStore("kmn_read");
    (readMap[m] = readMap[m] || {})[c.replace(/\/+$/, "")] = Date.now();
    saveStore("kmn_read", readMap);
  }
  const resumeKey = `kmn_pos:${m || "?"}:${c.replace(/\/+$/, "")}`;
  let resumeBtn = null;
  try {
    const lastY = parseInt(localStorage.getItem(resumeKey) || "0", 10);
    if (lastY > 300) {
      resumeBtn = document.createElement("button");
      resumeBtn.className = "btn secondary";
      resumeBtn.textContent = "Lanjut posisi baca";
      resumeBtn.onclick = () => window.scrollTo(0, lastY);
      app.insertBefore(resumeBtn, imgs);
    }
  } catch (_) {}
  let saveT = null;
  window.addEventListener("scroll", () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(resumeKey, String(window.scrollY)); } catch (_) {} }, 400);
  }, { passive: true });
  app.appendChild(buildReadNav(prevCh, nextCh, m));
}

// Navigasi keyboard di halaman baca: ← prev, → next
if (document.body.dataset.page === "read") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      const a = document.querySelector(".read-nav a.btn:first-of-type");
      if (a && a.textContent.includes("Sebelumnya")) a.click();
    } else if (e.key === "ArrowRight") {
      const links = [...document.querySelectorAll(".read-nav a")];
      const nx = links.find((x) => x.textContent.includes("Selanjutnya"));
      if (nx) nx.click();
    }
  });
}

// ---------- Favorit & Lanjut Baca ----------

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
  if (!favs.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Belum ada favorit. Tandai komik lewat tombol \u2606 di halaman detail.";
    app.appendChild(p);
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    favs
      .sort((a, b) => b[1].saved_at - a[1].saved_at)
      .forEach(([slug, meta]) => {
        const a = document.createElement("a");
        a.className = "card";
        a.href = `/detail.html?slug=${encodeURIComponent(slug)}`;
        const wrap = document.createElement("div");
        wrap.className = "thumb-wrap";
        const img = document.createElement("img");
        img.src = imgSrc(meta.thumb);
        armImg(img, meta.title);
        wrap.appendChild(img);
        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = meta.title;
        a.appendChild(wrap);
        a.appendChild(title);
        grid.appendChild(a);
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
      const a = document.createElement("a");
      a.className = "card";
      a.href = `/read.html?c=${encodeURIComponent(meta.chapter_endpoint)}&m=${encodeURIComponent(slug)}`;
      const wrap = document.createElement("div");
      wrap.className = "thumb-wrap";
      const img = document.createElement("img");
      img.src = imgSrc(meta.thumb || "");
      armImg(img, meta.title || slug);
      wrap.appendChild(img);
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = meta.title || slug;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = meta.chapter_title || meta.chapter_endpoint;
      a.appendChild(wrap);
      a.appendChild(title);
      a.appendChild(sub);
      gridH.appendChild(a);
    });
  app.appendChild(gridH);
}

function buildReadNav(prevCh, nextCh, m) {
  const nav = document.createElement("div");
  nav.className = "read-nav";
  const mk = (href, label, cls) => {
    const a = document.createElement("a");
    a.className = cls;
    a.href = href;
    a.textContent = label;
    return a;
  };
  if (prevCh && m) {
    nav.appendChild(mk(`/read.html?c=${encodeURIComponent(prevCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`, "\u2190 Sebelumnya", "btn secondary"));
  } else {
    const s = document.createElement("span");
    nav.appendChild(s);
  }
  if (m) {
    nav.appendChild(mk(`/detail.html?slug=${encodeURIComponent(m)}`, "Daftar Chapter", "btn secondary"));
  }
  if (nextCh && m) {
    nav.appendChild(mk(`/read.html?c=${encodeURIComponent(nextCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`, "Selanjutnya \u2192", "btn secondary"));
  } else {
    const s = document.createElement("span");
    nav.appendChild(s);
  }
  return nav;
}

// ---------- Router ----------

const routes = {
  home: pageHome,
  browse: pageBrowse,
  search: pageSearch,
  detail: pageDetail,
  read: pageRead,
  favorites: pageFavorites,
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
