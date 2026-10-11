/*
 * テスト：今日の単語（今日答えた復習・新規 + まだ残っている分）から出題する。
 *   単語記述：日本語訳を見て英単語を書く（完全一致。大文字小文字・前後の空白は無視）
 *   単語選択：4択から選ぶ
 *   文章翻訳：AI 採点（デザイン待ち。未実装）
 * 正解はカードが左へ、不正解は右へ飛ぶ（フラッシュカードと同じ）。
 * 結果は復習スケジュールには反映しない。
 */
(function () {
  const { Storage, Scheduler, haptic } = window.DF;
  const $ = (id) => document.getElementById(id);
  const wrap = $("t-wrap");
  const FLY_MS = 380;
  const SHOW_OK_MS = 450;   // 正解の色を見せてから飛ばすまで
  const SHOW_NG_MS = 1300;  // 不正解は正解を確認する時間を少し長めに

  let test = null;          // { items: [{id, type, choices}], index, results: [{id, ok}] }
  let busy = false;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* 今日の単語 = 今日回答した単語 + 今日のセッションにまだ残っている単語。まだ何もしていなければ今日出題予定の単語 */
  function todayIds() {
    const today = Scheduler.today();
    const words = Storage.getWords();
    const ids = new Set(words.filter((w) => (w.history || []).some((h) => h.date === today)).map((w) => w.id));
    const s = Storage.getSession();
    if (s && s.date === today) for (const id of s.queue) ids.add(id);
    if (!ids.size) {
      const { review, fresh } = Scheduler.buildToday(words, today);
      for (const id of review.concat(fresh)) ids.add(id);
    }
    const exists = new Set(words.map((w) => w.id));
    return [...ids].filter((id) => exists.has(id));
  }

  function build() {
    const all = Storage.getWords();
    const items = shuffle(todayIds()).map((id) => {
      const others = shuffle(all.filter((w) => w.id !== id)).slice(0, 3).map((w) => w.id);
      // 選択肢が作れないほど単語が少ないときは記述だけ
      const type = others.length >= 1 && Math.random() < 0.5 ? "choice" : "write";
      return { id, type, choices: type === "choice" ? shuffle(others.concat(id)) : null };
    });
    return { items, index: 0, results: [] };
  }

  function enter() {
    if (!test) test = build();
    if (!test.items.length) return showResult();
    if (test.index >= test.items.length) return showResult();
    $("t-stage").hidden = false;
    $("t-result").hidden = true;
    showQuestion();
  }

  function normalize(s) {
    return s.trim().replace(/\s+/g, " ").toLowerCase();
  }

  function updateProgress() {
    const left = test.items.length - test.index;
    $("t-remaining").textContent = left;
    $("t-progress").style.width = (test.items.length ? (test.index / test.items.length) * 100 : 100) + "%";
  }

  function showQuestion() {
    const item = test.items[test.index];
    const w = Storage.getWord(item.id);
    if (!w) {
      test.index++;
      return test.index < test.items.length ? showQuestion() : showResult();
    }
    busy = false;
    wrap.classList.remove("fly");
    wrap.style.transform = "";
    wrap.classList.remove("enter");
    void wrap.offsetWidth;
    wrap.classList.add("enter");
    wrap.addEventListener("animationend", () => wrap.classList.remove("enter"), { once: true });
    glow(null);

    $("t-question").textContent = w.meaning;
    const write = item.type === "write";
    $("t-write").hidden = !write;
    $("t-choices").hidden = write;

    if (write) {
      const input = $("t-input");
      input.value = "";
      input.disabled = false;
      input.className = "t-input en";
      $("t-correct").textContent = "";
      input.focus();
      $("t-hint").textContent = "英単語を入力して Enter";
    } else {
      const box = $("t-choices");
      box.innerHTML = "";
      item.choices.forEach((cid, i) => {
        const c = Storage.getWord(cid);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "t-choice en";
        b.textContent = c ? c.word : "";
        b.dataset.id = cid;
        b.addEventListener("click", () => choose(cid));
        box.appendChild(b);
        if (i === 0) box.appendChild(Object.assign(document.createElement("span"), { className: "t-break" }));
      });
      $("t-hint").textContent = "クリック、または 1〜4 キーで選ぶ";
    }
    updateProgress();
  }

  function submitWrite() {
    if (busy) return;
    const input = $("t-input");
    if (!input.value.trim()) return;
    const w = Storage.getWord(test.items[test.index].id);
    const ok = normalize(input.value) === normalize(w.word);
    input.disabled = true;
    input.classList.add(ok ? "is-ok" : "is-ng");
    if (!ok) $("t-correct").textContent = w.word;
    judge(ok);
  }

  function choose(cid) {
    if (busy) return;
    const item = test.items[test.index];
    const ok = cid === item.id;
    for (const b of $("t-choices").querySelectorAll(".t-choice")) {
      b.disabled = true;
      if (b.dataset.id === cid) b.classList.add(ok ? "is-ok" : "is-ng");
      else if (b.dataset.id === item.id) b.classList.add("is-ok"); // 間違えたときは正解も見せる
    }
    judge(ok);
  }

  function judge(ok) {
    busy = true;
    haptic(ok ? "ok" : "ng");
    test.results.push({ id: test.items[test.index].id, ok });
    const dir = ok ? "left" : "right";
    glow(dir);
    setTimeout(() => fly(dir), ok ? SHOW_OK_MS : SHOW_NG_MS);
  }

  function fly(dir) {
    const s = dir === "left" ? -1 : 1;
    wrap.classList.add("fly");
    void wrap.offsetWidth;
    wrap.style.transform = `translateX(${s * (window.innerWidth / 2 + wrap.offsetWidth)}px) rotate(${s * 18}deg)`;
    glow(null);
    setTimeout(() => {
      test.index++;
      updateProgress();
      if (test.index < test.items.length) showQuestion();
      else showResult();
    }, FLY_MS);
  }

  function glow(dir) {
    $("t-glow-left").style.opacity = dir === "left" ? 1 : 0;
    $("t-glow-right").style.opacity = dir === "right" ? 1 : 0;
  }

  function showResult() {
    $("t-stage").hidden = true;
    $("t-result").hidden = false;
    glow(null);
    const total = test.results.length;
    const correct = test.results.filter((r) => r.ok).length;
    $("t-remaining").textContent = 0;
    $("t-progress").style.width = "100%";
    $("t-score").textContent = total ? `${correct}/${total}` : "0";
    const ul = $("t-missed");
    ul.innerHTML = "";
    for (const r of test.results.filter((r) => !r.ok)) {
      const w = Storage.getWord(r.id);
      if (!w) continue;
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: "en", textContent: w.word }));
      li.append(Object.assign(document.createElement("span"), { className: "ja", textContent: w.meaning }));
      ul.appendChild(li);
    }
    $("t-note").textContent = !test.items.length
      ? "今日の単語がまだありません"
      : total === correct
        ? "全問正解"
        : "間違えた単語";
    $("t-again").hidden = !test.items.length;
  }

  $("t-write").addEventListener("submit", (e) => {
    e.preventDefault();
    submitWrite();
  });
  $("t-again").addEventListener("click", () => {
    test = build();
    enter();
  });
  window.addEventListener("keydown", (e) => {
    if ($("view-test").hidden || $("t-stage").hidden || busy || !test) return;
    const item = test.items[test.index];
    if (!item || item.type !== "choice") return;
    const n = Number(e.key);
    if (n >= 1 && n <= item.choices.length) choose(item.choices[n - 1]);
  });

  window.DF = window.DF || {};
  window.DF.Test = { enter };
})();
