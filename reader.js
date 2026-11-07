// Read aloud. Scripture streams Crossway's narration, and the reading, reflection and prayer play
// from recordings made on the Mac with Kokoro (tools/voice.py), so all of it keeps playing with the
// screen locked. If the narration can't be reached, the device's own voice reads Scripture.
// Uses: store, esc (app.js).

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const WORDS_PER_MIN = 165;

// ---------- Text preparation (device voice only; recorded text is prepared by tools/speech.py) ----------

function splitSentences(text) {
  return text
    .split(/(?<=[.!?…][”"’)]?)\s+(?=[“"(]?[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Renders sentences ({text, say}) as tappable spans, numbered in recording order from `start`.
function sentenceSpans(list, start = null) {
  return list.map((s, n) =>
    `${s.p ? "</p><p>" : n ? " " : ""}<span class="s" data-say="${esc(s.say)}"${start === null ? "" : ` data-mark="${start + n}"`}>${esc(s.text)}</span>`
  ).join("");
}

// "Romans 11:33-36" → "Romans, chapter 11, verses 33 to 36" (otherwise voices read it as a time).
function spokenReference(ref) {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:[-–](\d+))?$/);
  if (!m) return ref;
  const [, book, ch, v1, v2] = m;
  return v2 ? `${book}, chapter ${ch}, verses ${v1} to ${v2}` : `${book}, chapter ${ch}, verse ${v1}`;
}

// ---------- Device voices ----------

function englishVoices() {
  if (!("speechSynthesis" in window)) return [];
  const novelty = /speech\.synthesis|eloquence|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/i;
  const rank = (v) => (/premium/i.test(v.voiceURI + v.name) ? 0 : /enhanced/i.test(v.voiceURI + v.name) ? 1 : 2);
  return speechSynthesis.getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en") && !novelty.test(v.voiceURI + " " + v.name))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function voiceQuality(v) {
  if (/premium/i.test(v.voiceURI + v.name)) return "Premium";
  if (/enhanced/i.test(v.voiceURI + v.name)) return "Enhanced";
  return "";
}

function chosenVoice() {
  const voices = englishVoices();
  return voices.find((v) => v.voiceURI === store.get("readVoice", "")) ?? voices[0] ?? null;
}

if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => document.dispatchEvent(new Event("voicesready")));
}

// ---------- Player ----------

const audioEl = new Audio();
audioEl.preload = "auto";
audioEl.preservesPitch = true;
audioEl.webkitPreservesPitch = true;

const reader = {
  queue: [],
  i: 0,
  playing: false,
  mode: null,            // "audio" or "speech"
  token: 0,
  recording: null,       // {src, marks} for the devotional on screen
  scriptureSrc: null,    // Crossway's narration of the day's passage
  loadedSrc: null,       // what audioEl currently holds
  swapping: false,       // audioEl is changing files, so its "pause" event means nothing
  meta: null,            // {title, artist, album} for the lock screen
  wakeLock: null,
  followPausedUntil: 0,

  get rate() { return store.get("readRate", 1); },

  // Called by the Today screen with the devotional's recording (or null).
  setDevotional(recording, meta, scriptureSrc = null) {
    this.recording = recording;
    this.meta = meta;
    this.scriptureSrc = scriptureSrc;
  },

  // Builds the reading queue from [data-read] blocks on screen, in order.
  collect() {
    const marks = this.recording?.marks;
    this.queue = [];
    document.querySelectorAll("[data-read]").forEach((block) => {
      const label = block.dataset.label;
      if (block.dataset.scripture !== undefined && this.scriptureSrc) {
        // One item for the whole passage: the narration has no verse timings.
        const text = [...block.querySelectorAll(".s")].map((el) => el.dataset.say).join(" ");
        this.queue.push({ el: block.querySelector(".rubric"), text, label, narrated: true, mark: null });
        return;
      }
      const items = [];
      if (block.dataset.intro) items.push({ el: block.querySelector(".rubric"), text: block.dataset.intro, intro: true });
      block.querySelectorAll(".s").forEach((el) => items.push({ el, text: el.dataset.say }));
      for (const it of items) {
        const k = it.el?.dataset.mark;
        it.mark = marks && k !== undefined ? marks[Number(k)] : null;
        it.label = label;
        this.queue.push(it);
      }
    });
  },

  open(startEl) {
    this.collect();
    if (!this.queue.length) return;
    const at = startEl ? this.queue.findIndex((q) => q.el === startEl) : 0;
    this.i = Math.max(0, at);
    document.body.classList.add("has-player");
    document.getElementById("player").hidden = false;
    this.setupMediaSession();
    this.play();
  },

  close() {
    this.pause();
    document.body.classList.remove("has-player");
    document.getElementById("player").hidden = true;
    this.mark(null);
  },

  play() {
    this.playing = true;
    this.keepAwake(true);
    this.speak();
  },

  pause() {
    this.playing = false;
    this.token++;
    audioEl.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.keepAwake(false);
    this.update();
  },

  toggle() { this.playing ? this.pause() : this.play(); },

  goTo(j) {
    this.i = Math.min(Math.max(j, 0), this.queue.length - 1);
    this.followPausedUntil = 0;
    if (this.playing) this.speak();
    else { this.mark(this.queue[this.i]?.el); this.update(); }
  },

  skip(delta) { this.goTo(this.i + delta); },

  // Jumps to the start of the previous or next section.
  skipSection(delta) {
    const label = this.queue[this.i]?.label;
    let j = this.i;
    if (delta > 0) {
      while (j < this.queue.length && this.queue[j].label === label) j++;
      if (j >= this.queue.length) return;
    } else {
      while (j > 0 && this.queue[j - 1].label === label) j--;
      if (j === this.i && j > 0) {
        const prev = this.queue[j - 1].label;
        while (j > 0 && this.queue[j - 1].label === prev) j--;
      }
    }
    this.goTo(j);
  },

  cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(this.rate) + 1) % SPEEDS.length] ?? 1;
    store.set("readRate", next);
    audioEl.defaultPlaybackRate = next;
    audioEl.playbackRate = next;
    if (this.playing && this.mode === "speech") this.speak();
    this.update();
  },

  speak() {
    const item = this.queue[this.i];
    if (!item) return this.finish();
    const token = ++this.token;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.mark(item.el);
    this.update();

    if (item.narrated) return this.playFrom(this.scriptureSrc, 0);
    // Recorded: seek to this sentence and let the recording run on from there.
    if (item.mark) return this.playFrom(this.recording.src, item.mark[0]);

    this.mode = "speech";
    audioEl.pause();
    if (!("speechSynthesis" in window)) { this.i++; return this.speak(); }
    // iOS sometimes drops an utterance queued in the same tick as cancel().
    setTimeout(() => {
      if (token !== this.token) return;
      const u = new SpeechSynthesisUtterance(item.text);
      const voice = chosenVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = this.rate;
      u.onend = () => {
        if (token !== this.token || !this.playing) return;
        this.i++;
        if (this.i >= this.queue.length) return this.finish();
        const pause = this.queue[this.i].intro ? 900 : 120;
        setTimeout(() => { if (token === this.token && this.playing) this.speak(); }, pause);
      };
      u.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") return;
        if (token === this.token) this.pause();
      };
      speechSynthesis.speak(u);
    }, 60);
  },

  // Plays `src` from `seconds` in. play() is called at once, without waiting for the file, so that
  // moving from Scripture into the recording still works with the screen locked.
  playFrom(src, seconds) {
    this.mode = "audio";
    audioEl.defaultPlaybackRate = this.rate;
    if (this.loadedSrc === src) {
      audioEl.playbackRate = this.rate;
      audioEl.currentTime = seconds;
    } else {
      this.loadedSrc = src;
      this.swapping = true;
      audioEl.src = src;
      audioEl.addEventListener("loadedmetadata", () => {
        audioEl.playbackRate = this.rate;
        if (seconds) audioEl.currentTime = seconds;
      }, { once: true });
    }
    // A file that won't load is handled by the "error" listener below.
    audioEl.play().catch((e) => { if (e.name === "NotAllowedError") this.pause(); });
  },

  // While the recording plays, follow it sentence by sentence.
  onTime() {
    if (this.mode !== "audio" || !this.playing) return;
    if (this.queue[this.i]?.narrated) return this.update();
    const t = audioEl.currentTime + 0.05;
    let j = this.i;
    while (j + 1 < this.queue.length && this.queue[j + 1].mark && this.queue[j + 1].mark[0] <= t) j++;
    if (j !== this.i) {
      this.i = j;
      this.mark(this.queue[j].el);
    }
    this.update();
  },

  finish() {
    this.playing = false;
    this.mode = null;
    this.i = 0;
    audioEl.pause();
    this.keepAwake(false);
    this.mark(null);
    this.update();
    document.getElementById("player-label").textContent = "Soli Deo Gloria";
  },

  mark(el) {
    document.querySelectorAll(".s.reading, .rubric.reading").forEach((x) => x.classList.remove("reading"));
    if (!el) return;
    el.classList.add("reading");
    if (Date.now() < this.followPausedUntil || document.hidden) return;
    const r = el.getBoundingClientRect();
    const top = 90, bottom = window.innerHeight - 190;
    if (r.top < top || r.bottom > bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
  },

  secondsLeft() {
    let secs = 0, lastMark = null;
    const current = this.queue[this.i];
    for (let j = this.i; j < this.queue.length; j++) {
      const q = this.queue[j];
      if (q.mark) lastMark = q.mark;
      else if (q === current && q.narrated && this.mode === "audio" && audioEl.duration) {
        secs += Math.max(0, audioEl.duration - audioEl.currentTime);
      } else secs += (q.text.split(/\s+/).length / WORDS_PER_MIN) * 60;
    }
    if (lastMark) {
      const inRecording = current?.mark && this.mode === "audio";
      secs += Math.max(0, lastMark[1] - (inRecording ? audioEl.currentTime : 0));
    }
    return secs / this.rate;
  },

  update() {
    const item = this.queue[this.i];
    document.getElementById("player-label").textContent = item?.label ?? "";
    const left = this.secondsLeft();
    document.getElementById("player-time").textContent =
      left < 60 ? `${Math.max(1, Math.round(left))} sec left` : `${Math.round(left / 60)} min left`;
    document.getElementById("player-fill").style.width =
      `${this.queue.length ? (this.i / this.queue.length) * 100 : 0}%`;
    document.getElementById("pl-speed").textContent = `${this.rate}×`;
    const play = document.getElementById("pl-play");
    play.innerHTML = this.playing ? ICONS.pause : ICONS.play;
    play.setAttribute("aria-label", this.playing ? "Pause" : "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = this.playing ? "playing" : "paused";
  },

  // Lock-screen and headphone controls.
  setupMediaSession() {
    if (!("mediaSession" in navigator) || !this.meta) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      ...this.meta,
      artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
    set("play", () => this.play());
    set("pause", () => this.pause());
    set("previoustrack", () => this.skipSection(-1));
    set("nexttrack", () => this.skipSection(1));
    set("seekbackward", () => this.skip(-1));
    set("seekforward", () => this.skip(1));
  },

  // Keeps the screen on while reading along; the recording also plays on with the screen locked.
  async keepAwake(on) {
    try {
      if (on && !this.wakeLock && "wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {}
  },
};

audioEl.addEventListener("timeupdate", () => reader.onTime());
audioEl.addEventListener("ended", () => {
  if (reader.mode !== "audio") return;
  if (reader.queue[reader.i]?.narrated) { reader.i++; reader.speak(); } // on into the recording
  else reader.finish();
});
audioEl.addEventListener("playing", () => { reader.swapping = false; });
// If Crossway's narration can't be reached, the device voice reads Scripture instead.
audioEl.addEventListener("error", () => {
  if (!reader.playing || audioEl.getAttribute("src") !== reader.loadedSrc) return;
  reader.swapping = false;
  reader.loadedSrc = null;
  if (reader.queue[reader.i]?.narrated) {
    reader.scriptureSrc = null;
    reader.collect();
    reader.i = 0;
    reader.speak();
  } else reader.pause();
});
// Paused from the lock screen, Control Center or headphones.
audioEl.addEventListener("pause", () => {
  if (reader.mode === "audio" && reader.playing && !audioEl.ended && !reader.swapping) { reader.playing = false; reader.keepAwake(false); reader.update(); }
});
audioEl.addEventListener("play", () => {
  if (reader.mode === "audio" && !reader.playing) { reader.playing = true; reader.update(); }
});

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M11 6v12L3 12zM20 6v12l-8-6z" fill="currentColor"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M13 6v12l8-6zM4 6v12l8-6z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8"/></svg>',
};

// ---------- Wiring ----------

function initPlayer() {
  document.getElementById("pl-prev").innerHTML = ICONS.back;
  document.getElementById("pl-next").innerHTML = ICONS.fwd;
  document.getElementById("pl-close").innerHTML = ICONS.close;
  document.getElementById("pl-play").addEventListener("click", () => reader.toggle());
  document.getElementById("pl-prev").addEventListener("click", () => reader.skip(-1));
  document.getElementById("pl-next").addEventListener("click", () => reader.skip(1));
  document.getElementById("pl-prev-sec").addEventListener("click", () => reader.skipSection(-1));
  document.getElementById("pl-next-sec").addEventListener("click", () => reader.skipSection(1));
  document.getElementById("pl-speed").addEventListener("click", () => reader.cycleSpeed());
  document.getElementById("pl-close").addEventListener("click", () => reader.close());

  // While the player is open, tapping a sentence starts reading from it.
  document.getElementById("screen").addEventListener("click", (e) => {
    const s = e.target.closest(".s");
    if (!s || document.getElementById("player").hidden) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text
    reader.collect();
    const block = s.closest("[data-read]");
    const at = reader.queue.findIndex((q) => q.el === s || (q.narrated && block?.contains(q.el)));
    if (at < 0) return;
    reader.playing = true;
    reader.keepAwake(true);
    reader.goTo(at);
  });

  // Don't fight the reader's own scrolling: pause follow-along briefly when they scroll.
  const pauseFollow = () => { reader.followPausedUntil = Date.now() + 5000; };
  window.addEventListener("touchmove", pauseFollow, { passive: true });
  window.addEventListener("wheel", pauseFollow, { passive: true });

  // The device voice stops when the app is hidden; the recording carries on.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && reader.playing && reader.mode === "speech") reader.pause();
  });
}
