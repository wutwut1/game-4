// =====================================================
//  UI: HUD (คะแนน เวลา คอมโบ) และหน้าจอเมนู / หยุดชั่วคราว / จบเกม
// =====================================================
const $ = (id) => document.getElementById(id);

function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // บังคับเบราว์เซอร์ให้เริ่มแอนิเมชันใหม่
  el.classList.add(className);
}

export class UI {
  constructor() {
    this.hud = $('hud');
    this.scoreEl = $('score');
    this.comboEl = $('combo');
    this.timerEl = $('timer');
    this.countdownEl = $('countdown');
    this.hintEl = $('hint');
    this.statusEl = $('status');
    this.screens = { menu: $('screen-menu'), pause: $('screen-pause'), over: $('screen-over') };
    this.last = {};
  }

  // name = 'menu' | 'pause' | 'over' | null (กำลังเล่น)
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('hidden', key !== name);
    this.hud.classList.toggle('hidden', name === 'menu' || name === 'over');
  }

  // hurt = โดนหักคะแนน (ลงห่วงผี) → ตัวเลขสั่นเป็นสีแดง
  setScore(value, bump = false, hurt = false) {
    this.scoreEl.textContent = value.toLocaleString();
    if (bump) restartAnimation(this.scoreEl, 'bump');
    if (hurt) restartAnimation(this.scoreEl, 'hurt');
  }

  setTime(seconds) {
    const s = Math.ceil(seconds);
    if (s === this.last.time) return; // อัปเดต DOM เฉพาะตอนเปลี่ยน = ลื่นกว่า
    this.last.time = s;
    this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timerEl.classList.toggle('warn', s <= 10);
  }

  setCombo(combo) {
    this.comboEl.textContent = combo > 1 ? `x${combo} คอมโบ!` : '';
    if (combo > 1) restartAnimation(this.comboEl, 'bump');
  }

  countdown(text) {
    if (text === null) {
      this.countdownEl.classList.add('hidden');
      return;
    }
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('hidden');
    restartAnimation(this.countdownEl, 'pop');
  }

  hint(visible) {
    if (visible === this.last.hint) return;
    this.last.hint = visible;
    this.hintEl.classList.toggle('hidden', !visible);
  }

  setStatus(text, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  setBusy(busy) {
    for (const id of ['btn-start-camera', 'btn-start-mouse']) $(id).disabled = busy;
  }

  setBest(value) {
    $('best-menu').textContent = value.toLocaleString();
  }

  setToggle(id, on) {
    $(id).classList.toggle('off', !on);
    $(id).setAttribute('aria-pressed', String(on));
  }

  gameOver(s) {
    $('over-score').textContent = s.score.toLocaleString();
    $('over-record').classList.toggle('hidden', !s.isRecord);
    $('over-baskets').textContent = s.baskets;
    $('over-throws').textContent = s.throws;
    $('over-accuracy').textContent = `${s.accuracy}%`;
    $('over-combo').textContent = `x${s.maxCombo}`;
    $('over-best').textContent = s.best.toLocaleString();
  }
}
