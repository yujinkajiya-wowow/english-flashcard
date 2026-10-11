/*
 * 復習スケジュール（忘却曲線）
 * 初出題した日を0日目として 1, 2, 4, 7, 15, 30 日目に再出題する。
 *   stage = クリアした復習の回数（0〜6）
 *   「覚えている」→ stage+1、次のチェックポイントまでの日数後に出題
 *   「覚えていない」→ stage=0、翌日に出題（そこから1日目扱いでやり直し）
 *   30日目をクリア → mastered
 */
(function () {
  const OFFSETS = [1, 2, 4, 7, 15, 30];
  const DAILY_NEW = 15;

  /* ---- 日付ユーティリティ（ローカル日付の YYYY-MM-DD） ---- */
  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function parse(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return fmt(d);
  }
  // テスト用：URL に ?date=2026-10-15 を付けるとその日として動く
  function today() {
    const q = new URLSearchParams(location.search).get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return fmt(new Date());
  }

  /* 次のチェックポイントまでの間隔（stage を進めた後の値で渡す） */
  function gapAfter(stage) {
    // stage 0（初出題 or 失敗直後）→ 1日後
    if (stage <= 0) return OFFSETS[0];
    return OFFSETS[stage] - OFFSETS[stage - 1];
  }

  /*
   * 判定を単語に反映して新しい単語オブジェクトを返す。
   * 初出題の日（introducedDate が null）は stage を動かさず、翌日に1日目の復習を入れる。
   */
  function apply(word, result, date) {
    const w = Object.assign({}, word, { history: (word.history || []).concat() });
    const isFirst = !w.introducedDate;
    if (isFirst) w.introducedDate = date;

    if (isFirst) {
      w.stage = 0;
      w.nextReviewDate = addDays(date, OFFSETS[0]);
    } else if (result === "ok") {
      w.stage = (w.stage || 0) + 1;
      if (w.stage >= OFFSETS.length) {
        w.mastered = true;
        w.nextReviewDate = null;
      } else {
        w.nextReviewDate = addDays(date, gapAfter(w.stage));
      }
    } else {
      w.stage = 0;
      w.nextReviewDate = addDays(date, 1);
    }
    w.history.push({ date, result, stage: w.stage });
    return w;
  }

  /*
   * 開発用：その日の回答をなかったことにする。
   * 履歴からその日の分を除いて、最初から apply し直す（履歴があれば状態は再現できる）
   */
  function rewind(word, date) {
    const history = word.history || [];
    if (!history.some((h) => h.date === date)) return word;
    let w = Object.assign({}, word, {
      introducedDate: null, stage: 0, nextReviewDate: null, mastered: false, history: [],
    });
    for (const h of history) if (h.date !== date) w = apply(w, h.result, h.date);
    return w;
  }

  /* 今日出す単語の id 一覧（復習 → 新規の順） */
  function buildToday(words, date) {
    const introducedToday = words.filter((w) => w.introducedDate === date).length;
    const due = words
      .filter((w) => !w.mastered && w.introducedDate && w.nextReviewDate && w.nextReviewDate <= date)
      .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));
    const quota = Math.max(0, DAILY_NEW - introducedToday);
    const fresh = words
      .filter((w) => !w.introducedDate)
      .sort((a, b) => a.addedDate.localeCompare(b.addedDate))
      .slice(0, quota);
    return { review: due.map((w) => w.id), fresh: fresh.map((w) => w.id) };
  }

  function dueCountOn(words, date) {
    return words.filter((w) => !w.mastered && w.nextReviewDate && w.nextReviewDate <= date).length;
  }

  function streak(days, date) {
    // 今日やっていればそこから、まだなら昨日から数える
    let d = days[date] && days[date].completed ? date : addDays(date, -1);
    let n = 0;
    while (days[d] && days[d].completed) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  function stageLabel(w) {
    if (w.mastered) return "習得済み";
    if (!w.introducedDate) return "未出題";
    return `${w.stage} / ${OFFSETS.length}`;
  }

  window.DF = window.DF || {};
  window.DF.Scheduler = {
    OFFSETS, DAILY_NEW, today, addDays, apply, rewind, buildToday, dueCountOn, streak, stageLabel,
  };
})();
