/*
 * Weblio study の結果画面 → デイリーフラッシュ
 * ブックマークレットとして使う（bookmarklet.html から登録する）。もう一度押すと閉じる。
 *
 * 画面の作り（クラス名など）は分からないので、文字だけを手がかりにする。
 *   「Question 1」だけが書かれた要素を問題の見出しとみなし、
 *   見出しを1つだけ含む一番外側の要素を、その問題のかたまりとする。
 *   かたまりの文字を行に分けて「英単語」「あなたの解答」「正解」を取り出す。
 * 「あなたの解答」と「正解」が違えば間違えた問題（最初からチェックを付ける）。
 * コピーする形式：1行目が「# Weblio study」、あとは「英単語<タブ>正解」の行
 */
(function () {
  var PANEL = "df-weblio-panel";
  var CHECK = "df-weblio-check";
  var HEAD = /^Question\s*\d+$/i;

  var opened = document.getElementById(PANEL);
  if (opened) {
    opened.remove();
    document.querySelectorAll("." + CHECK).forEach(function (el) { el.remove(); });
    return;
  }

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function hasLatin(s) {
    return /[A-Za-z]/.test(s);
  }

  /* 見出し：文字が「Question 数字」だけで、子にも同じ見出しを持たない要素 */
  var heads = [].filter.call(document.body.querySelectorAll("*"), function (el) {
    if (!HEAD.test(clean(el.textContent))) return false;
    return ![].some.call(el.children, function (c) { return HEAD.test(clean(c.textContent)); });
  });
  if (!heads.length) {
    alert("問題が見つかりませんでした。Weblio study のテスト結果の画面で押してください");
    return;
  }

  function countHeads(el) {
    return heads.filter(function (h) { return el.contains(h); }).length;
  }
  /* 見出しを1つだけ含む一番外側の要素。問題が1つしかないときは、解答まで含む一番内側で止める */
  function blockOf(h) {
    var el = h;
    while (el.parentElement && el.parentElement !== document.body) {
      if (heads.length === 1 && /あなたの解答/.test(el.textContent) && /正解/.test(el.textContent)) break;
      if (countHeads(el.parentElement) > 1) break;
      el = el.parentElement;
    }
    return el;
  }

  /* 「ラベル：値」が1行のときも、ラベルと値が別の行のときも読む */
  function valueAfter(lines, re) {
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(re);
      if (!m) continue;
      if (m[1]) return { value: clean(m[1]), at: i };
      var next = lines[i + 1] || "";
      var isLabel = /^(あなたの解答|正解)/.test(next);
      return { value: isLabel ? "" : clean(next), at: i };
    }
    return null;
  }

  function parse(block) {
    var lines = block.innerText.split("\n").map(clean).filter(Boolean);
    var yours = valueAfter(lines, /^あなたの解答\s*[:：]?\s*(.*)$/);
    var right = valueAfter(lines, /^正解\s*[:：]?\s*(.*)$/);
    if (!right || !right.value) return null;
    var start = lines.findIndex(function (l) { return HEAD.test(l); }) + 1;
    var end = yours ? yours.at : right.at;
    var question = "";
    for (var i = start; i < end; i++) {
      if (lines[i]) { question = lines[i]; break; }
    }
    if (!question) return null;
    var item = { word: question, meaning: right.value, wrong: !yours || yours.value !== right.value };
    // 日本語 → 英語の出題なら、入れ替えて「英単語＝正解」にする
    if (!hasLatin(question) && hasLatin(right.value)) {
      item.word = right.value;
      item.meaning = question;
    }
    return item;
  }

  var items = [];
  heads.forEach(function (h) {
    var block = blockOf(h);
    var item = parse(block);
    if (!item) return;
    var label = document.createElement("label");
    label.className = CHECK;
    label.title = "デイリーフラッシュに送る";
    label.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;margin:4px 0 6px;padding:4px 10px;border-radius:999px;" +
      "font:600 12px/1.4 sans-serif;cursor:pointer;color:#111;background:" + (item.wrong ? "#ffe8e8" : "#f1f1f1");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.wrong;
    box.style.cssText = "width:16px;height:16px;margin:0;cursor:pointer";
    box.addEventListener("change", update);
    label.append(box, document.createTextNode(item.wrong ? "間違えた" : "正解"));
    block.insertBefore(label, block.firstChild);
    item.box = box;
    items.push(item);
  });
  if (!items.length) {
    alert("問題は見つかりましたが、「正解」が読み取れませんでした");
    return;
  }

  var panel = document.createElement("div");
  panel.id = PANEL;
  panel.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647;display:flex;align-items:center;gap:12px;" +
    "padding:12px 14px 12px 18px;background:#111;color:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);" +
    "font:600 13px/1.4 sans-serif";
  var text = document.createElement("span");
  var copy = document.createElement("button");
  copy.textContent = "コピー";
  copy.style.cssText = "border:0;border-radius:999px;padding:8px 16px;background:#fff;color:#111;font:inherit;cursor:pointer";
  var close = document.createElement("button");
  close.textContent = "×";
  close.title = "閉じる";
  close.style.cssText = "border:0;background:none;color:#aaa;font:400 18px/1 sans-serif;cursor:pointer;padding:0 2px";
  panel.append(text, copy, close);
  document.body.appendChild(panel);

  function picked() {
    return items.filter(function (it) { return it.box.checked; });
  }
  function update() {
    text.textContent = "デイリーフラッシュに送る：" + picked().length + "語";
    copy.disabled = !picked().length;
    copy.style.opacity = picked().length ? 1 : 0.4;
  }
  update();

  function done(ok) {
    text.textContent = ok
      ? "コピーしました！アプリの「単語の追加」に貼り付けてね"
      : "コピーできませんでした";
    setTimeout(update, 2500);
  }
  copy.addEventListener("click", function () {
    var list = picked();
    var out = ["# Weblio study"].concat(list.map(function (it) {
      return it.word.replace(/\t/g, " ") + "\t" + it.meaning.replace(/\t/g, " ");
    })).join("\n");
    // 古い方法（execCommand）は、clipboard API が使えないページ用
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = out;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  });
  close.addEventListener("click", function () {
    panel.remove();
    document.querySelectorAll("." + CHECK).forEach(function (el) { el.remove(); });
  });
})();
