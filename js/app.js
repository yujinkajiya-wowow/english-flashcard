(function () {
  const { Storage, Scheduler, IPA, Swipe, haptic, Explain } = window.DF;
  const $ = (id) => document.getElementById(id);
  const TODAY = Scheduler.today();
  const LOCK_AFTER_COMMIT = 500;
  // 開発中は結果画面に「もう一度」ボタンを出す。本番公開するときは false にする
  const DEV = true;

  Storage.seedIfEmpty(TODAY);

  /* =========================================================
   * ルーティング（#/flash, #/add, #/list）
   * ========================================================= */
  let route = "flash";
  function go() {
    route = (location.hash.replace("#/", "") || "flash").split("?")[0];
    if (!["flash", "add", "test", "list"].includes(route)) route = "flash";
    for (const v of ["flash", "add", "test", "list"]) $("view-" + v).hidden = v !== route;
    Explain.close();
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
    if (route === "flash") enterFlash();
    if (route === "list") renderList();
    if (route === "test") window.DF.Test.enter();
    if (route === "add") {
      renderAdded();
      $("add-word").focus();
    }
  }
  window.addEventListener("hashchange", go);

  /* =========================================================
   * デイリーフラッシュ
   * ========================================================= */
  const card = $("card");
  const wrap = $("card-wrap");
  let session = null;
  let busy = false;

  const swipe = new Swipe({
    target: wrap,
    card,
    glowLeft: $("glow-left"),
    glowRight: $("glow-right"),
    onCommit: (dir) => answer(dir),
    isInverted: () => Storage.getSettings().invert,
    isEnabled: () =>
      route === "flash" && !!session && session.queue.length > 0 && !$("stage").hidden && !Explain.isOpen(),
  });

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newSession() {
    const { review, fresh } = Scheduler.buildToday(Storage.getWords(), TODAY);
    // 復習を先に、新規を後に（それぞれの中はシャッフル）
    const queue = shuffle(review).concat(shuffle(fresh));
    return { date: TODAY, queue, first: {}, cleared: 0 };
  }

  function hasMoreToday() {
    const { review, fresh } = Scheduler.buildToday(Storage.getWords(), TODAY);
    return review.length + fresh.length > 0;
  }

  function enterFlash() {
    let s = Storage.getSession();
    const day = Storage.getDays()[TODAY];
    if (!s || s.date !== TODAY || s.queue.length === 0) {
      // 今日まだやっていなければ自動で開始。終わっていたら結果画面
      if (day && day.total > 0) {
        session = s && s.date === TODAY ? s : null;
        return showResult();
      }
      s = newSession();
      Storage.saveSession(s);
    }
    session = s;
    // 削除された単語を除外
    const ids = new Set(Storage.getWords().map((w) => w.id));
    session.queue = session.queue.filter((id) => ids.has(id));
    if (session.queue.length === 0) return showResult();
    showStage();
    showCard();
  }

  function showStage() {
    $("stage").hidden = false;
    $("result").hidden = true;
    $("session-progress").parentElement.parentElement.hidden = false;
  }

  function updateProgress() {
    const left = session ? session.queue.length : 0;
    const done = session ? session.cleared : 0;
    $("remaining-count").textContent = left;
    $("session-progress").style.width = (done + left ? (done / (done + left)) * 100 : 100) + "%";
  }

  function showCard() {
    const w = Storage.getWord(session.queue[0]);
    if (!w) {
      session.queue.shift();
      Storage.saveSession(session);
      return session.queue.length ? showCard() : finish();
    }
    // 裏返しを一瞬で戻す
    card.style.transition = "none";
    card.classList.remove("flipped");
    void card.offsetWidth;
    card.style.transition = "";

    // 初めて出てくる単語は、自分で打ってなぞる。スワイプはどちらでも紫
    const isNew = !w.introducedDate;
    $("view-flash").classList.toggle("is-new", isNew);
    typing = isNew ? { word: w.word, pos: skipSymbols(w.word, 0), done: false } : null;
    renderWord(w.word);
    $("card-ipa").textContent = w.ipa || "";
    $("card-meaning").textContent = w.meaning;
    swipe.reset();
    wrap.style.transform = "";
    wrap.classList.remove("enter");
    void wrap.offsetWidth;
    wrap.classList.add("enter");
    // 付けっぱなしにすると、後で他のアニメーションを外したときに登場アニメが再生され直す
    wrap.addEventListener("animationend", () => wrap.classList.remove("enter"), { once: true });
    updateProgress();
  }

  /* ---------- 新しい単語のタイピング ----------
     打った文字だけ黒くなる。英数字以外（空白・ハイフン・アポストロフィ）は打たなくていい */
  let typing = null;
  const isTypable = (ch) => /[a-z0-9]/i.test(ch);
  function skipSymbols(word, pos) {
    while (pos < word.length && !isTypable(word[pos])) pos++;
    return pos;
  }

  function renderWord(word) {
    const el = $("card-word");
    el.classList.toggle("typing", !!typing && !typing.done);
    if (!typing) return (el.textContent = word);
    el.innerHTML = "";
    const typed = document.createElement("span");
    typed.className = "typed";
    typed.textContent = word.slice(0, typing.pos);
    const rest = document.createElement("span");
    rest.className = "ghost";
    rest.textContent = word.slice(typing.pos);
    el.append(typed, rest);
  }

  function typeKey(e) {
    if (!typing || typing.done || card.classList.contains("flipped")) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const { word } = typing;
    if (e.key === "Backspace") {
      let pos = typing.pos;
      while (pos > 0 && !isTypable(word[pos - 1])) pos--;
      typing.pos = Math.max(0, pos - 1);
      renderWord(word);
      return true;
    }
    if (e.key.length !== 1 || !isTypable(e.key)) return false;
    if (e.key.toLowerCase() === word[typing.pos].toLowerCase()) {
      typing.pos = skipSymbols(word, typing.pos + 1);
      if (typing.pos >= word.length) {
        typing.done = true;
        haptic("tick");
        const el = $("card-word");
        el.classList.remove("done");
        void el.offsetWidth;
        el.classList.add("done");
        // 打ち終わったら少し置いて意味を見せる
        setTimeout(() => {
          if (typing && typing.done && !card.classList.contains("flipped")) flip();
        }, 450);
      }
    } else {
      const el = $("card-word");
      el.classList.remove("miss");
      void el.offsetWidth;
      el.classList.add("miss");
    }
    renderWord(word);
    return true;
  }

  function flip() {
    if (busy || !session || !session.queue.length) return;
    card.classList.toggle("flipped");
  }

  async function answer(dir) {
    if (busy || !session || !session.queue.length) return;
    busy = true;
    swipe.cancel();
    swipe.lock(60_000);
    // 左 = 覚えている / 右 = 覚えていない。初めて出てきた単語はどちらでも "new"（判定しない）
    const result = typing ? "new" : dir === "left" ? "ok" : "ng";
    haptic(result === "ng" ? "ng" : "ok");
    typing = null;

    const id = session.queue.shift();
    if (!(id in session.first)) {
      // 復習スケジュールはこのセッションで最初に答えた結果で決める
      session.first[id] = result;
      const w = Storage.getWord(id);
      if (w) Storage.updateWord(id, Scheduler.apply(w, result, TODAY));
      const day = Storage.getDays()[TODAY] || { correct: 0, total: 0 };
      Storage.updateDay(TODAY, {
        total: day.total + 1,
        correct: day.correct + (result === "ok" ? 1 : 0),
      });
    }
    if (result === "ng") {
      // 3〜5枚後にもう一度
      const pos = Math.min(session.queue.length, 3 + Math.floor(Math.random() * 3));
      session.queue.splice(pos, 0, id);
    } else {
      session.cleared++;
    }
    Storage.saveSession(session);
    updateProgress();

    await swipe.flyOut(dir);
    busy = false;
    swipe.lockedUntil = 0;
    swipe.lock(LOCK_AFTER_COMMIT); // 勢いで次のカードまで流れないように
    if (session.queue.length) showCard();
    else finish();
  }

  function finish() {
    Storage.updateDay(TODAY, { completed: true });
    showResult();
  }

  function showResult() {
    $("stage").hidden = true;
    $("result").hidden = false;
    swipe.reset();
    wrap.style.transform = "";
    const day = Storage.getDays()[TODAY] || { correct: 0, total: 0 };
    window.DF.Summary.render(TODAY);
    $("remaining-count").textContent = 0;
    $("session-progress").style.width = "100%";
    const more = hasMoreToday();
    $("res-more").hidden = !more;
    $("res-again").hidden = !DEV;
    $("res-note").textContent = day.total ? "" : "今日出題する単語はありません。単語を追加してください";
  }

  $("res-more").addEventListener("click", () => {
    session = newSession();
    Storage.saveSession(session);
    if (!session.queue.length) return showResult();
    showStage();
    showCard();
  });

  // 今日の回答をなかったことにして最初からやり直す（スケジュール・正答数も巻き戻る）
  $("res-again").addEventListener("click", () => {
    Storage.saveWords(Storage.getWords().map((w) => Scheduler.rewind(w, TODAY)));
    Storage.setDay(TODAY, null);
    Storage.clearSession();
    session = null;
    enterFlash();
  });

  card.addEventListener("click", () => {
    if (swipe.dragged) return; // ドラッグ後のクリックは無視
    flip();
  });

  $("ai-btn").addEventListener("click", (e) => {
    e.stopPropagation(); // カードが裏返らないように
    if (session && session.queue.length) Explain.open(session.queue[0]);
  });

  window.addEventListener("keydown", (e) => {
    if (route !== "flash" || $("stage").hidden || Explain.isOpen()) return;
    if (e.target.matches("input, textarea")) return;
    if (typeKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      flip();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (swipe.locked || busy) return;
      answer(e.key === "ArrowLeft" ? "left" : "right");
    }
  });

  /* =========================================================
   * 単語の追加
   * ========================================================= */
  function parseLines(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.+?)\s*[,，、\t]\s*(.+)$/);
        return m ? [m[1].trim(), m[2].trim()] : null;
      })
      .filter(Boolean);
  }

  /*
   * 英単語 → Enter → 日本語訳 → Enter で1語追加し、次の行へ。
   * 「英単語,日本語」を何行か英単語欄に貼り付けると、まとめて追加する。
   * 追加した単語は入力欄の上に、追加した順に並べる（この画面を開いている間のぶん）
   */
  let lastAdded = [];
  let flashId = null;
  function renderAdded() {
    const ul = $("added-list");
    ul.innerHTML = "";
    for (const id of lastAdded) {
      const w = Storage.getWord(id);
      if (!w) continue;
      const li = document.createElement("li");
      if (id === flashId) li.className = "is-new";
      const ipa = w.ipaStatus === "pending" ? "発音記号を取得中…" : w.ipaStatus === "none" ? "" : w.ipa;
      li.innerHTML = `<div><span class="en"></span><span class="ipa"></span></div><span class="ja"></span>`;
      li.querySelector(".en").textContent = w.word;
      li.querySelector(".ipa").textContent = ipa;
      li.querySelector(".ja").textContent = w.meaning;
      ul.appendChild(li);
    }
    flashId = null;
  }

  function addMessage(text) {
    $("add-msg").textContent = text || "";
  }

  function addPairs(pairs) {
    const added = Storage.addWords(pairs, TODAY);
    lastAdded = lastAdded.concat(added.map((w) => w.id)).slice(-100);
    flashId = added.length === 1 ? added[0].id : null;
    renderAdded();
    IPA.fillMissing(() => {
      renderAdded();
      if (route === "list") renderList();
    });
    return added.length;
  }

  const wordInput = $("add-word");
  const meaningInput = $("add-meaning");
  // 日本語入力の変換確定の Enter では進まない
  const isEnter = (e) => e.key === "Enter" && !e.isComposing && e.keyCode !== 229;

  wordInput.addEventListener("keydown", (e) => {
    if (!isEnter(e)) return;
    e.preventDefault();
    if (wordInput.value.trim()) meaningInput.focus();
  });

  meaningInput.addEventListener("keydown", (e) => {
    // 空のまま Backspace で英単語欄に戻る
    if (e.key === "Backspace" && !meaningInput.value) {
      e.preventDefault();
      wordInput.focus();
      return;
    }
    if (!isEnter(e)) return;
    e.preventDefault();
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();
    if (!word) return wordInput.focus();
    if (!meaning) return;
    if (addPairs([[word, meaning]])) {
      wordInput.value = "";
      meaningInput.value = "";
      addMessage("");
      wordInput.focus();
    } else {
      addMessage(`「${word}」はもう登録されています`);
      wordInput.focus();
      wordInput.select();
    }
  });

  // 「英単語,日本語」の行を貼り付けたら、まとめて追加
  wordInput.addEventListener("paste", (e) => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    const pairs = parseLines(text);
    if (!pairs.length) return; // ふつうの単語の貼り付け
    e.preventDefault();
    const n = addPairs(pairs);
    const skipped = pairs.length - n;
    addMessage(`${n}語追加しました` + (skipped ? `（${skipped}語は登録済みのためスキップ）` : ""));
    wordInput.value = "";
    meaningInput.value = "";
  });

  wordInput.addEventListener("input", () => addMessage(""));

  /* =========================================================
   * 単語一覧
   * ========================================================= */
  function renderList() {
    const words = Storage.getWords();
    const tbody = $("list-body");
    tbody.innerHTML = "";
    const mastered = words.filter((w) => w.mastered).length;
    const queued = words.filter((w) => !w.introducedDate).length;
    $("list-summary").textContent = `${words.length}語 ・ 未出題 ${queued} ・ 習得済み ${mastered}`;

    const sorted = words.slice().sort((a, b) => (b.addedDate || "").localeCompare(a.addedDate || ""));
    for (const w of sorted) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input class="en" data-f="word"></td>
        <td class="ipa-cell"><input data-f="ipa"></td>
        <td><input class="ja" data-f="meaning"></td>
        <td class="meta"></td>
        <td class="meta"></td>
        <td><button class="link del" title="削除">削除</button></td>`;
      const [wi, ii, mi] = tr.querySelectorAll("input");
      wi.value = w.word;
      ii.value = w.ipa || "";
      ii.placeholder = w.ipaStatus === "pending" ? "取得中…" : "手入力";
      mi.value = w.meaning;
      tr.children[3].textContent = Scheduler.stageLabel(w);
      tr.children[4].textContent = w.mastered ? "—" : w.nextReviewDate || "次の新規枠";
      tr.addEventListener("change", (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const patch = { [f]: e.target.value.trim() };
        if (f === "ipa") patch.ipaStatus = "manual";
        if (f === "word" || f === "meaning") patch.ai = null; // 解説を作り直す
        Storage.updateWord(w.id, patch);
      });
      tr.querySelector(".del").addEventListener("click", () => {
        if (!confirm(`「${w.word}」を削除しますか？`)) return;
        Storage.deleteWord(w.id);
        renderList();
      });
      tbody.appendChild(tr);
    }
  }

  const settings = Storage.getSettings();
  $("opt-sound").checked = settings.sound;
  $("opt-invert").checked = settings.invert;
  $("opt-sound").addEventListener("change", (e) => Storage.saveSettings({ sound: e.target.checked }));
  $("opt-invert").addEventListener("change", (e) => Storage.saveSettings({ invert: e.target.checked }));
  $("opt-apikey").value = settings.apiKey;
  $("opt-apikey").addEventListener("change", (e) => Storage.saveSettings({ apiKey: e.target.value.trim() }));
  $("export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(Storage.exportAll(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daily-flash-${TODAY}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ---------- 起動 ---------- */
  go();
  IPA.fillMissing((id) => {
    if (route === "list") renderList();
    if (route === "flash" && session && session.queue[0] === id) {
      const w = Storage.getWord(id);
      if (w) $("card-ipa").textContent = w.ipa || "";
    }
  });
})();
