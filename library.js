// Library, Journal and History screens, all kept on this device.
// Uses: store, esc, roman, data, todayKey, openDevotional (app.js).

// ---------- Dates ----------
function dateKey(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function niceDate(key) {
  const dt = parseKey(key);
  const opts = { month: "short", day: "numeric" };
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return dt.toLocaleDateString("en-US", opts);
}

function byId(id) {
  return data.devotionals.find((d) => d.id === id);
}

function bindOpen(from) {
  document.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () => openDevotional(el.dataset.open, from)));
}

// ---------- Library ----------
let libraryFilter = "all"; // "all", "saved", or a topic tag

function renderLibrary() {
  const done = Object.values(store.get("completed", {}));
  const saved = store.get("favorites", []);
  const next = pickToday();
  const tags = [...new Set(data.devotionals.flatMap((d) => d.tags ?? []))].sort();
  if (libraryFilter !== "all" && libraryFilter !== "saved" && !tags.includes(libraryFilter)) libraryFilter = "all";

  const matches = (d) => libraryFilter === "all"
    || (libraryFilter === "saved" ? saved.includes(d.id) : d.tags?.includes(libraryFilter));

  const row = (d) => `
    <button class="list-row" data-open="${esc(d.id)}">
      <span class="row-num">${roman(d.day)}</span>
      <span class="row-main">
        <span class="row-title">${esc(d.title)}</span>
        <span class="row-sub">${esc(d.scripture)} · ${esc(d.locator)}${d.id === next.id ? " · Today" : ""}</span>
      </span>
      <span class="row-mark">${saved.includes(d.id) ? "★" : ""}${done.includes(d.id) ? " ✓" : ""}</span>
    </button>`;

  const plans = Object.entries(data.plans).map(([id, plan]) => {
    const all = data.devotionals.filter((d) => d.plan === id);
    const shown = all.filter(matches);
    if (!shown.length) return "";
    const read = all.filter((d) => done.includes(d.id)).length;

    // Group the days under the Locus (Topic) they come from.
    const loci = [...new Set(shown.map((d) => d.locator.split(".")[0]))];
    return `
      <section class="card">
        <p class="rubric">${esc(plan.title)}</p>
        <p class="gloss">${read} of ${all.length} days read</p>
        <div class="progress"><div style="width:${all.length ? (read / all.length) * 100 : 0}%"></div></div>
        <p class="label-note list-intro">${esc(plan.description)}</p>
        ${loci.map((l) => `
          <p class="list-head">Locus ${roman(Number(l))}</p>
          ${shown.filter((d) => d.locator.split(".")[0] === l).map(row).join("")}`).join("")}
      </section>`;
  }).join("");

  document.getElementById("screen").innerHTML = `
    <div class="chips">
      ${[["all", "All"], ["saved", "★ Saved"], ...tags.map((t) => [t, t])].map(([value, label]) => `
        <button class="chip ${value === libraryFilter ? "selected" : ""}" data-filter="${esc(value)}">${esc(label)}</button>`).join("")}
    </div>
    ${plans || `<section class="card"><p class="placeholder">${libraryFilter === "saved"
      ? "Nothing saved yet. Tap ☆ Save on any devotional to keep it here."
      : "No devotionals on this topic yet."}</p></section>`}
  `;

  document.querySelectorAll("[data-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      libraryFilter = btn.dataset.filter;
      renderLibrary();
    }));
  bindOpen("library");
}

// ---------- Journal ----------
let journalSearch = "";

function renderJournal() {
  const notes = store.get("notes", {});
  const dates = store.get("notesDates", {});
  const entries = Object.entries(notes)
    .filter(([id, text]) => text.trim() && byId(id))
    .map(([id, text]) => ({ d: byId(id), text, date: dates[id] ?? "" }))
    .sort((a, b) => b.date.localeCompare(a.date));

  document.getElementById("screen").innerHTML = entries.length ? `
    <section class="card">
      <p class="rubric">Adversaria</p>
      <p class="gloss">${entries.length} ${entries.length === 1 ? "note" : "notes"} · saved only on this device</p>
      <input type="text" id="journal-search" placeholder="Search your notes" value="${esc(journalSearch)}">
      <div id="journal-list"></div>
    </section>` : `
    <section class="card">
      <p class="rubric">Adversaria</p>
      <p class="gloss">Your notes</p>
      <p class="placeholder">What you write in the Notes box each morning will be kept here.</p>
    </section>`;
  if (!entries.length) return;

  const list = document.getElementById("journal-list");
  const draw = () => {
    const q = journalSearch.trim().toLowerCase();
    const shown = entries.filter((e) => !q
      || `${e.text} ${e.d.title} ${e.d.scripture}`.toLowerCase().includes(q));
    list.innerHTML = shown.length ? shown.map((e) => `
      <button class="list-row" data-open="${esc(e.d.id)}">
        <span class="row-main">
          <span class="row-title">${esc(e.d.title)}</span>
          <span class="row-sub">${e.date ? `${esc(niceDate(e.date))} · ` : ""}${esc(e.d.scripture)}</span>
          <span class="row-excerpt">${esc(e.text.trim().slice(0, 160))}${e.text.trim().length > 160 ? "…" : ""}</span>
        </span>
      </button>`).join("") : '<p class="placeholder list-intro">No notes match that search.</p>';
    bindOpen("journal");
  };
  draw();
  document.getElementById("journal-search").addEventListener("input", (e) => {
    journalSearch = e.target.value;
    draw();
  });
}

// ---------- History ----------
let calendarMonth = null; // first day of the month on show

function streaks(done) {
  let longest = 0, run = 0, prev = null;
  for (const key of Object.keys(done).sort()) {
    const dt = parseKey(key);
    const follows = prev && new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1).getTime() === dt.getTime();
    run = follows ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = dt;
  }
  // The current streak stays alive until today has passed without a reading.
  const day = parseKey(todayKey);
  if (!done[todayKey]) day.setDate(day.getDate() - 1);
  let current = 0;
  while (done[dateKey(day)]) {
    current++;
    day.setDate(day.getDate() - 1);
  }
  return { current, longest, total: Object.keys(done).length };
}

function renderHistory() {
  const done = store.get("completed", {});
  const { current, longest, total } = streaks(done);
  const now = parseKey(todayKey);
  calendarMonth ??= new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calendarMonth.getFullYear(), m = calendarMonth.getMonth();
  const atThisMonth = y === now.getFullYear() && m === now.getMonth();

  const blanks = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  let cells = '<span class="cal-cell"></span>'.repeat(blanks);
  for (let n = 1; n <= days; n++) {
    const key = dateKey(new Date(y, m, n));
    const id = done[key];
    const cls = `cal-cell cal-day${id ? " is-done" : ""}${key === todayKey ? " is-today" : ""}`;
    cells += id && byId(id)
      ? `<button class="${cls}" data-open="${esc(id)}" aria-label="${esc(niceDate(key))}, ${esc(byId(id).title)}">${n}</button>`
      : `<span class="${cls}">${n}</span>`;
  }

  const recent = Object.keys(done).sort().reverse().filter((k) => byId(done[k])).slice(0, 10);

  document.getElementById("screen").innerHTML = `
    <section class="card">
      <div class="stats">
        <div><b>${current}</b><span>Current streak</span></div>
        <div><b>${longest}</b><span>Longest streak</span></div>
        <div><b>${total}</b><span>Days in all</span></div>
      </div>
    </section>

    <section class="card">
      <div class="cal-head">
        <button class="cal-nav" id="cal-prev" aria-label="Previous month">‹</button>
        <p class="rubric">${calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
        <button class="cal-nav" id="cal-next" aria-label="Next month" ${atThisMonth ? "disabled" : ""}>›</button>
      </div>
      <div class="cal-grid">
        ${["S", "M", "T", "W", "T", "F", "S"].map((w) => `<span class="cal-week">${w}</span>`).join("")}
        ${cells}
      </div>
    </section>

    <section class="card">
      <p class="rubric">Recent Days</p>
      ${recent.length ? recent.map((k) => `
        <button class="list-row" data-open="${esc(done[k])}">
          <span class="row-main">
            <span class="row-title">${esc(byId(done[k]).title)}</span>
            <span class="row-sub">${esc(niceDate(k))} · ${esc(byId(done[k]).scripture)}</span>
          </span>
        </button>`).join("") : '<p class="placeholder list-intro">Mark a day complete and it will appear here.</p>'}
    </section>
  `;

  const move = (delta) => {
    calendarMonth = new Date(y, m + delta, 1);
    renderHistory();
  };
  document.getElementById("cal-prev").addEventListener("click", () => move(-1));
  document.getElementById("cal-next").addEventListener("click", () => move(1));
  bindOpen("history");
}
