// Lectio — the Today and Settings screens, and moving between screens.
// Library, Journal and History are in library.js.

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  // Writes without telling the sync layer; sync.js uses this for changes that came from the account.
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  set(key, value) {
    this.save(key, value);
    if (SYNCED_KEYS.includes(key)) account.soon();
  },
};

let todayKey = dateKey(new Date()); // YYYY-MM-DD in local time
let data = null;

// ---------- Theme ----------
function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
applyTheme(store.get("theme", "auto"));

// ---------- Helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function roman(n) {
  const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

// "3.20.5" → "Locus III · Quæstio XX · §V", the form of Turretin's own Institutio.
function locus(short) {
  const [l, q, sections = ""] = String(short).split(/\.(.*?)\.(.*)/).filter(Boolean);
  if (!Number(l) || !Number(q)) return "";
  const numbers = sections.match(/\d+/g) ?? [];
  const listed = sections.includes("-")
    ? numbers.map((n) => roman(Number(n))).join("–")
    : numbers.map((n) => roman(Number(n))).join(", ");
  return `Locus ${roman(Number(l))} · Quæstio ${roman(Number(q))}` +
    (numbers.length ? ` · ${numbers.length > 1 ? "§§" : "§"}${listed}` : "");
}

function citation(d) {
  const src = data.sources[d.source];
  const where = d.page ? `${d.volume}:${esc(d.page)}` : `vol. ${d.volume}`;
  return `<span class="locus">${locus(d.locator)}</span>` +
    `${esc(src.author)}, <i>${esc(src.title)}</i>, ${esc(src.edition)}, ` +
    `${where} (${esc(d.locator)}).`;
}

function rubric(latin, english = "", mark = null) {
  const m = mark === null ? "" : ` data-mark="${mark}"`;
  return `<p class="rubric"${m}>${latin}</p>${english ? `<p class="gloss">${english}</p>` : ""}`;
}

function readAttrs(block) {
  return `data-read data-label="${esc(block.label)}" data-intro="${esc(block.intro)}"`;
}

// Today's devotional: the one completed today, else the first not yet completed.
function pickToday() {
  const done = store.get("completed", {});
  const doneToday = Object.entries(done).find(([date]) => date === todayKey);
  if (doneToday) return data.devotionals.find((d) => d.id === doneToday[1]) ?? data.devotionals[0];
  return data.devotionals.find((d) => !Object.values(done).includes(d.id)) ?? data.devotionals[0];
}

// ---------- Screens ----------
// `target` is a devotional opened from another screen; `from` is the screen to go back to.
function renderToday(target = null, from = null) {
  const d = target ?? pickToday();
  const notes = store.get("notes", {});
  const done = store.get("completed", {});
  const isDone = done[todayKey] === d.id;
  const otherToday = done[todayKey] && !isDone ? byId(done[todayKey]) : null;
  const doneOn = Object.keys(done).filter((k) => done[k] === d.id && k !== todayKey).sort().pop();
  const isSaved = store.get("favorites", []).includes(d.id);
  const src = data.sources[d.source];

  // Number the intro and sentences of each recorded part in recording order.
  let k = 0;
  const [lectio, meditatio, oratio] = d.read.map((b) => {
    const introMark = k++;
    const firstMark = k;
    k += b.sentences.length;
    return { ...b, introMark, firstMark };
  });
  reader.setDevotional(d.audio ?? null, {
    title: d.title,
    artist: `Lectio · ${src.author}`,
    album: data.plans[d.plan]?.title ?? "",
  }, d.scriptureAudio ?? null);

  document.getElementById("screen").innerHTML = `
    ${from ? `<button class="back-link" id="back">‹ ${esc(screens[from][0])}</button>` : ""}
    <div class="title-block">
      <p class="plan-line">${esc(data.plans[d.plan]?.title ?? "")} · Day ${roman(d.day)}</p>
      <h2>${esc(d.title)}</h2>
      <div class="title-actions">
        <button class="listen-btn" id="listen">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>
          Listen
        </button>
        <button class="listen-btn" id="save" aria-pressed="${isSaved}">${isSaved ? "★ Saved" : "☆ Save"}</button>
      </div>
    </div>

    <section class="card" data-read data-scripture data-label="Scriptura Sacra"
      data-intro="${esc(`Holy Scripture. ${spokenReference(d.scripture)}.`)}">
      ${rubric("Scriptura Sacra")}
      <p class="reference">${esc(d.scripture)} <small>(ESV)</small></p>
      <div id="passage"><p class="placeholder">Loading passage…</p></div>
    </section>

    <section class="card" ${readAttrs(lectio)}>
      ${rubric("Lectio", `From ${esc(src.author)}`, lectio.introMark)}
      <blockquote><p>${sentenceSpans(lectio.sentences, lectio.firstMark)}</p></blockquote>
      <p class="citation">${citation(d)}</p>
    </section>

    <section class="card">
      <div ${readAttrs(meditatio)}>
        ${rubric("Meditatio", "Commentary, not a quotation", meditatio.introMark)}
        <p>${sentenceSpans(meditatio.sentences, meditatio.firstMark)}</p>
      </div>
      <div class="fleuron"></div>
      <div ${readAttrs(oratio)}>
        ${rubric("Oratio", "", oratio.introMark)}
        <p>${sentenceSpans(oratio.sentences, oratio.firstMark)}</p>
      </div>
    </section>

    <section class="card">
      ${rubric("Adversaria")}
      <textarea id="notes" placeholder="What is the Lord showing you this morning?">${esc(notes[d.id] ?? "")}</textarea>
      <div class="saved" id="saved"></div>
    </section>

    ${doneOn ? `<p class="done-note">Completed ${esc(niceDate(doneOn))}</p>` : ""}
    ${otherToday
      ? `<p class="done-note">Today is already complete with “${esc(otherToday.title)}.”</p>`
      : `<button class="done-btn ${isDone ? "is-done" : ""}" id="done">
           ${isDone ? "Soli Deo Gloria" : "Mark today complete"}
         </button>`}
  `;

  loadPassage(d.scripture);
  document.getElementById("listen").addEventListener("click", () => reader.open());
  document.getElementById("back")?.addEventListener("click", () => showScreen(from));

  document.getElementById("save").addEventListener("click", (e) => {
    const list = store.get("favorites", []);
    const now = !list.includes(d.id);
    store.set("favorites", now ? [...list, d.id] : list.filter((id) => id !== d.id));
    e.currentTarget.textContent = now ? "★ Saved" : "☆ Save";
    e.currentTarget.setAttribute("aria-pressed", now);
  });

  const notesBox = document.getElementById("notes");
  let timer;
  const saveNote = () => {
    clearTimeout(timer);
    const all = store.get("notes", {});
    const dates = store.get("notesDates", {});
    if ((all[d.id] ?? "") === notesBox.value) return;
    all[d.id] = notesBox.value;
    dates[d.id] = todayKey;
    store.set("notes", all);
    store.set("notesDates", dates);
    const saved = document.getElementById("saved");
    if (saved) saved.textContent = "Saved";
  };
  notesBox.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(saveNote, 400);
  });
  notesBox.addEventListener("blur", saveNote); // so nothing is lost when changing screens

  // Updates the button in place so a reading in progress isn't interrupted.
  document.getElementById("done")?.addEventListener("click", (e) => {
    const latest = store.get("completed", {});
    if (latest[todayKey] === d.id) delete latest[todayKey];
    else latest[todayKey] = d.id;
    store.set("completed", latest);
    const now = latest[todayKey] === d.id;
    e.currentTarget.classList.toggle("is-done", now);
    e.currentTarget.textContent = now ? "Soli Deo Gloria" : "Mark today complete";
  });
}

const PASSAGE_MESSAGES = {
  nokey: 'Add your ESV API key in <a href="#" data-open-settings>Settings</a> to show the passage here.',
  key: 'The ESV API didn\'t accept your key. It may still be waiting for approval, or it may have been pasted incorrectly. Check it in <a href="#" data-open-settings>Settings</a>.',
  offline: "You're offline. The passage will load when you're connected.",
  unreachable: 'Couldn\'t load the passage. If your key is new it may still be awaiting approval; otherwise check it in <a href="#" data-open-settings>Settings</a>.',
  notfound: "The ESV API couldn't find this reference.",
  http: "The ESV API isn't responding right now. Try again later.",
};

async function loadPassage(reference) {
  const el = document.getElementById("passage");
  const result = await getPassage(reference);
  if (!el.isConnected) return;
  if (result.text) {
    el.innerHTML = `<div class="passage">${formatPassage(result.text)}</div>
      <p class="citation">${esc(ESV_COPYRIGHT)} <a href="https://www.esv.org" target="_blank" rel="noopener">www.esv.org</a></p>`;
  } else {
    el.innerHTML = `<p class="placeholder">${PASSAGE_MESSAGES[result.error] ?? PASSAGE_MESSAGES.http}</p>`;
    el.querySelector("[data-open-settings]")?.addEventListener("click", (e) => {
      e.preventDefault();
      showScreen("settings");
    });
  }
}

function renderAccount() {
  const card = document.getElementById("account-card");
  if (!card) return;

  if (account.signedIn) {
    const last = store.get("lastSync", 0);
    card.innerHTML = `
      ${rubric("Account", "Your notes and progress follow you to any device")}
      <p class="account-line">Signed in as <b>${esc(account.session.email)}</b></p>
      <p class="saved" id="account-status">${account.lastError
        ? `Couldn't sync: ${esc(account.lastError)}`
        : last ? `Last synced ${esc(new Date(last).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : "Not synced yet"}</p>
      <div class="row">
        <button class="small-btn" id="sync-now">Sync now</button>
        <button class="small-btn quiet" id="sign-out">Sign out</button>
      </div>`;
    document.getElementById("sync-now").addEventListener("click", async () => {
      document.getElementById("account-status").textContent = "Syncing…";
      await account.sync();
      renderAccount();
    });
    document.getElementById("sign-out").addEventListener("click", async () => {
      await account.signOut();
      renderAccount();
    });
    return;
  }

  card.innerHTML = `
    ${rubric("Account", "Keep your notes and progress safe")}
    <form id="account-form">
      <label class="field-label" for="account-email">Email</label>
      <input id="account-email" type="email" autocomplete="username" autocapitalize="off" spellcheck="false" required>
      <label class="field-label" for="account-password">Password</label>
      <input id="account-password" type="password" autocomplete="current-password" minlength="8" required>
      <div class="row">
        <button class="small-btn" type="submit">Sign in</button>
        <button class="small-btn quiet" type="button" id="create-account">Create account</button>
      </div>
      <p class="saved" id="account-status"></p>
    </form>`;

  const status = document.getElementById("account-status");
  const email = document.getElementById("account-email");
  const password = document.getElementById("account-password");

  document.getElementById("account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Signing in…";
    try {
      await account.signIn(email.value.trim(), password.value);
      renderAccount();
    } catch (err) {
      status.textContent = /confirm/i.test(err.message)
        ? "Please tap the confirmation link in your email first, then sign in."
        : err.message;
    }
  });

  document.getElementById("create-account").addEventListener("click", async () => {
    if (!email.reportValidity() || !password.reportValidity()) return;
    status.textContent = "Creating your account…";
    try {
      if (await account.signUp(email.value.trim(), password.value)) {
        await account.sync();
        renderAccount();
      } else {
        status.textContent = "Check your email and tap the confirmation link. Then come back here and tap Sign in.";
      }
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

function renderSettings() {
  const theme = store.get("theme", "auto");
  const key = store.get("esvKey", "");
  document.getElementById("screen").innerHTML = `
    <section class="card" id="account-card"></section>

    <section class="card">
      ${rubric("Appearance", "Light, dark, or follow your iPhone")}
      <div class="segmented" role="radiogroup">
        ${["auto", "light", "dark"].map((t) => `
          <button role="radio" aria-checked="${t === theme}" data-theme-choice="${t}"
            class="${t === theme ? "selected" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
      </div>
    </section>

    <section class="card">
      ${rubric("Read Aloud", "Voice and speed")}
      <p class="label-note">Scripture is read by Crossway's ESV narration. Turretin, the reflection and the prayer play from recordings made with Kokoro. If the narration can't be reached, your iPhone's own voice, chosen here, reads Scripture.</p>
      <label class="field-label" for="voice">Scripture voice</label>
      <select id="voice"></select>
      <div class="row">
        <button class="small-btn quiet" id="voice-sample">Hear a sample</button>
      </div>
      <label class="field-label" for="rate">Speed</label>
      <div class="segmented" id="rate">
        ${SPEEDS.map((r) => `<button data-rate="${r}" class="${r === store.get("readRate", 1) ? "selected" : ""}">${r}×</button>`).join("")}
      </div>
      <p class="label-note" style="margin-top:12px">For the most natural voices, download a free <b>Premium</b> or <b>Enhanced</b> English voice on your iPhone: Settings → Accessibility → Spoken Content (or Read &amp; Speak) → Voices → English. Then close and reopen Lectio, and choose it here.</p>
    </section>

    <section class="card">
      ${rubric("ESV API Key", "From api.esv.org · saved only on this device")}
      <input id="esv-key" type="password" autocomplete="off" spellcheck="false"
        placeholder="Paste your key here" value="${esc(key)}">
      <div class="row">
        <button class="small-btn" id="save-key">Save and test</button>
        <button class="small-btn quiet" id="show-key">Show</button>
      </div>
      <p class="saved" id="key-status"></p>
    </section>

    <section class="card">
      ${rubric("Copyright", "Holy Scripture")}
      <p class="citation" style="margin-top:0">${esc(ESV_COPYRIGHT)} <a href="https://www.esv.org" target="_blank" rel="noopener">www.esv.org</a></p>
    </section>
  `;

  renderAccount();

  document.querySelectorAll("[data-theme-choice]").forEach((btn) =>
    btn.addEventListener("click", () => {
      store.set("theme", btn.dataset.themeChoice);
      applyTheme(btn.dataset.themeChoice);
      renderSettings();
    }));

  const voiceSelect = document.getElementById("voice");
  const fillVoices = () => {
    const voices = englishVoices();
    const current = chosenVoice();
    voiceSelect.innerHTML = voices.length
      ? voices.map((v) => {
          const q = voiceQuality(v);
          return `<option value="${esc(v.voiceURI)}" ${v === current ? "selected" : ""}>${esc(v.name.replace(/\s*\((Premium|Enhanced)\)/i, ""))}${q ? ` · ${q}` : ""} (${esc(v.lang)})</option>`;
        }).join("")
      : "<option>Loading voices…</option>";
  };
  fillVoices();
  document.addEventListener("voicesready", fillVoices);
  voiceSelect.addEventListener("change", () => store.set("readVoice", voiceSelect.value));

  document.getElementById("voice-sample").addEventListener("click", () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      "For from him and through him and to him are all things. To him be glory forever. Amen.");
    const v = chosenVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = store.get("readRate", 1);
    speechSynthesis.speak(u);
  });

  document.querySelectorAll("[data-rate]").forEach((btn) =>
    btn.addEventListener("click", () => {
      store.set("readRate", Number(btn.dataset.rate));
      document.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("selected", b === btn));
    }));

  const input = document.getElementById("esv-key");
  document.getElementById("show-key").addEventListener("click", (e) => {
    input.type = input.type === "password" ? "text" : "password";
    e.target.textContent = input.type === "password" ? "Show" : "Hide";
  });

  document.getElementById("save-key").addEventListener("click", async () => {
    const status = document.getElementById("key-status");
    const value = input.value.trim();
    store.set("esvKey", value);
    if (!value) { status.textContent = "Key removed."; return; }
    status.textContent = "Testing…";
    try {
      await fetchPassage("John 3:16", value);
      status.textContent = "✓ Key works. Passages will now load on the Today screen.";
    } catch (e) {
      status.textContent = navigator.onLine
        ? "Saved, but the ESV API didn't accept it yet. It may still be awaiting approval, or check for a typo."
        : "Saved. You're offline, so it couldn't be tested.";
    }
  });
}

const screens = {
  today: ["Today", renderToday],
  library: ["Library", renderLibrary],
  journal: ["Journal", renderJournal],
  history: ["History", renderHistory],
  settings: ["Settings", renderSettings],
};

let currentScreen = "today";

function showScreen(name) {
  currentScreen = name;
  if (!document.getElementById("player").hidden) reader.close();
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  const [title, render] = screens[name];
  document.getElementById("screen-title").textContent = title;
  render();
  window.scrollTo(0, 0);
}

// Opens any devotional from the Library, Journal or History.
function openDevotional(id, from) {
  const d = byId(id);
  if (!d) return;
  if (d === pickToday()) return showScreen("today");
  if (!document.getElementById("player").hidden) reader.close();
  currentScreen = "devotional";
  document.getElementById("screen-title").textContent = `Day ${roman(d.day)}`;
  renderToday(d, from);
  window.scrollTo(0, 0);
}

function showDate() {
  document.getElementById("today-date").textContent =
    new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// Shows what arrived from the account, unless that would interrupt reading or typing.
document.addEventListener("lectiosynced", () => {
  const busy = document.activeElement?.matches("textarea, input") || !document.getElementById("player").hidden;
  if (!busy && ["today", "library", "journal", "history"].includes(currentScreen)) showScreen(currentScreen);
});

// An app left open overnight must not count this morning as yesterday.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !data || dateKey(new Date()) === todayKey) return;
  todayKey = dateKey(new Date());
  calendarMonth = null;
  showDate();
  if (!reader.playing) showScreen("today");
});

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => showScreen(btn.dataset.tab)));
// ---------- Start ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
initPlayer();

showDate();

fetch("devotionals.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((json) => { data = json; renderToday(); account.sync(); })
  .catch(() => {
    document.getElementById("screen").innerHTML =
      '<section class="card"><p class="placeholder">Could not load devotionals.json.</p></section>';
  });
