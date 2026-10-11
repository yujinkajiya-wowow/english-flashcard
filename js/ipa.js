/*
 * 発音記号の自動取得（Free Dictionary API）
 * 取れたら保存して、次からは API を叩かない。
 */
(function () {
  const ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";

  async function lookup(word) {
    const res = await fetch(ENDPOINT + encodeURIComponent(word.toLowerCase()));
    if (res.status === 404) return "";
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    for (const entry of data) {
      if (entry.phonetic) return normalize(entry.phonetic);
      const p = (entry.phonetics || []).find((x) => x.text);
      if (p) return normalize(p.text);
    }
    return "";
  }

  function normalize(s) {
    s = s.trim();
    if (!s) return "";
    if (!s.startsWith("/") && !s.startsWith("[")) s = "/" + s + "/";
    return s;
  }

  /* ipaStatus が pending の単語だけ順番に取りにいく。1件ごとに保存 */
  let running = false;
  async function fillMissing(onUpdate) {
    if (running) return;
    running = true;
    try {
      const { Storage } = window.DF;
      const targets = Storage.getWords().filter((w) => w.ipaStatus === "pending");
      for (const w of targets) {
        try {
          const ipa = await lookup(w.word);
          const cur = Storage.getWord(w.id);
          if (!cur || cur.ipaStatus !== "pending") continue; // 途中で手入力された
          Storage.updateWord(w.id, { ipa, ipaStatus: ipa ? "ok" : "none" });
          onUpdate && onUpdate(w.id);
        } catch (e) {
          // ネットワークエラーは pending のまま残して次回再挑戦
          console.warn("IPA取得失敗:", w.word, e);
        }
      }
    } finally {
      running = false;
    }
  }

  window.DF = window.DF || {};
  window.DF.IPA = { lookup, fillMissing };
})();
