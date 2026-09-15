// ---------- Read ----------

const READER_DEFAULTS = { width: "w-800", gap: "gap-4", bg: "bg-black", mode: "fit-width", hideChrome: false, tapToggle: true };
function readerSettings() {
  try {
    return { ...READER_DEFAULTS, ...(JSON.parse(localStorage.getItem("kmn_reader") || "{}")) };
  } catch (_) {
    return { ...READER_DEFAULTS };
  }
}
function saveReaderSettings(s) {
  try { localStorage.setItem("kmn_reader", JSON.stringify(s)); } catch (_) {}
}

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

  const skel = document.createElement("p");
  skel.className = "empty";
  skel.textContent = "Memuat chapter…";
  app.appendChild(skel);

  let ch;
  try {
    ch = await api(`/api/chapter/${encodeURIComponent(c)}`);
  } catch (err) {
    skel.remove();
    return renderError(app, err, () => pageRead());
  }
  skel.remove();

  const settings = readerSettings();
  document.title = `${ch.title || ch.chapter_name} - KomikuNesia`;

  // progress bar
  const prog = document.createElement("div");
  prog.className = "reader-progress";
  prog.innerHTML = "<i></i>";
  document.body.appendChild(prog);
  const progFill = prog.querySelector("i");

  // Nav prev/next: pakai daftar chapter dari sessionStorage bila baru dari halaman detail (hemat 1 fetch)
  let prevCh = null, nextCh = null, mangaMeta = null, fullList = null;
  const cleanEp = (s) => String(s || "").replace(/\/+$/, "");
  const resolveNav = (list) => {
    fullList = list || null;
    const idx = (list || []).findIndex((x) => cleanEp(x.chapter_endpoint) === cleanEp(c));
    if (idx !== -1) {
      // Daftar terbaru → terlama: index+1 lebih tua (sebelumnya), index-1 lebih baru (selanjutnya)
      if (idx + 1 < list.length) prevCh = list[idx + 1];
      if (idx - 1 >= 0) nextCh = list[idx - 1];
    }
  };
  if (m) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(`kmn_ch:${m}`) || "null");
      if (cached && cached.list && Date.now() - (cached.t || 0) < 30 * 60 * 1000) {
        mangaMeta = cached.meta;
        resolveNav(cached.list);
      } else {
        const d = await api(`/api/manga/detail/${encodeURIComponent(m)}`);
        mangaMeta = { title: d.title || m, thumb: d.thumb || "", type: d.type || "" };
        resolveNav(d.chapter);
        try { sessionStorage.setItem(`kmn_ch:${m}`, JSON.stringify({ meta: mangaMeta, list: d.chapter, t: Date.now() })); } catch (_) {}
      }
    } catch (_) {}
  }

  // Preload halaman pertama chapter berikut saat pembaca mencapai 80% halaman
  if (nextCh && nextCh.chapter_endpoint) {
    const nextUrl = `/api/chapter/${encodeURIComponent(cleanEp(nextCh.chapter_endpoint))}`;
    let preloaded = false;
    const preloadNext = () => {
      if (preloaded) return;
      const y = window.scrollY + window.innerHeight;
      const h = document.documentElement.scrollHeight;
      if (h > 0 && y / h > 0.8) {
        preloaded = true;
        fetch(nextUrl).catch(() => {});
        window.removeEventListener("scroll", preloadNext);
      }
    };
    window.addEventListener("scroll", preloadNext, { passive: true });
  }

  // ---- topbar: back + title + chapter select + settings ----
  const topbar = document.createElement("div");
  topbar.className = "reader-topbar";

  const back = document.createElement("a");
  back.className = "back";
  back.href = m ? `/detail.html?slug=${encodeURIComponent(m)}` : "/";
  back.setAttribute("aria-label", "Kembali");
  back.textContent = "←";
  topbar.appendChild(back);

  const rTitle = document.createElement("div");
  rTitle.className = "reader-title";
  const b = document.createElement("b");
  b.textContent = ch.title || ch.chapter_name;
  const s = document.createElement("span");
  s.textContent = (mangaMeta && mangaMeta.title) || m || "";
  rTitle.appendChild(b);
  rTitle.appendChild(s);
  topbar.appendChild(rTitle);

  if (fullList && fullList.length) {
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Pindah chapter");
    fullList.forEach((item) => {
      const o = document.createElement("option");
      o.value = item.chapter_endpoint;
      o.textContent = item.chapter_title;
      if (cleanEp(item.chapter_endpoint) === cleanEp(c)) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      location.href = `/read.html?c=${encodeURIComponent(sel.value)}&m=${encodeURIComponent(m)}`;
    };
    topbar.appendChild(sel);
  }

  const setBtn = document.createElement("button");
  setBtn.className = "icon-btn";
  setBtn.textContent = "⚙";
  setBtn.setAttribute("aria-label", "Pengaturan baca");
  topbar.appendChild(setBtn);
  app.appendChild(topbar);

  // ---- settings panel ----
  const setPanel = document.createElement("div");
  setPanel.className = "reader-settings";
  const card = document.createElement("div");
  card.className = "reader-card";

  const mkSeg = (label, options, key) => {
    const row = document.createElement("div");
    row.className = "set-row";
    const l = document.createElement("span");
    l.className = "lbl";
    l.textContent = label;
    const seg = document.createElement("div");
    seg.className = "seg";
    options.forEach(([val, text]) => {
      const btn = document.createElement("button");
      btn.textContent = text;
      if (settings[key] === val) btn.classList.add("on");
      btn.onclick = () => {
        settings[key] = val;
        saveReaderSettings(settings);
        applySettings();
        [...seg.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x === btn));
      };
      seg.appendChild(btn);
    });
    row.appendChild(l);
    row.appendChild(seg);
    return row;
  };

  card.appendChild(mkSeg("Lebar", [["w-650", "Sempit"], ["w-800", "Sedang"], ["w-1000", "Lebar"], ["w-full", "Full"]], "width"));
  card.appendChild(mkSeg("Jarak", [["gap-0", "Rapat"], ["gap-4", "Normal"], ["gap-12", "Longgar"]], "gap"));
  card.appendChild(mkSeg("Mode", [["fit-width", "Fit lebar"], ["mode-height", "Fit tinggi"], ["mode-origin", "Asli"]], "mode"));

  const bgRow = document.createElement("div");
  bgRow.className = "set-row";
  const bgLbl = document.createElement("span");
  bgLbl.className = "lbl";
  bgLbl.textContent = "Latar";
  bgRow.appendChild(bgLbl);
  [["bg-black", "#000"], ["bg-dark", "#0b0e13"], ["bg-gray", "#1a1f28"], ["bg-paper", "#e9e4d8"]].forEach(([val, color]) => {
    const sw = document.createElement("button");
    sw.className = "swatch" + (settings.bg === val ? " on" : "");
    sw.style.background = color;
    sw.setAttribute("aria-label", val);
    sw.onclick = () => {
      settings.bg = val;
      saveReaderSettings(settings);
      applySettings();
      [...bgRow.querySelectorAll(".swatch")].forEach((x) => x.classList.toggle("on", x === sw));
    };
    bgRow.appendChild(sw);
  });
  const hideWrap = document.createElement("label");
  hideWrap.className = "switch";
  const hideCb = document.createElement("input");
  hideCb.type = "checkbox";
  hideCb.checked = Boolean(settings.hideChrome);
  hideCb.onchange = () => { settings.hideChrome = hideCb.checked; saveReaderSettings(settings); };
  hideWrap.appendChild(hideCb);
  hideWrap.appendChild(document.createTextNode("Sembunyikan UI saat scroll"));
  bgRow.appendChild(hideWrap);
  card.appendChild(bgRow);

  const hint = document.createElement("div");
  hint.className = "tap-hint";
  hint.textContent = "Ketuk gambar untuk sembunyikan/tampilkan UI · ← / → pindah chapter · scroll untuk progres";
  card.appendChild(hint);

  setPanel.appendChild(card);
  app.appendChild(setPanel);
  setBtn.onclick = () => {
    const open = setPanel.classList.toggle("open");
    setBtn.classList.toggle("on", open);
  };

  // ---- stage: full-fit seamless images ----
  const stage = document.createElement("div");
  stage.className = "reader-stage";
  const applySettings = () => {
    stage.className = `reader-stage ${settings.width} ${settings.gap} ${settings.bg}${settings.mode !== "fit-width" ? ` ${settings.mode}` : ""}`;
  };
  applySettings();
  app.appendChild(stage);

  const pages = ch.chapter_image || [];
  const total = pages.length;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const img = e.target;
      if (img.dataset.real && img.src !== img.dataset.real) {
        img.src = img.dataset.real;
        delete img.dataset.real;
      }
      io.unobserve(img);
    });
  }, { rootMargin: "300px 0px" });

  pages.forEach((im, idx) => {
    const fig = document.createElement("figure");
    fig.className = "page-item";
    const img = document.createElement("img");
    const real = imgSrc(im.chapter_image_link, 800);
    if (idx < 3) {
      img.src = real;
      if (idx === 0) img.fetchPriority = "high";
    } else {
      img.dataset.real = real;
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    }
    img.decoding = "async";
    img.loading = idx < 3 ? "eager" : "lazy";
    img.referrerPolicy = "no-referrer";
    img.alt = `Halaman ${im.image_number || idx + 1}`;
    img.draggable = false;
    img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
    if (idx < 3) requestAnimationFrame(() => img.classList.add("loaded"));
    img.onerror = () => {
      img.onerror = null;
      img.classList.add("loaded", "fail");
      img.src = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#151b24"/><text x="50%" y="50%" fill="#98a2b3" font-size="24" text-anchor="middle">Gambar ${idx + 1} gagal dimuat</text></svg>`);
    };
    if (idx >= 3) io.observe(img);
    fig.appendChild(img);
    const num = document.createElement("figcaption");
    num.className = "page-num";
    num.textContent = `${idx + 1} / ${total}`;
    fig.appendChild(num);
    if (settings.tapToggle) {
      img.addEventListener("click", () => document.body.classList.toggle("reader-hide-chrome"));
    }
    stage.appendChild(fig);
  });

  if (!total) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Gambar chapter kosong.";
    stage.appendChild(p);
  }

  // ---- bottom bar + fab + nav ----
  const bottom = document.createElement("div");
  bottom.className = "reader-bottombar";
  const mkNav = (href, label, cls) => {
    const a = document.createElement("a");
    a.className = cls;
    a.href = href;
    a.textContent = label;
    return a;
  };
  if (prevCh && m) bottom.appendChild(mkNav(`/read.html?c=${encodeURIComponent(prevCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`, "← Prev", "btn secondary"));
  const pg = document.createElement("span");
  pg.className = "pg";
  pg.textContent = `0 / ${total}`;
  bottom.appendChild(pg);
  if (m) bottom.appendChild(mkNav(`/detail.html?slug=${encodeURIComponent(m)}`, "☰", "btn secondary"));
  if (nextCh && m) bottom.appendChild(mkNav(`/read.html?c=${encodeURIComponent(nextCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`, "Next →", "btn"));
  document.body.appendChild(bottom);

  const fab = document.createElement("button");
  fab.className = "fab-top";
  fab.textContent = "↑";
  fab.setAttribute("aria-label", "Ke atas");
  fab.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
  document.body.appendChild(fab);

  // progress + counter + auto-hide via rAF-throttled scroll
  let ticking = false;
  let lastY = window.scrollY;
  const seen = new Set();
  const pageIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const n = Number(e.target.querySelector("img")?.alt?.match(/\d+/)?.[0] || 0);
      if (n) {
        seen.add(n);
        pg.textContent = `${Math.max(...seen)} / ${total}`;
      }
    });
  }, { threshold: 0.4 });
  stage.querySelectorAll(".page-item").forEach((f) => pageIO.observe(f));

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? Math.min(1, Math.max(0, y / h)) : 0;
      progFill.style.width = `${(pct * 100).toFixed(1)}%`;
      fab.classList.toggle("show", y > 900);
      if (settings.hideChrome) {
        const goingDown = y > lastY + 4;
        const goingUp = y < lastY - 4;
        if (goingDown && y > 220) document.body.classList.add("reader-hide-chrome");
        else if (goingUp) document.body.classList.remove("reader-hide-chrome");
        lastY = y;
      } else {
        document.body.classList.remove("reader-hide-chrome");
      }
      try { localStorage.setItem(resumeKey, String(y)); } catch (_) {}
    });
  };

  const resumeKey = `kmn_pos:${m || "?"}:${cleanEp(c)}`;
  try {
    const lastPos = parseInt(localStorage.getItem(resumeKey) || "0", 10);
    if (lastPos > 300) {
      setTimeout(() => {
        const go = confirm("Lanjutkan dari posisi baca terakhir?");
        if (go) window.scrollTo(0, lastPos);
      }, 400);
    }
  } catch (_) {}
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // cleanup saat pindah halaman (SPA tidak dipakai, tapi aman bila back/forward cache)
  window.addEventListener("pagehide", () => {
    [prog, bottom, fab].forEach((el) => el.remove());
    document.body.classList.remove("reader-hide-chrome");
    window.removeEventListener("scroll", onScroll);
  });

  if (m) {
    saveHistory(m, mangaMeta || favStore.all()[m] || { title: m }, { chapter_endpoint: c, chapter_title: ch.title || ch.chapter_name });
    const readMap = loadStore("kmn_read");
    (readMap[m] = readMap[m] || {})[cleanEp(c)] = Date.now();
    saveStore("kmn_read", readMap);
  }

  // next-chapter CTA di ujung
  const navRow = document.createElement("div");
  navRow.className = "reader-nav-row";
  if (prevCh && m) {
    const a = document.createElement("a");
    a.className = "btn secondary";
    a.href = `/read.html?c=${encodeURIComponent(prevCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`;
    a.textContent = "← Chapter sebelumnya";
    navRow.appendChild(a);
  }
  if (m) {
    const a = document.createElement("a");
    a.className = "btn secondary";
    a.href = `/detail.html?slug=${encodeURIComponent(m)}`;
    a.textContent = "Daftar chapter";
    navRow.appendChild(a);
  }
  app.appendChild(navRow);

  if (nextCh && m) {
    const zone = document.createElement("div");
    zone.className = "next-chapter-zone";
    const a = document.createElement("a");
    a.className = "btn";
    a.href = `/read.html?c=${encodeURIComponent(nextCh.chapter_endpoint)}&m=${encodeURIComponent(m)}`;
    a.textContent = `Lanjut: ${nextCh.chapter_title} →`;
    zone.appendChild(a);
    app.appendChild(zone);
  }
}

// Navigasi keyboard di halaman baca: ← prev, → next
if (document.body.dataset.page === "read") {
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
    if (e.key === "ArrowLeft") {
      const a = [...document.querySelectorAll(".reader-bottombar a, .reader-nav-row a")].find((x) => x.textContent.includes("Prev") || x.textContent.includes("sebelumnya"));
      if (a) a.click();
    } else if (e.key === "ArrowRight") {
      const nx = [...document.querySelectorAll(".reader-bottombar a, .next-chapter-zone a")].find((x) => x.textContent.includes("Next") || x.textContent.includes("Lanjut"));
      if (nx) nx.click();
    }
  });
}

// ---------- Router reader ----------
if (document.body.dataset.page === "read") { pageRead(); }
