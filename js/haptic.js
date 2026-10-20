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

  const isDesktop = !!(window.__TAURI__ && window.__TAURI__.core);

  /**
   * @param {"edge"|"ok"|"ng"|"tick"} kind
   *   edge … スワイプが確定ラインを越えた瞬間（指がまだトラックパッドに乗っている）
   *   ok / ng … 判定が確定した（スワイプなら指はもう離れている）
   *   tick … 新しい単語を打ち終えた
   */
  function haptic(kind) {
    // 1) デスクトップ版（Tauri）：トラックパッドを本当に振動させる。
    //    Mac の振動は指が触れている間しか感じないので、主役は edge
    if (isDesktop) {
      window.__TAURI__.core.invoke("haptic", { kind }).catch(() => {});
    } else if (window.native && typeof window.native.haptic === "function") {
      window.native.haptic(kind);
    } else if (navigator.vibrate) {
      // 2) バイブレーション API がある端末（主に Android）
      try { navigator.vibrate(kind === "ng" ? [12, 40, 12] : kind === "edge" ? 8 : 15); } catch (e) {}
    }
    // 3) 効果音（オン/オフ可）。確定ラインを越えただけでは鳴らさない
    if (kind !== "edge" && window.DF.Storage.getSettings().sound) click(kind);
  }

  // iOS Safari などは最初のユーザー操作で AudioContext を起こしておく必要がある
  window.addEventListener("pointerdown", audio, { once: true });
  window.addEventListener("keydown", audio, { once: true });

  window.DF = window.DF || {};
  window.DF.haptic = haptic;
  window.DF.isDesktop = isDesktop;
})();
