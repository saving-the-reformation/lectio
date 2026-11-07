// Account sign-in and syncing through Supabase, using its plain web API.
// The publishable key below is meant to be public; the table only lets each account reach its own row.
// Every note, completed day and favorite carries its own timestamp, so two devices can't overwrite
// each other's work: the newest change to each item wins, and deletions are remembered.
// Your ESV key and reading settings stay on each device. Uses: store (app.js).

const SUPABASE_URL = "https://qdonrszvxnsapnibkrkm.supabase.co";
const SUPABASE_KEY = "sb_publishable_O9QBkLqpkbkt8saGrmMA9g_N3AKFUhE";
const SYNCED_KEYS = ["completed", "notes", "notesDates", "favorites"];

const account = {
  syncing: false,
  again: false,
  timer: null,
  lastError: "",

  get session() { return store.get("session", null); },
  get signedIn() { return !!this.session; },

  async auth(path, body) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.msg || json.message || json.error_description || `Error ${res.status}`);
    return json;
  },

  remember(json) {
    store.set("session", {
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
      user: json.user.id,
      email: json.user.email,
    });
  },

  // Returns true if signed in, false if the email must be confirmed first.
  async signUp(email, password) {
    const json = await this.auth("signup", { email, password });
    if (json.access_token) { this.remember(json); return true; }
    return false;
  },

  async signIn(email, password) {
    this.remember(await this.auth("token?grant_type=password", { email, password }));
    await this.sync();
  },

  async signOut() {
    const s = this.session;
    store.set("session", null);
    store.set("syncShadow", {});
    store.set("syncStamps", {});
    if (s) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access}` },
      }).catch(() => {});
    }
  },

  async token() {
    let s = this.session;
    if (Date.now() > s.expires - 60000) {
      this.remember(await this.auth("token?grant_type=refresh_token", { refresh_token: s.refresh }));
      s = this.session;
    }
    return s.access;
  },

  async rest(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`Sync error ${res.status}`);
    return res.status === 204 || res.status === 201 ? null : res.json();
  },

  // ---------- Items ----------
  flatten() {
    const flat = {};
    for (const [date, id] of Object.entries(store.get("completed", {}))) flat[`c/${date}`] = id;
    for (const [id, text] of Object.entries(store.get("notes", {}))) if (text.trim()) flat[`n/${id}`] = text;
    for (const [id, date] of Object.entries(store.get("notesDates", {}))) flat[`d/${id}`] = date;
    for (const id of store.get("favorites", [])) flat[`f/${id}`] = true;
    return flat;
  },

  unflatten(flat) {
    const completed = {}, notes = {}, notesDates = {}, favorites = [];
    for (const [key, value] of Object.entries(flat)) {
      const kind = key[0], name = key.slice(2);
      if (kind === "c") completed[name] = value;
      else if (kind === "n") notes[name] = value;
      else if (kind === "d") notesDates[name] = value;
      else if (kind === "f") favorites.push(name);
    }
    store.save("completed", completed);
    store.save("notes", notes);
    store.save("notesDates", notesDates);
    store.save("favorites", favorites);
  },

  // Stamps whatever changed here since the last sync, as {value, time}; a deletion has value null.
  localItems() {
    const flat = this.flatten();
    const shadow = store.get("syncShadow", {});
    const items = store.get("syncStamps", {});
    // The first sync on a device has no history: its data fills gaps but doesn't outrank the account.
    const now = Object.keys(items).length ? Date.now() : 1;
    for (const key of new Set([...Object.keys(flat), ...Object.keys(shadow)])) {
      if (flat[key] !== shadow[key]) items[key] = { v: flat[key] ?? null, t: now };
    }
    return items;
  },

  // ---------- Sync ----------
  async sync() {
    if (!this.signedIn || !navigator.onLine) return;
    if (this.syncing) { this.again = true; return; }
    this.syncing = true;
    try {
      const rows = await this.rest("lectio_state?select=data");
      const remote = rows[0]?.data?.items ?? {};
      const merged = this.localItems();
      let incoming = false, outgoing = false;

      for (const [key, item] of Object.entries(remote)) {
        if (!merged[key] || item.t > merged[key].t) { merged[key] = item; incoming = true; }
      }
      for (const [key, item] of Object.entries(merged)) {
        if (!remote[key] || item.t > remote[key].t) outgoing = true;
      }

      const flat = {};
      for (const [key, item] of Object.entries(merged)) if (item.v !== null) flat[key] = item.v;

      if (incoming) this.unflatten(flat);
      store.save("syncStamps", merged);
      store.save("syncShadow", flat);

      if (outgoing) {
        await this.rest("lectio_state?on_conflict=user_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            user_id: this.session.user,
            data: { items: merged },
            updated_at: new Date().toISOString(),
          }),
        });
      }
      store.save("lastSync", Date.now());
      this.lastError = "";
      if (incoming) document.dispatchEvent(new Event("lectiosynced"));
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this.syncing = false;
      if (this.again) { this.again = false; this.sync(); }
    }
  },

  soon() {
    if (!this.signedIn) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.sync(); }, 1500);
  },
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" || account.timer) account.sync();
});
window.addEventListener("online", () => account.sync());
