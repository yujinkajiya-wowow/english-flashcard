/*
 * トラックパッドの2本指横スワイプ（wheel の deltaX）でカードを動かす。
 *
 * - deltaX を積み上げてカードをずらす（上限あり＝慣性スクロールで暴走しない）
 * - 閾値を超えた状態が HOLD_MS 続いたらその方向に確定
 * - 閾値の内側に戻したらキャンセル。指を離しても中央には戻らない
 * - 確定後はしばらく入力を無視
 * - タッチ / マウスのドラッグでも同じ動きをする
 */
(function () {
  const HOLD_MS = 2000;
  const THRESHOLD = 0.22;   // カード幅に対する割合
  const MAX = 0.42;         // 移動量の上限（カード幅に対する割合）
  const MAX_ROTATE = 7;     // deg
  const INERTIA_GAP = 120;  // ロック明けは wheel が一度これだけ途切れるまで無視（慣性の残りを捨てる）

  class Swipe {
    constructor({ target, card, tint, bar, onCommit, isInverted, isEnabled }) {
      this.target = target;   // transform をかける要素
      this.card = card;
      this.tint = tint;
      this.bar = bar;
      this.onCommit = onCommit;
      this.isInverted = isInverted || (() => false);
      this.isEnabled = isEnabled || (() => true);

      this.x = 0;
      this.lockedUntil = 0;
      this.lastWheel = 0;
      this.needGap = false;
      this.holdDir = null;
      this.holdStart = 0;
      this.raf = 0;
      this.drag = null;
      this.dragged = false;

      this._onWheel = this._onWheel.bind(this);
      this._tick = this._tick.bind(this);
      // passive: false にしないと preventDefault が効かない
      window.addEventListener("wheel", this._onWheel, { passive: false });
      card.addEventListener("pointerdown", (e) => this._onDown(e));
      window.addEventListener("pointermove", (e) => this._onMove(e));
      window.addEventListener("pointerup", () => this._onUp());
      window.addEventListener("pointercancel", () => this._onUp());
    }

    get width() {
      return this.target.getBoundingClientRect().width || 800;
    }
    get locked() {
      return performance.now() < this.lockedUntil || !this.isEnabled();
    }

    lock(ms) {
      this.lockedUntil = Math.max(this.lockedUntil, performance.now() + ms);
      this.needGap = true;
    }

    /* 確定待ちのカウントだけ止める（キーボードで先に答えたときなど） */
    cancelHold() {
      this.holdDir = null;
      this.holdStart = 0;
      cancelAnimationFrame(this.raf);
      this._renderBar(0);
    }

    reset() {
      this.x = 0;
      this.holdDir = null;
      this.holdStart = 0;
      this.drag = null;
      this._render();
      this._renderBar(0);
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
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.width : 1;
      // ナチュラルスクロールでは指を左に動かすと deltaX > 0。カードを指に追従させるので符号を反転
      const sign = this.isInverted() ? 1 : -1;
      this._moveTo(this.x + sign * e.deltaX * unit);
    }

    _onDown(e) {
      if (this.locked || e.button !== 0) return;
      this.drag = { startX: e.clientX, baseX: this.x, id: e.pointerId };
      this.dragged = false;
    }
    _onMove(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.startX;
      if (Math.abs(dx) > 6) this.dragged = true;
      if (this.dragged && !this.locked) this._moveTo(this.drag.baseX + dx);
    }
    _onUp() {
      this.drag = null;
      // click より後に評価されるよう少し遅らせて解除
      setTimeout(() => (this.dragged = false), 0);
    }

    /* ---------- 位置・タイマー ---------- */
    _moveTo(x) {
      const max = this.width * MAX;
      this.x = Math.max(-max, Math.min(max, x));
      this._render();

      const t = this.width * THRESHOLD;
      const dir = this.x <= -t ? "left" : this.x >= t ? "right" : null;
      if (dir !== this.holdDir) {
        this.holdDir = dir;
        this.holdStart = dir ? performance.now() : 0;
        if (dir) this._startTick();
        else this._renderBar(0);
      }
    }

    _startTick() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this._tick);
    }
    _tick(now) {
      if (!this.holdDir) return this._renderBar(0);
      const p = Math.min(1, (now - this.holdStart) / HOLD_MS);
      this._renderBar(p);
      if (p >= 1) {
        const dir = this.holdDir;
        this.holdDir = null;
        this.onCommit(dir);
        return;
      }
      this.raf = requestAnimationFrame(this._tick);
    }

    /* ---------- 描画 ---------- */
    _render() {
      const w = this.width;
      const r = (this.x / (w * MAX)) * MAX_ROTATE;
      this.target.style.setProperty("--x", this.x + "px");
      this.target.style.setProperty("--r", r + "deg");
      this.target.style.transform = `translateX(${this.x}px) rotate(${r}deg)`;

      const p = Math.min(1, Math.abs(this.x) / (w * THRESHOLD));
      const rgb = this.x < 0 ? "var(--ok)" : "var(--ng)";
      if (p === 0) {
        this.tint.style.background = "transparent";
        this.tint.style.borderColor = "transparent";
      } else {
        this.tint.style.background = `rgba(${rgb}, ${0.1 * p})`;
        this.tint.style.borderColor = `rgba(${rgb}, ${p})`;
      }
    }
    _renderBar(p) {
      this.bar.style.width = p * 100 + "%";
      if (this.holdDir) {
        this.bar.style.background = this.holdDir === "left" ? "rgb(var(--ok))" : "rgb(var(--ng))";
      }
    }

    /* キーボード / 確定時：カードを飛ばす。終わったら resolve */
    flyOut(dir) {
      return new Promise((resolve) => {
        const el = this.target;
        const rgb = dir === "left" ? "var(--ok)" : "var(--ng)";
        this.tint.style.background = `rgba(${rgb}, 0.1)`;
        this.tint.style.borderColor = `rgba(${rgb}, 1)`;
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
  window.DF.Swipe.HOLD_MS = HOLD_MS;
})();
