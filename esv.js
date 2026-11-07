// ESV API (api.esv.org) — fetches one passage at a time and keeps only a few recent ones,
// staying well inside Crossway's limits on stored text.

const ESV_CACHE_LIMIT = 10;

const ESV_COPYRIGHT =
  "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), " +
  "© 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. " +
  "The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. " +
  "The ESV may not be translated into any other language. " +
  "Users may not copy or download more than 500 verses of the ESV Bible or more than one half of any book of the ESV Bible.";

async function fetchPassage(reference, key) {
  const params = new URLSearchParams({
    q: reference,
    "include-passage-references": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-footnotes": "false",
    "include-headings": "true",
    "include-short-copyright": "false",
    "indent-poetry": "true",
  });
  const res = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
    headers: { Authorization: `Token ${key}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error("key");
  if (!res.ok) throw new Error("http");
  const json = await res.json();
  if (!json.passages?.length) throw new Error("notfound");
  return json.passages.join("\n\n").trim();
}

// Returns { text } or { error: "nokey" | "key" | "offline" | "notfound" | "http" }.
async function getPassage(reference) {
  const cache = store.get("esvCache", []);
  const hit = cache.find((c) => c.ref === reference);
  if (hit) return { text: hit.text };

  const key = store.get("esvKey", "");
  if (!key) return { error: "nokey" };

  try {
    const text = await fetchPassage(reference, key);
    const next = [{ ref: reference, text }, ...cache.filter((c) => c.ref !== reference)];
    store.set("esvCache", next.slice(0, ESV_CACHE_LIMIT));
    return { text };
  } catch (e) {
    if (!navigator.onLine) return { error: "offline" };
    // A rejected key comes back without browser-access headers, so it looks like a network failure.
    return { error: e instanceof TypeError ? "unreachable" : e.message };
  }
}

// Escapes the passage and wraps each verse in a span (for read-aloud), with a small verse number.
function formatPassage(text) {
  const tidy = text.replace(/^[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return tidy.split(/(?=\[\d+\])/).map((part) => {
    const m = part.match(/^\[(\d+)\]\s*/);
    const body = m ? part.slice(m[0].length) : part;
    const [, core, trailing] = body.match(/^([\s\S]*?)(\s*)$/);
    const num = m ? `<sup class="vnum">${m[1]}</sup>` : "";
    const say = core.replace(/\s+/g, " ").trim();
    if (!say) return num + esc(body);
    return `${num}<span class="s" data-say="${esc(say)}">${esc(core)}</span>${esc(trailing)}`;
  }).join("");
}
