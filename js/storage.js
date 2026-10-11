/*
 * 保存処理はすべてこのモジュールに閉じ込める。
 * 後で DB / API に移すときは、このファイルの中身だけ差し替えればいい。
 * （今は同期 API。非同期にするなら呼び出し側を async にする）
 */
(function () {
  const KEY = {
    words: "df.words",
    session: "df.session",
    days: "df.days",
    settings: "df.settings",
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("保存に失敗しました", e);
    }
  }

  const SEED = [
    ["brad", "無頭くぎ"], ["chamber", "会議場"], ["chore", "雑用"],
    ["scholarship", "奨学金"], ["nevertheless", "それにもかかわらず"], ["goddess", "女神"],
    ["northern", "北部の"], ["detect", "見つける"], ["manufacture", "製造する"],
    ["attempt", "試みる"], ["sander", "研磨機"], ["vend", "売る"],
    ["nelson", "首攻め"], ["oppose", "反対する"], ["colleague", "同僚"],
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const Storage = {
    /* ---- 単語 ---- */
    getWords() {
      return read(KEY.words, null) || [];
    },
    saveWords(words) {
      write(KEY.words, words);
    },
    getWord(id) {
      return this.getWords().find((w) => w.id === id) || null;
    },
    updateWord(id, patch) {
      const words = this.getWords();
      const i = words.findIndex((w) => w.id === id);
      if (i < 0) return null;
      words[i] = Object.assign({}, words[i], patch);
      this.saveWords(words);
      return words[i];
    },
    addWords(pairs, today) {
      const words = this.getWords();
      const existing = new Set(words.map((w) => w.word.toLowerCase()));
      const added = [];
      for (const [word, meaning] of pairs) {
        const key = word.toLowerCase();
        if (!word || !meaning || existing.has(key)) continue;
        existing.add(key);
        const w = {
          id: uid(),
          word,
          ipa: "",
          meaning,
          addedDate: today,       // 登録した日
          introducedDate: null,   // 初めて出題された日（＝忘却曲線の0日目）。null は未出題
          stage: 0,
          nextReviewDate: null,   // null は「新規の待ち行列」にいる
          mastered: false,
          ipaStatus: "pending",   // pending | ok | none | manual
          history: [],            // { date, result: "ok"|"ng", stage }
        };
        words.push(w);
        added.push(w);
      }
      this.saveWords(words);
      return added;
    },
    deleteWord(id) {
      this.saveWords(this.getWords().filter((w) => w.id !== id));
    },
    seedIfEmpty(today) {
      if (localStorage.getItem(KEY.words) != null) return false;
      this.addWords(SEED, today);
      return true;
    },

    /* ---- その日のセッション（リロードしても続きから） ---- */
    clearSession() {
      write(KEY.session, null);
    },
    getSession() {
      return read(KEY.session, null);
    },
    saveSession(s) {
      write(KEY.session, s);
    },

    /* ---- 日ごとの記録（正答数・連続日数） ---- */
    getDays() {
      return read(KEY.days, {});
    },
    updateDay(date, patch) {
      const days = this.getDays();
      days[date] = Object.assign({ correct: 0, total: 0, completed: false }, days[date], patch);
      write(KEY.days, days);
      return days[date];
    },

    setDay(date, value) {
      const days = this.getDays();
      if (value) days[date] = value;
      else delete days[date];
      write(KEY.days, days);
    },

    /* ---- 設定 ---- */
    getSettings() {
      return Object.assign({ sound: true, invert: false, apiKey: "" }, read(KEY.settings, {}));
    },
    saveSettings(patch) {
      const s = Object.assign(this.getSettings(), patch);
      write(KEY.settings, s);
      return s;
    },

    exportAll() {
      return {
        words: this.getWords(),
        days: this.getDays(),
        settings: Object.assign({}, this.getSettings(), { apiKey: undefined }), // キーは書き出さない
        exportedAt: new Date().toISOString(),
      };
    },
  };

  window.DF = window.DF || {};
  window.DF.Storage = Storage;
})();
