(function () {
  const { Storage, Scheduler, IPA, Swipe, haptic } = window.DF;
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
    if (!["flash", "add", "list"].includes(route)) route = "flash";
    for (const v of ["flash", "add", "list"]) $("view-" + v).hidden = v !== route;
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
    if (route === "flash") enterFlash();
    if (route === "list") renderList();
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
    isEnabled: () => route === "flash" && !!session && session.queue.length > 0 && !$("stage").hidden,
  });

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newSession() {
    Storage.saveSnapshotIfNone(TODAY);
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

    $("card-word").textContent = w.word;
    $("card-ipa").textContent = w.ipa || "";
    $("card-meaning").textContent = w.meaning;
    swipe.reset();
    wrap.style.transform = "";
    wrap.classList.remove("enter");
    void wrap.offsetWidth;
    wrap.classList.add("enter");
    updateProgress();
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
    // 左 = 覚えている / 右 = 覚えていない
    const result = dir === "left" ? "ok" : "ng";
    haptic(result);

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
    const words = Storage.getWords();
    const days = Storage.getDays();
    const day = days[TODAY] || { correct: 0, total: 0 };
    $("res-correct").textContent = day.total ? `${day.correct}/${day.total}` : "0";
    $("res-tomorrow").textContent = Scheduler.dueCountOn(words, Scheduler.addDays(TODAY, 1));
    $("res-streak").textContent = Scheduler.streak(days, TODAY);
    $("remaining-count").textContent = 0;
    $("session-progress").style.width = "100%";
    const more = hasMoreToday();
    $("res-more").hidden = !more;
    $("res-again").hidden = !DEV;
    $("res-note").textContent = day.total
      ? "正答は各単語の1回目の回答で数えています"
      : "今日出題する単語はありません。単語を追加してください";
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
    Storage.restoreSnapshot(TODAY);
    session = null;
    enterFlash();
  });

  card.addEventListener("click", () => {
    if (swipe.dragged) return; // ドラッグ後のクリックは無視
    flip();
  });

  window.addEventListener("keydown", (e) => {
    if (route !== "flash" || $("stage").hidden) return;
    if (e.target.matches("input, textarea")) return;
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

  let lastAdded = [];
  function renderAdded() {
    const ul = $("added-list");
    ul.innerHTML = "";
    for (const id of lastAdded) {
      const w = Storage.getWord(id);
      if (!w) continue;
      const li = document.createElement("li");
      const ipa =
        w.ipaStatus === "pending" ? "取得中…" : w.ipaStatus === "none" ? "発音記号なし（一覧で入力できます）" : w.ipa;
      li.innerHTML = `<span class="en"></span><span class="ipa"></span><span class="ja"></span>`;
      li.children[0].textContent = w.word;
      li.children[1].textContent = ipa;
      li.children[2].textContent = w.meaning;
      ul.appendChild(li);
    }
  }

  function addPairs(pairs) {
    const added = Storage.addWords(pairs, TODAY);
    lastAdded = added.map((w) => w.id).concat(lastAdded).slice(0, 50);
    renderAdded();
    IPA.fillMissing(() => {
      renderAdded();
      if (route === "list") renderList();
    });
    return added.length;
  }

  $("add-single").addEventListener("submit", (e) => {
    e.preventDefault();
    const word = $("add-word").value.trim();
    const meaning = $("add-meaning").value.trim();
    if (!word || !meaning) return;
    if (addPairs([[word, meaning]])) {
      $("add-word").value = "";
      $("add-meaning").value = "";
      $("add-word").focus();
    } else {
      alert("その単語はもう登録されています");
    }
  });

  $("add-bulk").addEventListener("submit", (e) => {
    e.preventDefault();
    const pairs = parseLines($("add-bulk-text").value);
    if (!pairs.length) return;
    const n = addPairs(pairs);
    $("add-bulk-text").value = "";
    if (n < pairs.length) alert(`${n}件追加しました（${pairs.length - n}件は重複のためスキップ）`);
  });

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
