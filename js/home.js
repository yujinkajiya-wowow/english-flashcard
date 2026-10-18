/*
 * ホーム画面と、左のバー
 *   日付 / 時刻（19:55 は「1955」と表示。コロンは付けない）/ 今日のひとこと（1日1回生成）/ 連続記録
 */
(function () {
  const { Storage, Scheduler, AI } = window.DF;
  const $ = (id) => document.getElementById(id);

  /* ---------- 左のバー：置いたまま少し待つと広がる ---------- */
  const side = $("side");
  const HOLD_MS = 280;
  let holdTimer = 0;
  const expand = () => side.classList.add("is-open");
  const collapse = () => {
    clearTimeout(holdTimer);
    side.classList.remove("is-open");
  };
  side.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") holdTimer = setTimeout(expand, HOLD_MS);
  });
  side.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") collapse();
  });
  // タッチは長押しで広げる。広がっていないときの長押し後のタップは、遷移させない
  let touchTimer = 0;
  side.addEventListener("touchstart", () => {
    touchTimer = setTimeout(expand, 400);
  }, { passive: true });
  side.addEventListener("touchend", () => clearTimeout(touchTimer));
  side.addEventListener("click", (e) => {
    if (e.target.closest("a")) collapse();
  });

  /* ---------- 時計 ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  function renderClock() {
    const now = new Date();
    $("home-time").textContent = pad(now.getHours()) + pad(now.getMinutes());
    $("home-date").textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " + now.toLocaleDateString("en-US", { weekday: "short" });
  }
  setInterval(() => {
    if (!$("view-home").hidden) renderClock();
  }, 5000);

  /* ---------- 今日のひとこと ----------
     Gemini で1日1回作って保存する。キーが無い・失敗したときは、下の一覧から日付で選ぶ */
  const FALLBACK = [
    "In the morning, you feel like having a cup of coffee, don't you?",
    "Small steps every day add up to a big change.",
    "A new word a day keeps the boredom away.",
    "You don't have to be fast. You just have to keep going.",
    "Today is a good day to learn something new.",
    "Even five minutes of practice beats zero.",
    "Mistakes are proof that you are trying.",
    "The best time to start was yesterday. The next best time is now.",
    "Words are tools. The more you have, the more you can build.",
    "Take a deep breath and flip the first card.",
    "Rainy days are perfect for reading something new.",
    "Your future self will thank you for today's effort.",
    "Learning is a journey, not a race.",
    "One more card, then a coffee break.",
  ];

  function hash(s) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  let generating = false;
  async function renderMessage(today) {
    const cached = Storage.getDaily();
    if (cached && cached.date === today) return ($("home-msg").textContent = cached.text);
    const fallback = FALLBACK[hash(today) % FALLBACK.length];
    $("home-msg").textContent = fallback;
    if (!AI.hasKey() || generating) return;
    generating = true;
    try {
      const text = (await AI.daily(today)).trim().replace(/^["“]|["”]$/g, "");
      if (text) {
        Storage.setDaily({ date: today, text });
        if (!$("view-home").hidden) $("home-msg").textContent = text;
      }
    } catch (e) {
      console.warn("今日のひとことを作れませんでした", e);
    } finally {
      generating = false;
    }
  }

  /* ---------- 連続記録 ---------- */
  function streakMessage(days, today, streak) {
    const doneToday = !!(days[today] && days[today].completed);
    const studiedBefore = Object.keys(days).some((d) => d < Scheduler.addDays(today, -1) && days[d].total > 0);
    if (streak === 0) return studiedBefore ? "Did you slack off yesterday?" : "Let's get started today.";
    if (!doneToday) return "Today's cards are waiting.";
    if (streak === 1) return studiedBefore ? "Did you slack off yesterday?" : "Nice start!";
    if (streak < 7) return "Keep it going!";
    if (streak < 14) return "A whole week. Nice.";
    if (streak < 30) return "You're on fire!";
    return "Unstoppable.";
  }

  // 黄色いフチは ::before に同じ文字を重ねて描く（data-text）
  function pop(el, text) {
    el.dataset.text = text;
    el.innerHTML = "";
    el.append(Object.assign(document.createElement("span"), { className: "pop-fill", textContent: text }));
  }

  function enter() {
    const today = Scheduler.today();
    renderClock();
    renderMessage(today);
    const days = Storage.getDays();
    const streak = Scheduler.streak(days, today);
    pop($("home-streak-num"), String(streak));
    pop($("home-streak-unit"), streak === 1 ? "day" : "days");
    pop($("home-streak-msg"), streakMessage(days, today, streak));
  }

  window.DF.Home = { enter };
})();
