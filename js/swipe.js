/*
 * トラックパッドの2本指横スワイプ（wheel の deltaX）でカードを動かす。
 *
 * - 指の移動量（raw）をそのままではなく、だんだん効きが弱くなる曲線でカードの位置に変換する
 *   （動かし始めは敏感、端に近づくほど重い）
 * - カードが THRESHOLD を越えた状態で指を離すと、その方向に確定
 * - 越えていなければ、離したときに中央へ戻る
 * - スワイプした側の画面端がうっすら色づく（左＝緑、右＝赤）
 *
 * ブラウザには「トラックパッドから指を離した」イベントが無いので、
 *   ・wheel が RELEASE_MS 途切れた
 *   ・慣性スクロール（指を離した後の、だんだん小さくなる deltaX）が始まった
 * のどちらかを「離した」とみなす。
 * マウス / タッチのドラッグは pointerup が離した瞬間。
 */
(function () {
  /* ---- 調整用（すべてカード幅に対する割合） ---- */
  const MAX = 0.6;          // カードが動ける上限
  const THRESHOLD = 0.42;   // ここを越えて離すと確定（MAX の 7 割。大きめにスワイプしないと届かない）
  const SOFTNESS = 0.4;     // 曲線のなだらかさ。小さいほど最初が敏感で、早く重くなる
  const RAW_MAX = 2.5;      // 指の移動量の上限（慣性で積み上がりすぎないように）

  const MAX_ROTATE = 7;     // deg
  const RELEASE_MS = 160;   // wheel がこれだけ途切れたら指を離したとみなす
  const INERTIA_GAP = 120;  // ロック明けは wheel が一度これだけ途切れるまで無視（慣性の残りを捨てる）

  class Swipe {
    constructor({ target, card, glowLeft, glowRight, onCommit, isInverted, isEnabled }) {
      this.target = target;   // transform をかける要素
      this.card = card;
      this.glow = { left: glowLeft, right: glowRight };
      this.onCommit = onCommit;
      this.isInverted = isInverted || (() => false);
      this.isEnabled = isEnabled || (() => true);

      this.raw = 0;           // 指の移動量の合計（カード幅 = 1）
      this.lockedUntil = 0;
      this.lastWheel = 0;
      this.needGap = false;
      this.recent = [];       // 直近の wheel の移動量（慣性の検出用）
      this.releaseTimer = 0;
      this.springRaf = 0;
      this.drag = null;
      this.dragged = false;

      this._onWheel = this._onWheel.bind(this);
      // passive: false にしないと preventDefault が効かない
      window.addEventListener("wheel", this._onWheel, { passive: false });
      card.addEventListener("pointerdown", (e) => this._onDown(e));
      window.addEventListener("pointermove", (e) => this._onMove(e));
      window.addEventListener("pointerup", () => this._onUp());
      window.addEventListener("pointercancel", () => this._onUp(true));
    }

    get width() {
      return this.target.getBoundingClientRect().width || 800;
    }
    get locked() {
      return performance.now() < this.lockedUntil || !this.isEnabled();
    }
    /* カードの位置（カード幅 = 1）。raw が大きくなるほど伸びが鈍る */
    get pos() {
      const r = Math.abs(this.raw);
      return Math.sign(this.raw) * MAX * (1 - Math.exp(-r / SOFTNESS));
    }
    get dir() {
      const p = this.pos;
      return p <= -THRESHOLD ? "left" : p >= THRESHOLD ? "right" : null;
    }

    lock(ms) {
      this.lockedUntil = Math.max(this.lockedUntil, performance.now() + ms);
      this.needGap = true;
    }

    /* 途中の判定や戻りアニメーションを止める（キーボードで先に答えたときなど） */
    cancel() {
      clearTimeout(this.releaseTimer);
      cancelAnimationFrame(this.springRaf);
      this.recent = [];
      this.drag = null;
    }

    reset() {
      this.cancel();
      this.raw = 0;
      this._render();
    }

    /* ---------- 入力 ---------- */
    _onWheel(e) {
      if (!this.isEnabled()) return;
      e.preventDefault();
      const now = performance.now();
      const gap = now - this.lastWheel;
      this.lastWheel = now;
      if (this.locked) return;
      // ロック明けでも、確定前のスワイプの慣性がまだ流れているなら捨てる
      if (this.needGap) {
        if (gap < INERTIA_GAP) return;
        this.needGap = false;
      }
      // 縦方向が主の動きは無視（横スワイプだけ拾う）
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.5) return;
      if (gap > RELEASE_MS) this.recent = []; // 新しいジェスチャー

      cancelAnimationFrame(this.springRaf);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.width : 1;
      // ナチュラルスクロールでは指を左に動かすと deltaX > 0。カードを指に追従させるので符号を反転
      const sign = this.isInverted() ? 1 : -1;
      const d = (sign * e.deltaX * unit) / this.width;
      this._setRaw(this.raw + d);

      this.recent.push(d);
      if (this.recent.length > 6) this.recent.shift();

      clearTimeout(this.releaseTimer);
      if (this.dir && this._isInertia()) return this._release();
      this.releaseTimer = setTimeout(() => this._release(), RELEASE_MS);
    }

    /* 同じ向きの移動量が連続して小さくなっている = 指を離した後の慣性 */
    _isInertia() {
      const r = this.recent;
      if (r.length < 5) return false;
      const s = Math.sign(this.raw);
      for (let i = 1; i < r.length; i++) {
        if (Math.sign(r[i]) !== s || Math.abs(r[i]) > Math.abs(r[i - 1])) return false;
      }
      return Math.abs(r[0]) > Math.abs(r[r.length - 1]) * 1.3;
    }

    _onDown(e) {
      if (this.locked || e.button !== 0) return;
      cancelAnimationFrame(this.springRaf);
      this.drag = { startX: e.clientX, baseRaw: this.raw, id: e.pointerId };
      this.dragged = false;
    }
    _onMove(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.startX;
      if (Math.abs(dx) > 6) this.dragged = true;
      if (this.dragged && !this.locked) this._setRaw(this.drag.baseRaw + dx / this.width);
    }
    _onUp(cancelled) {
      const wasDragging = this.drag && this.dragged;
      this.drag = null;
      if (wasDragging && !this.locked) cancelled ? this._springBack() : this._release();
      // click より後に評価されるよう少し遅らせて解除
      setTimeout(() => (this.dragged = false), 0);
    }

    /* ---------- 判定 ---------- */
    _setRaw(raw) {
      this.raw = Math.max(-RAW_MAX, Math.min(RAW_MAX, raw));
      this._render();
    }

    _release() {
      clearTimeout(this.releaseTimer);
      this.recent = [];
      const dir = this.dir;
      if (dir) this.onCommit(dir);
      else this._springBack();
    }

    /* 中央へ戻す。途中で触ったらそこから続けられるよう、JS で少しずつ戻す */
    _springBack() {
      cancelAnimationFrame(this.springRaf);
      const step = () => {
        this.raw *= 0.78;
        if (Math.abs(this.raw) < 0.002) this.raw = 0;
        this._render();
        if (this.raw !== 0) this.springRaf = requestAnimationFrame(step);
      };
      this.springRaf = requestAnimationFrame(step);
    }

    /* ---------- 描画 ---------- */
    _render() {
      const w = this.width;
      const p = this.pos;
      this.target.style.setProperty("--x", p * w + "px");
      this.target.style.setProperty("--r", (p / MAX) * MAX_ROTATE + "deg");
      this.target.style.transform = `translateX(${p * w}px) rotate(${(p / MAX) * MAX_ROTATE}deg)`;

      // 閾値に近づくほど濃く。越えたら「離せば確定」なので一段はっきりさせる
      const t = Math.min(1, Math.abs(p) / THRESHOLD);
      const level = Math.abs(p) >= THRESHOLD ? 1 : 0.7 * t * t;
      this._glow(p < 0 ? "left" : "right", p === 0 ? 0 : level);
    }
    _glow(side, level) {
      const other = side === "left" ? "right" : "left";
      this.glow[side].style.opacity = level;
      this.glow[other].style.opacity = 0;
    }

    /* 確定したカードを飛ばす。終わったら resolve */
    flyOut(dir) {
      return new Promise((resolve) => {
        const el = this.target;
        this._glow(dir, 1);
        el.classList.remove("thud");
        void el.offsetWidth;
        el.classList.add("thud");
        setTimeout(() => {
          el.classList.remove("thud");
          el.classList.add("fly");
          const w = this.width;
          const to = (dir === "left" ? -1 : 1) * (w * 1.1 + window.innerWidth * 0.3);
          el.style.transform = `translateX(${to}px) rotate(${dir === "left" ? -14 : 14}deg)`;
          el.style.opacity = "0";
          this.glow[dir].style.opacity = 0;
          setTimeout(() => {
            el.classList.remove("fly");
            el.style.opacity = "";
            resolve();
          }, 450);
        }, 160);
      });
    }
  }

  window.DF = window.DF || {};
  window.DF.Swipe = Swipe;
})();
