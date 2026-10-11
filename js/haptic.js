/*
 * 振動はすべて haptic() を通す。
 *
 * ブラウザの JS から Mac のトラックパッド（Force Touch）を振動させる API は存在しない。
 * なので Web 版では「効果音 + カードの揺れ」で代用し、
 * navigator.vibrate がある端末（主に Android）だけ本当に振動させる。
 *
 * Tauri / Electron 化したときは、ここでネイティブ側を呼ぶ：
 *   macOS: NSHapticFeedbackManager.defaultPerformer
 *            .perform(.alignment / .levelChange / .generic, performanceTime: .now)
 *   Tauri なら window.__TAURI__.core.invoke("haptic", { kind })
 *   Electron なら preload で contextBridge 経由の window.native.haptic(kind)
 */
(function () {
  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // 短い「コッ」という音。ファイル不要
  function click(kind) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(kind === "ng" ? 220 : 520, t);
    osc.frequency.exponentialRampToValueAtTime(kind === "ng" ? 140 : 320, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * @param {"ok"|"ng"|"tick"} kind
   */
  function haptic(kind) {
    // 1) ネイティブ（デスクトップアプリ化したとき）
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke("haptic", { kind }).catch(() => {});
      return;
    }
    if (window.native && typeof window.native.haptic === "function") {
      window.native.haptic(kind);
      return;
    }
    // 2) バイブレーション API がある端末
    if (navigator.vibrate) {
      try { navigator.vibrate(kind === "ng" ? [12, 40, 12] : 15); } catch (e) {}
    }
    // 3) 効果音（オン/オフ可）
    if (window.DF.Storage.getSettings().sound) click(kind);
  }

  // iOS Safari などは最初のユーザー操作で AudioContext を起こしておく必要がある
  window.addEventListener("pointerdown", audio, { once: true });
  window.addEventListener("keydown", audio, { once: true });

  window.DF = window.DF || {};
  window.DF.haptic = haptic;
})();
