/*
 * AI解説パネル。カード裏面の「AI解説」ボタンから開く。
 * openChat(ctx) はテストの文章翻訳用：解説は出さず、その問題についてのチャットだけ。
 * 表示する文字はすべて textContent で入れる（AI の返事をそのまま HTML にしない）
 */
(function () {
  const { Storage, AI } = window.DF;
  const $ = (id) => document.getElementById(id);
  const panel = $("explain");
  let wordId = null;
  let chat = null;          // { context: 問題の説明文, qa: [{q, a}] }。履歴は呼び出し側の ctx に残る
  let busy = false;

  function isOpen() {
    return !panel.hidden;
  }

  function open(id) {
    wordId = id;
    chat = null;
    $("ex-top").hidden = false;
    panel.hidden = false;
    $("ex-question").value = "";
    render();
    const w = Storage.getWord(id);
    if (w && !w.ai) generate();
  }

  function openChat(ctx) {
    wordId = null;
    chat = ctx;
    chat.qa = chat.qa || [];
    $("ex-top").hidden = true;
    panel.hidden = false;
    $("ex-question").value = "";
    render();
    $("ex-question").focus();
  }

  function close() {
    panel.hidden = true;
    wordId = null;
    chat = null;
  }

  async function generate() {
    const id = wordId;
    const w = Storage.getWord(id);
    if (!w || busy) return;
    if (!AI.hasKey()) return render();
    busy = true;
    render({ loading: true });
    try {
      const ai = await AI.explain(w);
      Storage.updateWord(id, { ai: Object.assign(ai, { qa: [] }) });
      busy = false;
      if (wordId === id) render();
    } catch (e) {
      busy = false;
      if (wordId === id) render({ error: e.message });
    }
  }

  async function askChat(question) {
    const ctx = chat;
    if (busy || !question) return;
    busy = true;
    render({ pending: question });
    try {
      const a = await AI.chat(ctx.context, ctx.qa, question);
      ctx.qa.push({ q: question, a });
      busy = false;
      if (chat === ctx) {
        $("ex-question").value = "";
        render();
      }
    } catch (e) {
      busy = false;
      if (chat === ctx) render({ error: e.message });
    }
  }

  async function ask(question) {
    if (chat) return askChat(question);
    const id = wordId;
    const w = Storage.getWord(id);
    if (!w || !w.ai || busy || !question) return;
    busy = true;
    render({ pending: question });
    try {
      const a = await AI.ask(w, question);
      const cur = Storage.getWord(id);
      Storage.updateWord(id, { ai: Object.assign({}, cur.ai, { qa: (cur.ai.qa || []).concat({ q: question, a }) }) });
      busy = false;
      if (wordId === id) {
        $("ex-question").value = "";
        render();
      }
    } catch (e) {
      busy = false;
      if (wordId === id) render({ error: e.message });
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function needKeyBox() {
    const box = el("section", "ex-box");
    box.append(el("h3", "ex-head", "APIキーが必要です"));
    box.append(el("p", "ex-text", "単語一覧の右上にある「Gemini APIキー」に、Google AI Studio で作った API キーを入れてください。キーはこのブラウザにだけ保存されます。"));
    return box;
  }

  function qaBox(list, state) {
    const qa = list.slice();
    if (state.pending) qa.push({ q: state.pending, a: null });
    if (!qa.length && !state.error) return null;
    const box = el("section", "ex-box");
    box.append(el("h3", "ex-head", "質問"));
    for (const x of qa) {
      const row = el("div", "ex-qa");
      row.append(el("p", "ex-q", x.q), el("p", "ex-text" + (x.a ? "" : " ex-sub"), x.a || "考えています…"));
      box.append(row);
    }
    if (state.error) box.append(el("p", "ex-text ex-error", state.error));
    return box;
  }

  function renderChat(state) {
    const body = $("ex-body");
    body.innerHTML = "";
    if (!AI.hasKey()) body.append(needKeyBox());
    const box = qaBox(chat.qa, state);
    if (box) body.append(box);
    const canAsk = AI.hasKey() && !busy;
    $("ex-question").disabled = !canAsk;
    $("ex-send").disabled = !canAsk;
    if (state.pending) box.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function render(state = {}) {
    if (chat) return renderChat(state);
    const w = Storage.getWord(wordId);
    if (!w) return close();
    const ai = w.ai;

    $("ex-word").textContent = w.word;
    $("ex-pos").textContent = ai ? ai.pos : "";
    $("ex-pos").hidden = !ai || !ai.pos;
    $("ex-meaning").textContent = ai ? ai.meaning : w.meaning;

    const body = $("ex-body");
    body.innerHTML = "";

    if (!AI.hasKey()) {
      body.append(needKeyBox());
    } else if (!ai) {
      const box = el("section", "ex-box");
      if (state.loading) {
        box.append(el("p", "ex-text ex-sub", "解説を作っています…"));
      } else {
        box.append(el("p", "ex-text ex-sub", state.error || "解説はまだありません"));
        const retry = el("button", "ex-retry", "生成する");
        retry.addEventListener("click", generate);
        box.append(retry);
      }
      body.append(box);
    } else {
      if (ai.notes) {
        const box = el("section", "ex-box");
        box.append(el("h3", "ex-head", "注意点"));
        box.append(el("p", "ex-text", ai.notes));
        body.append(box);
      }
      if (ai.examples && ai.examples.length) {
        const box = el("section", "ex-box");
        box.append(el("h3", "ex-head", "例文"));
        for (const ex of ai.examples) {
          const row = el("div", "ex-example");
          row.append(el("p", "ex-en", ex.en), el("p", "ex-ja", ex.ja));
          box.append(row);
        }
        body.append(box);
      }
      const box = qaBox(ai.qa || [], state);
      if (box) body.append(box);
    }

    const canAsk = AI.hasKey() && !!ai && !busy;
    $("ex-question").disabled = !canAsk;
    $("ex-send").disabled = !canAsk;
    if (state.pending) body.lastElementChild.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  $("ex-form").addEventListener("submit", (e) => {
    e.preventDefault();
    ask($("ex-question").value.trim());
  });
  $("ex-close").addEventListener("click", close);
  panel.addEventListener("click", (e) => {
    if (e.target === panel) close(); // 外側をクリックで閉じる
  });
  window.addEventListener("keydown", (e) => {
    if (isOpen() && e.key === "Escape") close();
  });

  window.DF.Explain = { open, openChat, close, isOpen };
})();
