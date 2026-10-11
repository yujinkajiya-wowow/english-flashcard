/*
 * テスト：今日の単語（今日答えた復習・新規 + まだ残っている分）から出題する。
 *   単語記述：日本語訳を見て英単語を書く（完全一致。大文字小文字・前後の空白は無視）
 *   単語選択：4択から選ぶ
 *   文章翻訳：AI解説の例文（日本語）を英訳し、AI が採点（スペルミスは直して許す。意味が違えば不正解）
 *             API キーが無いときは出題しない
 * 正解はカードが左へ、不正解は右へ飛ぶ（フラッシュカードと同じ）。
 * 文章翻訳だけは、コメントを読めるように Enter を押すまで飛ばさない。
 * 結果は復習スケジュールには反映しない。
 */
(function () {
  const { Storage, Scheduler, AI, Explain, haptic } = window.DF;
  const $ = (id) => document.getElementById(id);
  const wrap = $("t-wrap");
  const FLY_MS = 380;
  const SHOW_OK_MS = 450;   // 正解の色を見せてから飛ばすまで
  const SHOW_NG_MS = 1300;  // 不正解は正解を確認する時間を少し長めに

  let test = null;          // { items: [{id, type, choices, ex, graded, chat}], index, results: [{id, ok}] }
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
      // 選択肢が作れないほど単語が少ないときは選択を、API キーが無いときは翻訳を外す
      const types = ["write"];
      if (others.length >= 1) types.push("choice");
      if (AI.hasKey()) types.push("translate");
      const type = types[Math.floor(Math.random() * types.length)];
      return { id, type, choices: type === "choice" ? shuffle(others.concat(id)) : null };
    });
    return { items, index: 0, results: [] };
  }

  function enter() {
    if (!test || !test.items.length) test = build(); // 空のときは、単語が増えているかもしれないので作り直す
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
    $("t-question").classList.remove("t-sentence-q");
    const write = item.type === "write";
    $("t-write").hidden = !write;
    $("t-choices").hidden = item.type !== "choice";
    $("t-translate").hidden = item.type !== "translate";
    $("t-ai-btn").hidden = true;

    if (item.type === "translate") {
      showTranslate(item, w);
    } else if (write) {
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
      $("t-hint").textContent = "クリック、または矢印キー（↑ ← ↓ →）で選ぶ";
    }
    updateProgress();
  }

  /* ---------- 文章翻訳 ---------- */
  async function showTranslate(item, w) {
    const input = $("t-sinput");
    input.value = "";
    input.hidden = false;
    input.disabled = true;
    $("t-sview").hidden = true;
    $("t-comment").textContent = "";
    $("t-question").classList.add("t-sentence-q");
    $("t-hint").textContent = "英語に訳して Enter";

    if (!item.ex) {
      // 例文は AI解説のものを使う。まだ無ければここで作る（解説としても保存される）
      if (!(w.ai && w.ai.examples && w.ai.examples.length)) {
        $("t-question").textContent = "";
        status("問題を作っています…");
        busy = true;
        try {
          const ai = await AI.explain(w);
          Storage.updateWord(w.id, { ai: Object.assign(ai, { qa: (w.ai && w.ai.qa) || [] }) });
        } catch (e) {
          // 作れなかったら、この問題は単語記述にする
          busy = false;
          status("");
          item.type = "write";
          return showQuestion();
        }
        busy = false;
        if (test.items[test.index] !== item) return;
        w = Storage.getWord(w.id);
      }
      const exs = w.ai.examples;
      item.ex = exs[Math.floor(Math.random() * exs.length)];
    }
    status("");
    $("t-question").textContent = item.ex.ja;
    input.disabled = false;
    input.focus();
  }

  function status(text, error) {
    const el = $("t-status");
    el.textContent = text;
    el.classList.toggle("is-error", !!error);
  }

  async function submitTranslate() {
    const item = test.items[test.index];
    if (busy) return;
    if (item.graded) return fly(item.graded.correct ? "left" : "right");
    const input = $("t-sinput");
    const answer = input.value.trim();
    if (!answer) return;
    busy = true;
    input.disabled = true;
    status("AI採点中…");
    let g;
    try {
      g = await AI.grade(Storage.getWord(item.id), item.ex.ja, item.ex.en, answer);
    } catch (e) {
      busy = false;
      input.disabled = false;
      input.focus();
      return status(e.message + "（Enter でもう一度）", true);
    }
    if (test.items[test.index] !== item) return;
    status("");
    item.graded = g;
    item.chat = {
      context: [
        "英語の文章翻訳テストの1問について、学習者が質問します。",
        `テストしている英単語：${Storage.getWord(item.id).word}`,
        `問題（日本語）：${item.ex.ja}`,
        `模範解答の一例：${item.ex.en}`,
        `学習者の解答：${answer}`,
        `採点：${g.correct ? "正解" : "不正解"}（スペルを直した解答：${g.corrected}）`,
        `採点コメント：${g.comment}`,
      ].join("\n"),
    };

    // 入力欄を、スペルを直した文に置き換える。直した文字だけ薄く塗る
    const view = $("t-sview");
    view.innerHTML = "";
    for (const [text, changed] of diff(answer, g.corrected || answer)) {
      view.append(changed ? Object.assign(document.createElement("mark"), { textContent: text }) : text);
    }
    view.className = "t-input t-sentence en " + (g.correct ? "is-ok" : "is-ng");
    view.hidden = false;
    input.hidden = true;
    $("t-comment").textContent = g.comment;
    $("t-ai-btn").hidden = false;
    $("t-hint").textContent = "Enter で次へ";

    record(g.correct);
    glow(g.correct ? "left" : "right");
    busy = false;
  }

  /* after のうち before に無い部分に印を付ける（文字単位の LCS）→ [[文字列, 変更か], ...] */
  function diff(before, after) {
    const a = [...before], b = [...after];
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    const push = (ch, changed) => {
      const last = out[out.length - 1];
      if (last && last[1] === changed) last[0] += ch;
      else out.push([ch, changed]);
    };
    let i = 0, j = 0;
    while (j < b.length) {
      if (i < a.length && a[i] === b[j]) { push(b[j], false); i++; j++; }
      else if (i < a.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
      else { push(b[j], true); j++; }
    }
    return out;
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

  function record(ok) {
    haptic(ok ? "ok" : "ng");
    test.results.push({ id: test.items[test.index].id, ok });
  }

  function judge(ok) {
    busy = true;
    record(ok);
    const dir = ok ? "left" : "right";
    glow(dir);
    setTimeout(() => fly(dir), ok ? SHOW_OK_MS : SHOW_NG_MS);
  }

  function fly(dir) {
    busy = true;
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
  $("t-translate").addEventListener("submit", (e) => {
    e.preventDefault();
    submitTranslate();
  });
  $("t-ai-btn").addEventListener("click", () => {
    const item = test && test.items[test.index];
    if (item && item.chat) Explain.openChat(item.chat);
  });
  $("t-hint").addEventListener("click", () => {
    const item = test && test.items[test.index];
    if (item && item.graded) submitTranslate();
  });
  $("t-again").addEventListener("click", () => {
    test = build();
    enter();
  });
  window.addEventListener("keydown", (e) => {
    if ($("view-test").hidden || $("t-stage").hidden || busy || !test || Explain.isOpen()) return;
    const item = test.items[test.index];
    // 採点後は入力欄が無いので、Enter はここで受けて次へ
    if (item && item.graded && e.key === "Enter") {
      e.preventDefault();
      return submitTranslate();
    }
    if (!item || item.type !== "choice") return;
    // 選択肢は上に1つ・下に3つで、矢印キーの並びと同じ形。↑=上、← ↓ →=下の左・中・右
    const n = { ArrowUp: 0, ArrowLeft: 1, ArrowDown: 2, ArrowRight: 3 }[e.key];
    if (n === undefined || n >= item.choices.length) return;
    e.preventDefault();
    choose(item.choices[n]);
  });

  window.DF = window.DF || {};
  window.DF.Test = { enter };
})();
