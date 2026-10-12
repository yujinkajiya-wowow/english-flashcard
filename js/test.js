/*
 * テスト：今日の単語（今日答えた復習・新規 + まだ残っている分）から出題する。
 *   単語記述：日本語訳を見て英単語を書く（完全一致。大文字小文字・前後の空白は無視）
 *   単語選択：4択から選ぶ
 *   文章翻訳：AI解説の例文（日本語）を英訳し、AI が採点（スペルミスは直して許す。意味が違えば不正解）
 *             API キーが無いときは出題しない
 * 正解はカードが左へ、不正解は右へ飛ぶ（フラッシュカードと同じ）。
 * 文章翻訳だけは、コメントを読めるように Enter を押すまで飛ばさない。
 * さらに不正解のときは「保留」になり、解答を直して Enter で採点し直せる（そのまま Enter で不正解のまま次へ）。
 * テストの結果は最後の採点で決まる。
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
    input.classList.remove("is-ng");
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
    const input = $("t-sinput");
    if (item.graded && item.graded.correct) return fly("left");
    const answer = input.value.trim();
    if (!answer) return;
    // 保留中に直さず Enter → 不正解で確定
    if (item.graded && answer === item.lastAnswer) {
      record(false);
      glow("right");
      return fly("right");
    }

    busy = true;
    input.disabled = true;
    input.classList.remove("is-ng");
    $("t-comment").textContent = "";
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
    item.lastAnswer = answer;
    item.tries = (item.tries || 0) + 1;
    // チャットの前提は最新の採点に差し替える。質疑の履歴は残す
    item.chat = Object.assign(item.chat || {}, {
      context: [
        "英語の文章翻訳テストの1問について、学習者が質問します。",
        `テストしている英単語：${Storage.getWord(item.id).word}`,
        `問題（日本語）：${item.ex.ja}`,
        `模範解答の一例：${item.ex.en}`,
        `学習者の解答（${item.tries}回目）：${answer}`,
        `採点：${g.correct ? "正解" : "不正解"}（スペルを直した解答：${g.corrected}）`,
        `採点コメント：${g.comment}`,
      ].join("\n"),
    });
    $("t-comment").textContent = g.comment;
    $("t-ai-btn").hidden = false;
    busy = false;

    if (!g.correct) {
      // 保留：入力欄はそのまま。直して Enter で採点し直し
      haptic("ng");
      input.disabled = false;
      input.classList.add("is-ng");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      $("t-hint").textContent = "直して Enter で採点し直す　そのまま Enter で次へ";
      return;
    }

    // 正解：入力欄を、スペルを直した文に置き換える。直した文字だけ薄く塗る
    const view = $("t-sview");
    view.innerHTML = "";
    for (const [text, changed] of diff(answer, g.corrected || answer)) {
      view.append(changed ? Object.assign(document.createElement("mark"), { textContent: text }) : text);
    }
    view.className = "t-input t-sentence en is-ok";
    view.hidden = false;
    input.hidden = true;
    $("t-hint").textContent = "Enter で次へ";
    record(true);
    glow("left");
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
    const item = test.items[test.index];
    // 正答率に入るのは1回目で正解したときだけ。保留から直して正解したものは retried として別に数える
    const retried = ok && (item.tries || 0) > 1;
    test.results.push({ id: item.id, ok: ok && !retried, type: item.type, retried });
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
    // フラッシュカードより控えめに
    $("t-glow-left").style.opacity = dir === "left" ? 0.55 : 0;
    $("t-glow-right").style.opacity = dir === "right" ? 0.55 : 0;
  }

  /* ---------- 結果画面 ---------- */
  const TYPES = [
    { key: "write", label: "単語記述", color: "var(--sum-orange-deep)", r: 44 },
    { key: "choice", label: "単語選択", color: "var(--sum-yellow)", r: 32 },
    { key: "translate", label: "文章翻訳", color: "var(--sum-dark)", r: 20 },
  ];
  const TYPE_LABEL = { write: "記述", choice: "選択", translate: "翻訳" };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function summarize(results) {
    const byType = {};
    for (const t of TYPES) {
      const rs = results.filter((r) => r.type === t.key);
      byType[t.key] = { correct: rs.filter((r) => r.ok).length, total: rs.length };
    }
    return {
      date: Scheduler.today(),
      correct: results.filter((r) => r.ok).length,
      total: results.length,
      byType,
      retried: results.filter((r) => r.retried).length,
    };
  }

  function showResult() {
    $("t-stage").hidden = true;
    $("t-result").hidden = false;
    glow(null);
    $("t-remaining").textContent = 0;
    $("t-progress").style.width = "100%";

    const empty = !test.items.length;
    for (const id of ["t-row-score", "t-row-types", "t-row-history", "t-again"]) $(id).hidden = empty;
    $("t-note").textContent = empty ? "今日の単語がまだありません。デイリーフラッシュをやってから来てね" : "";
    if (empty) return;

    const sum = summarize(test.results);
    // 記録は1回のテストにつき1回だけ
    let tests = Storage.getTests();
    if (!test.saved) {
      tests = Storage.addTest(sum);
      test.saved = true;
    }
    const pct = sum.total ? Math.round((sum.correct / sum.total) * 100) : 0;
    const { ring } = window.DF.Summary;

    // 1. スコア
    $("t-title").textContent = pct === 100 ? "パーフェクト" : pct >= 80 ? "おみごと" : "テスト終了";
    $("t-score").textContent = pct;
    $("t-score-frac").textContent = `${sum.correct}/${sum.total}`;
    ring($("t-score-ring"), [
      { from: 0, to: 1, color: "var(--sum-track)" },
      { from: 0, to: pct / 100, color: "var(--sum-green)", round: true, grow: true },
    ]);
    const ul = $("t-missed");
    ul.innerHTML = "";
    const missed = test.results.filter((r) => !r.ok);
    if (!missed.length) ul.append(el("li", "sum-none", "なし。全問正解"));
    for (const r of missed) {
      const w = Storage.getWord(r.id);
      if (!w) continue;
      const li = el("li");
      const tag = (TYPE_LABEL[r.type] || "") + (r.retried ? "・直して正解" : "");
      li.append(el("span", "en", w.word), el("span", "ja", w.meaning), el("span", "t-tag ja" + (r.retried ? " is-retried" : ""), tag));
      ul.append(li);
    }

    // 2. 形式別：同心円。外から記述・選択・翻訳。出題が無かった形式は輪を出さない
    const segs = [];
    const list = $("t-types");
    list.innerHTML = "";
    for (const t of TYPES) {
      const s = sum.byType[t.key];
      const li = el("li", "t-type" + (s.total ? "" : " is-none"));
      const dot = el("span", "t-dot");
      dot.style.background = t.color;
      li.append(dot, el("span", "t-type-name ja", t.label));
      if (s.total) {
        const p = Math.round((s.correct / s.total) * 100);
        li.append(el("span", "t-type-num en", `${s.correct}/${s.total}`), el("span", "t-type-pct en", `${p}%`));
        segs.push({ from: 0, to: 1, color: "var(--sum-track-light)", r: t.r, width: 8 });
        segs.push({ from: 0, to: s.correct / s.total, color: t.color, r: t.r, width: 8, round: true, grow: true });
      } else {
        li.append(el("span", "t-type-num ja", "出題なし"));
      }
      list.append(li);
    }
    if (sum.retried) list.append(el("li", "t-retried ja", `文章翻訳を直して正解：${sum.retried}問（正答率には入りません）`));
    ring($("t-type-ring"), segs);

    // 3. ベストと前回比較、最近のスコア
    const scores = tests.filter((t) => t.total).map((t) => ({ date: t.date, pct: Math.round((t.correct / t.total) * 100) }));
    $("t-best").textContent = Math.max(...scores.map((x) => x.pct));
    const cmp = $("t-compare");
    cmp.innerHTML = "";
    const prev = scores.length >= 2 ? scores[scores.length - 2].pct : null;
    if (prev === null) cmp.append("記念すべき1回目のテスト");
    else if (pct === prev) cmp.append("前回と同じスコア");
    else cmp.append("前回よりも", el("span", "sum-big en", Math.abs(pct - prev)), pct > prev ? "ポイントアップ！" : "ポイントダウン");
    if (scores.length >= 2 && pct === Math.max(...scores.map((x) => x.pct)) && pct > Math.max(...scores.slice(0, -1).map((x) => x.pct))) {
      cmp.append(el("span", "t-newbest ja", "ベスト更新"));
    }

    const hist = $("t-history");
    hist.innerHTML = "";
    const recent = scores.slice(-7);
    recent.forEach((x, i) => {
      const col = el("div", "t-bar" + (i === recent.length - 1 ? " is-now" : ""));
      const bar = el("div", "t-bar-fill");
      bar.style.setProperty("--h", Math.max(4, x.pct) + "%");
      const [, m, d] = x.date.split("-").map(Number);
      col.append(el("span", "t-bar-pct en", x.pct), el("div", "t-bar-track"), el("span", "t-bar-date en", `${m}/${d}`));
      col.children[1].append(bar);
      hist.append(col);
    });
  }

  $("t-write").addEventListener("submit", (e) => {
    e.preventDefault();
    submitWrite();
  });
  $("t-translate").addEventListener("submit", (e) => {
    e.preventDefault();
    submitTranslate();
  });
  // 保留中に直し始めたら赤を消す
  $("t-sinput").addEventListener("input", (e) => e.target.classList.remove("is-ng"));
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
    // 正解後は入力欄が無いので、Enter はここで受けて次へ。保留中は入力欄の外で押されたときだけ
    if (item && item.graded && e.key === "Enter" && e.target !== $("t-sinput")) {
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
