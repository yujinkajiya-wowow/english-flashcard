/*
 * デイリーフラッシュの結果画面
 *   正答率   ：今日1回目に答えた結果の正答率。右に一度間違えた単語
 *   連続記録 ：連続日数。右に今週（月〜日）のカレンダー。学習した日だけオレンジ
 *   今週     ：今週学習した単語の数（同じ単語は1語）。右に先週との比較
 *             輪：先週の量までが黒。超えた分が黄色。届いていなければ残りがグレー
 */
(function () {
  const { Storage, Scheduler } = window.DF;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  /* ---------- 集計 ---------- */
  function mondayOf(date) {
    const [y, m, d] = date.split("-").map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 月=0 … 日=6
    return Scheduler.addDays(date, -dow);
  }

  /* from〜to（両端含む）に学習した単語の数。同じ単語は1語 */
  function learnedBetween(words, from, to) {
    return words.filter((w) => (w.history || []).some((h) => h.date >= from && h.date <= to)).length;
  }

  function collect(today) {
    const words = Storage.getWords();
    const days = Storage.getDays();
    const todays = words
      .map((w) => ({ w, h: (w.history || []).find((h) => h.date === today) }))
      .filter((x) => x.h);
    const correct = todays.filter((x) => x.h.result === "ok").length;
    const mon = mondayOf(today);
    const lastMon = Scheduler.addDays(mon, -7);
    return {
      accuracy: todays.length ? Math.round((correct / todays.length) * 100) : 0,
      missed: todays.filter((x) => x.h.result !== "ok").map((x) => x.w),
      streak: Scheduler.streak(days, today),
      week: Array.from({ length: 7 }, (_, i) => {
        const date = Scheduler.addDays(mon, i);
        return { date, done: !!(days[date] && days[date].total > 0), today: date === today };
      }),
      thisWeek: learnedBetween(words, mon, Scheduler.addDays(mon, 6)),
      lastWeek: learnedBetween(words, lastMon, Scheduler.addDays(lastMon, 6)),
    };
  }

  /* ---------- 輪 ---------- */
  // segments: [{ from: 0..1, to: 0..1, color }]。12時から時計回り。後ろのものほど上に重なる
  function ring(box, segments) {
    box.querySelector("svg")?.remove();
    const r = 44, c = 2 * Math.PI * r;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("ring");
    for (const seg of segments) {
      const len = Math.max(0, Math.min(1, seg.to) - seg.from);
      if (len <= 0) continue;
      const circle = document.createElementNS(SVG, "circle");
      circle.setAttribute("cx", 50);
      circle.setAttribute("cy", 50);
      circle.setAttribute("r", r);
      circle.setAttribute("stroke", seg.color);
      circle.setAttribute("transform", `rotate(${-90 + seg.from * 360} 50 50)`);
      if (seg.round) circle.setAttribute("stroke-linecap", "round");
      // 出てくるときに伸びるアニメーション
      circle.style.strokeDasharray = `${len * c} ${c}`;
      circle.style.setProperty("--len", len * c);
      circle.style.setProperty("--c", c);
      if (seg.grow) circle.classList.add("grow");
      svg.appendChild(circle);
    }
    box.prepend(svg);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- 描画 ---------- */
  function render(today) {
    const d = collect(today);

    // 正答率
    $("sum-acc").textContent = d.accuracy;
    ring($("sum-acc-ring"), [
      { from: 0, to: 1, color: "var(--sum-track)" },
      { from: 0, to: d.accuracy / 100, color: "var(--sum-green)", round: true, grow: true },
    ]);
    const ul = $("sum-missed");
    ul.innerHTML = "";
    if (!d.missed.length) ul.append(el("li", "sum-none", "なし"));
    for (const w of d.missed) {
      const li = el("li");
      li.append(el("span", "en", w.word), el("span", "ja", w.meaning));
      ul.append(li);
    }

    // 連続記録
    $("sum-streak").textContent = d.streak;
    const [, m] = today.split("-").map(Number);
    $("sum-month").textContent = MONTHS[m - 1];
    const week = $("sum-week");
    week.innerHTML = "";
    ["M", "T", "W", "T", "F", "S", "S"].forEach((label, i) => {
      const day = d.week[i];
      const col = el("div", "sum-day" + (day.done ? " is-done" : "") + (day.today ? " is-today" : ""));
      col.append(el("span", "sum-dow en", label), el("span", "sum-date en", Number(day.date.slice(8))));
      week.append(col);
    });

    // 今週
    const now = d.thisWeek, last = d.lastWeek;
    $("sum-week-count").textContent = now;
    let segs;
    if (!last) {
      segs = [{ from: 0, to: 1, color: "var(--sum-dark)" }];
    } else if (now >= last) {
      // 全体 = 今週。先週分が黒、超えた分が黄色（12時から）
      const extra = (now - last) / now;
      segs = [
        { from: 0, to: 1, color: "var(--sum-dark)" },
        { from: 0, to: extra, color: "var(--sum-yellow)", round: true, grow: true },
      ];
    } else {
      // 全体 = 先週。今週の分が黒、足りない分がグレー
      segs = [
        { from: 0, to: 1, color: "var(--sum-track)" },
        { from: 0, to: now / last, color: "var(--sum-dark)", round: true, grow: true },
      ];
    }
    ring($("sum-week-ring"), segs);

    const cmp = $("sum-compare");
    cmp.innerHTML = "";
    if (!last) {
      cmp.append("今週から記録スタート");
    } else {
      const pct = Math.round((Math.abs(now - last) / last) * 100);
      if (now === last) cmp.append("先週と同じペース");
      else cmp.append("先週よりも", el("span", "sum-big en", pct), now > last ? "%多く学習中！" : "%少なめ");
    }
  }

  window.DF.Summary = { render };
})();
