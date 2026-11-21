// =====================================================
//  ตัวเกมหลัก: สถานะเกม, ลูปเกม 60 fps, ฟิสิกส์, การหยิบ/โยน, คะแนน, การวาด
//  สถานะ: menu → countdown → playing ⇄ paused → over
// =====================================================
import { CONFIG, BALL_COLORS, CONFETTI_COLORS, GHOST_COLORS } from './config.js';
import { Ball } from './ball.js';
import { Hoop } from './hoop.js';
import { Effects } from './effects.js';

const BEST_KEY = 'playball-best';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* โหมดส่วนตัวบางเบราว์เซอร์บันทึกไม่ได้ */ }
}

export class Game {
  constructor({ canvas, sound, input, ui }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sound = sound;
    this.input = input;
    this.ui = ui;

    this.state = 'menu';
    this.balls = [];
    this.hoops = [];
    this.effects = new Effects();
    this.holds = new Map();      // id ของมือ → ลูกบอลที่ถืออยู่
    this.prevPinch = new Map();  // id ของมือ → เฟรมก่อนจีบอยู่ไหม
    this.best = loadBest();
    this.ui.setBest(this.best);

    this.resetStats();
    this.resize();
    this.createBalls();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ---------- ขนาดจอ ----------
  resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
    if (W * H * dpr * dpr > CONFIG.MAX_CANVAS_PIXELS) dpr = Math.sqrt(CONFIG.MAX_CANVAS_PIXELS / (W * H));
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const oldW = this.W, oldH = this.H;
    this.W = W;
    this.H = H;
    this.unit = Math.min(W, H);
    // ลูกบอลใหญ่ตามจอ แต่ต้องวางเรียง 10 ลูกที่พื้นได้พอดีเสมอ
    this.R = Math.max(8, Math.min(this.unit * CONFIG.BALL_SIZE, W / (CONFIG.BALL_COUNT * 2.3)));

    const safeBottom = parseFloat(getComputedStyle(document.getElementById('safe-probe')).paddingBottom) || 0;
    const u = this.unit;
    this.P = {
      unit: u,
      width: W,
      floorY: H - safeBottom,
      gravity: CONFIG.GRAVITY * u,
      airDrag: CONFIG.AIR_DRAG,
      floorBounce: CONFIG.FLOOR_BOUNCE,
      wallBounce: CONFIG.WALL_BOUNCE,
      rollFriction: CONFIG.ROLL_FRICTION,
      restSpeed: u * 0.08,
    };

    for (const b of this.balls) {
      if (oldW) { b.x *= W / oldW; b.y *= H / oldH; }
      b.setRadius(this.R, dpr);
      b.x = clamp(b.x, this.R, W - this.R);
      b.y = Math.min(b.y, this.P.floorY - this.R);
    }
    for (const h of this.hoops) {
      if (oldW) { h.x *= W / oldW; h.y *= H / oldH; }
      h.setSize(this.R * CONFIG.HOOP_SIZE);
    }
    this.dpr = dpr;
  }

  // ห่วงผีมีตัวผีลอยอยู่ด้านบน จึงต้องเว้นขอบบนเพิ่มไม่ให้ทับ HUD
  hoopZone(ghost = false) {
    const half = this.R * CONFIG.HOOP_SIZE;
    const top = this.H * CONFIG.HOOP_ZONE_TOP + half * (ghost ? 1.4 : 0.4);
    const bottom = this.P.floorY - this.R * 2 * CONFIG.HOOP_FLOOR_GAP - half * 1.05;
    return { left: 0, right: this.W, top, bottom: Math.max(top, bottom) };
  }

  createBalls() {
    this.balls = [];
    for (let i = 0; i < CONFIG.BALL_COUNT; i++) {
      const x = (this.W * (i + 0.5)) / CONFIG.BALL_COUNT + rand(-this.R, this.R) * 0.3;
      const y = this.P.floorY - this.R - rand(0.15, 0.55) * this.H; // ตกลงมาเด้งตอนเปิดเกม
      const b = new Ball(x, y, BALL_COLORS[i % BALL_COLORS.length]);
      b.setRadius(this.R, this.dpr);
      this.balls.push(b);
    }
  }

  // ---------- ควบคุมสถานะเกม ----------
  resetStats() {
    this.score = 0;
    this.baskets = 0;
    this.throws = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.timeLeft = CONFIG.GAME_TIME;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.ghostSpawnTimer = 0;
    this.ghostHits = 0;
    this.goTimer = 0;
    this.lastTick = null;
    this.noHandTime = 0;
  }

  start() {
    this.releaseAll();
    this.resetStats();
    this.hoops = [];
    this.effects.clear();
    this.sound.stopMusic();
    this.sound.resume();
    this.ui.setScore(0);
    this.ui.setCombo(0);
    this.ui.setTime(this.timeLeft);
    this.ui.show(null);
    this.state = 'countdown';
    this.countdownLeft = CONFIG.COUNTDOWN;
    this.lastCount = null;
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.sound.setMove(0);
    this.sound.pause();
    this.ui.hint(false);
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.sound.resume();
    this.ui.show(null);
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  toMenu() {
    this.state = 'menu';
    this.releaseAll();
    this.hoops.forEach((h) => h.leave());
    this.sound.stopMusic();
    this.sound.resume();
    this.ui.countdown(null);
    this.ui.hint(false);
    this.ui.setBest(this.best);
    this.ui.show('menu');
  }

  endGame() {
    this.state = 'over';
    this.releaseAll();
    this.hoops.forEach((h) => h.leave());
    this.sound.stopMusic();
    this.sound.gameOver();
    this.ui.countdown(null);
    this.ui.hint(false);
    this.ui.setCombo(0);

    const isRecord = this.score > this.best;
    if (isRecord) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.ui.setBest(this.best);
    this.ui.gameOver({
      score: this.score,
      baskets: this.baskets,
      throws: this.throws,
      accuracy: this.throws ? Math.round((Math.min(this.baskets, this.throws) / this.throws) * 100) : 0,
      maxCombo: this.maxCombo,
      best: this.best,
      isRecord,
    });
    this.ui.show('over');
  }

  // ---------- ลูปเกม ----------
  loop = (now) => {
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 20); // กันกระตุกเมื่อสลับแท็บ
    this.lastTime = now;
    if (this.state !== 'paused') {
      this.input.update(now, dt, this.W, this.H);
      this.update(dt);
    }
    this.draw();
    requestAnimationFrame(this.loop);
  };

  update(dt) {
    if (this.state === 'countdown') this.updateCountdown(dt);
    else if (this.state === 'playing') this.updatePlaying(dt);

    this.handleHands(this.input.hands, dt);
    this.updatePhysics(dt);
    this.effects.update(dt, this.P.gravity * 0.5);
    this.updateMoveSound();
    this.updateHint(dt);
  }

  updateCountdown(dt) {
    this.countdownLeft -= dt;
    const n = Math.ceil(this.countdownLeft);
    if (n > 0 && n !== this.lastCount) {
      this.lastCount = n;
      this.ui.countdown(n);
      this.sound.beep(false);
    }
    if (this.countdownLeft <= 0) {
      this.state = 'playing';
      this.ui.countdown('GO!');
      this.sound.beep(true);
      this.sound.startMusic();
      this.goTimer = 0.7;
    }
  }

  updatePlaying(dt) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.elapsed += dt;
    this.ui.setTime(this.timeLeft);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.countdown(null);
    }

    // 10 วินาทีสุดท้าย: เสียงติ๊ก
    const sec = Math.ceil(this.timeLeft);
    if (sec <= 10 && sec > 0 && sec !== this.lastTick) {
      this.lastTick = sec;
      this.sound.tick(sec <= 3);
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.ui.setCombo(0);
      }
    }

    // เพิ่มห่วงตามเวลา และเกิดห่วงใหม่แทนอันที่หายไป
    const wanted = Math.min(CONFIG.HOOP_MAX_COUNT, CONFIG.HOOP_START_COUNT + Math.floor(this.elapsed / CONFIG.HOOP_ADD_EVERY));
    const active = this.hoops.filter((h) => h.active && !h.ghost).length;
    if (active < wanted) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnHoop(false);
        this.spawnTimer = 0.6;
      }
    }

    // ห่วงผี: เริ่มโผล่หลังผ่านไปสักพัก แล้วค่อย ๆ เพิ่มจำนวน
    const ghostWanted = this.elapsed < CONFIG.GHOST_START_AT ? 0
      : Math.min(CONFIG.GHOST_MAX_COUNT, 1 + Math.floor((this.elapsed - CONFIG.GHOST_START_AT) / CONFIG.GHOST_ADD_EVERY));
    const activeGhosts = this.hoops.filter((h) => h.active && h.ghost).length;
    if (activeGhosts < ghostWanted) {
      this.ghostSpawnTimer -= dt;
      if (this.ghostSpawnTimer <= 0) {
        this.spawnHoop(true);
        this.ghostSpawnTimer = 1.5;
      }
    }

    if (this.timeLeft <= 0) this.endGame();
  }

  spawnHoop(ghost = false) {
    const z = this.hoopZone(ghost);
    const half = this.R * CONFIG.HOOP_SIZE;
    let best = null;
    let bestDist = -1;
    // สุ่มหลายจุด แล้วเลือกจุดที่ห่างจากห่วงอื่นมากที่สุด
    for (let i = 0; i < 12; i++) {
      const x = rand(z.left + half * 1.2, z.right - half * 1.2);
      const y = rand(z.top, z.bottom);
      let d = Infinity;
      for (const h of this.hoops) if (h.active) d = Math.min(d, Math.hypot(h.x - x, h.y - y));
      if (d > bestDist) { best = { x, y }; bestDist = d; }
      if (d > half * 5) break;
    }
    const hoop = new Hoop(best.x, best.y, half, ghost);
    hoop.lifetime = ghost ? CONFIG.GHOST_LIFETIME : CONFIG.HOOP_LIFETIME;
    this.hoops.push(hoop);
    if (ghost) this.sound.ghostSpawn();
    else this.sound.hoopSpawn();
  }

  // ---------- มือ: จีบเพื่อหยิบ / แบมือเพื่อปล่อย ----------
  handleHands(hands, dt) {
    const seen = new Set();
    for (const h of hands) {
      seen.add(h.id);
      const wasPinching = this.prevPinch.get(h.id) || false;
      this.prevPinch.set(h.id, h.pinching);
      let ball = this.holds.get(h.id);

      if (h.pinching && !wasPinching && !ball) {
        ball = this.findBallNear(h.pinch.x, h.pinch.y);
        if (ball) {
          ball.grab();
          this.holds.set(h.id, ball);
          this.sound.grab();
        } else if (!h.isPointer) {
          this.sound.pinchEmpty();
        }
      }

      if (ball) {
        if (h.pinching) ball.follow(h.pinch.x, h.pinch.y, dt, this.P);
        else this.releaseBall(h.id);
      }
    }
    // มือที่หายไปจากกล้อง = ปล่อยบอล
    for (const id of [...this.holds.keys()]) if (!seen.has(id)) this.releaseBall(id);
    for (const id of [...this.prevPinch.keys()]) if (!seen.has(id)) this.prevPinch.delete(id);
  }

  findBallNear(x, y) {
    let best = null;
    let bestD = this.R * CONFIG.GRAB_RADIUS;
    for (const b of this.balls) {
      if (b.held) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  releaseBall(handId) {
    const ball = this.holds.get(handId);
    if (!ball) return;
    this.holds.delete(handId);
    const max = this.unit * CONFIG.MAX_THROW_SPEED;
    const speed = ball.release(max);
    this.sound.release(speed / max);
    if (this.state === 'playing' && ball.y < this.P.floorY - this.R * 3) this.throws++;
  }

  releaseAll() {
    for (const id of [...this.holds.keys()]) this.releaseBall(id);
    this.prevPinch.clear();
  }

  // ---------- ฟิสิกส์ ----------
  updatePhysics(dt) {
    const zone = this.hoopZone(false);
    const ghostZone = this.hoopZone(true);
    const hoopSpeed = this.unit * (CONFIG.HOOP_SPEED + CONFIG.HOOP_SPEED_UP * (this.elapsed / CONFIG.GAME_TIME));
    for (const h of this.hoops) h.update(dt, h.ghost ? ghostZone : zone, hoopSpeed);
    this.separateHoops();

    // แบ่งเป็นช่วงย่อย 120 ครั้ง/วินาที ให้บอลเร็ว ๆ ไม่ทะลุห่วง
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const b of this.balls) {
        b.prevY = b.y;
        if (b.held) continue;
        const impact = b.step(h, this.P);
        if (impact) this.onBounce(b, impact);
      }
      this.collideBalls();
      for (const hoop of this.hoops) {
        if (!hoop.solid) continue;
        for (const b of this.balls) {
          if (b.held) continue;
          const impact = hoop.collide(b, CONFIG.RIM_BOUNCE);
          if (impact > this.unit * 0.15 && hoop.soundCooldown <= 0) {
            hoop.soundCooldown = 0.08;
            this.sound.rim(clamp(impact / (this.unit * 2), 0.1, 1));
          }
          if (this.state === 'playing' && hoop.canScore && hoop.checkScore(b)) {
            if (hoop.ghost) this.onGhost(b, hoop);
            else this.onScore(b, hoop);
          }
        }
      }
    }
    for (const b of this.balls) b.soundCooldown -= dt;
    this.hoops = this.hoops.filter((hp) => !hp.dead);
  }

  onBounce(ball, impact) {
    if (impact < this.unit * 0.25 || ball.soundCooldown > 0) return;
    ball.soundCooldown = 0.06;
    this.sound.bounce(clamp(impact / (this.unit * 2.5), 0.1, 1));
  }

  collideBalls() {
    const balls = this.balls;
    const e = CONFIG.BALL_BOUNCE;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        if (a.held && b.held) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const minD = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2) || 0.0001;
        const nx = dx / d, ny = dy / d;
        const overlap = minD - d;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;

        if (a.held || b.held) {
          // ลูกที่ถืออยู่ดันลูกอื่นออกไป
          const free = a.held ? b : a;
          const dir = a.held ? 1 : -1;
          free.x += nx * overlap * dir;
          free.y += ny * overlap * dir;
          if (vn < 0) {
            const j2 = (1 + e) * vn * dir;
            free.vx -= j2 * nx;
            free.vy -= j2 * ny;
          }
        } else {
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          b.x += nx * overlap / 2; b.y += ny * overlap / 2;
          if (vn < 0) {
            const imp = ((1 + e) * vn) / 2;
            a.vx += imp * nx; a.vy += imp * ny;
            b.vx -= imp * nx; b.vy -= imp * ny;
            if (-vn > this.unit * 0.5) this.onBounce(a, -vn * 0.6);
          }
        }
      }
    }
  }

  separateHoops() {
    const hs = this.hoops;
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const a = hs[i], b = hs[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const minD = (a.halfW + b.halfW) * 1.3;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d === 0) continue;
        const push = (minD - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
  }

  // ---------- คะแนน ----------
  onScore(ball, hoop) {
    hoop.score();
    ball.lastHoop = hoop;
    this.baskets++;
    this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, CONFIG.MAX_COMBO) : 1;
    this.comboTimer = CONFIG.COMBO_WINDOW;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const swish = !ball.touchedRim;
    const points = (CONFIG.POINTS_PER_BASKET + (swish ? CONFIG.SWISH_BONUS : 0)) * this.combo;
    this.score += points;

    this.sound.swish();
    this.sound.score(this.combo);
    const size = this.R * 1.1;
    this.effects.burst(hoop.x, hoop.y, CONFETTI_COLORS, 30, this.unit * 0.9, this.R * 0.35);
    this.effects.text(hoop.x, hoop.y - hoop.halfW * 0.7, `+${points}`, '#facc15', size * 1.2);
    if (swish) this.effects.text(hoop.x, hoop.y - hoop.halfW * 1.5, 'SWISH!', '#38bdf8', size, 0.1);
    if (this.combo > 1) this.effects.text(hoop.x, hoop.y - hoop.halfW * 2.3, `x${this.combo} COMBO`, '#f472b6', size, 0.2);

    this.ui.setScore(this.score, true);
    this.ui.setCombo(this.combo);
  }

  // ลงห่วงผี: หักคะแนนแบบสุ่ม และคอมโบหลุด
  onGhost(ball, hoop) {
    hoop.score();
    ball.lastHoop = hoop;
    this.ghostHits++;
    const min = CONFIG.GHOST_PENALTY_MIN, max = CONFIG.GHOST_PENALTY_MAX;
    const penalty = Math.floor(rand(min, max + 1));
    this.score = Math.max(0, this.score - penalty);
    this.combo = 0;
    this.comboTimer = 0;

    this.sound.ghost();
    const size = this.R * 1.1;
    this.effects.burst(hoop.x, hoop.y, GHOST_COLORS, 26, this.unit * 0.7, this.R * 0.35);
    this.effects.text(hoop.x, hoop.y - hoop.halfW * 0.7, `-${penalty}`, '#ef4444', size * 1.3);
    this.effects.text(hoop.x, hoop.y - hoop.halfW * 1.6, 'ห่วงผี!', '#c084fc', size, 0.1);

    this.ui.setScore(this.score, false, true);
    this.ui.setCombo(0);
  }

  updateMoveSound() {
    let maxSpeed = 0;
    for (const b of this.balls) {
      if (b.held || b.y < this.P.floorY - b.r * 1.5) maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy));
    }
    this.sound.setMove(Math.min(1, maxSpeed / (this.unit * CONFIG.MAX_THROW_SPEED)));
  }

  updateHint(dt) {
    const playing = this.state === 'playing' || this.state === 'countdown';
    if (playing && this.input.cameraOn && this.input.trackedHandCount === 0) this.noHandTime += dt;
    else this.noHandTime = 0;
    this.ui.hint(this.noHandTime > 1.5);
  }

  // ---------- วาด ----------
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H); // ไม่มีพื้นหลัง: มองทะลุเห็นภาพจากกล้อง

    for (const h of this.hoops) h.drawBack(ctx);
    for (const b of this.balls) b.drawShadow(ctx, this.P.floorY, this.H);
    for (const b of this.balls) if (!b.held) b.draw(ctx);
    for (const h of this.hoops) h.drawFront(ctx);
    for (const b of this.balls) if (b.held) b.draw(ctx); // ลูกที่ถืออยู่ใกล้กล้องกว่า วาดทับห่วง
    this.effects.draw(ctx);
    this.drawHands(ctx);
  }

  drawHands(ctx) {
    const dot = Math.max(5, this.R * 0.28);
    const pulse = 1 + Math.sin(performance.now() / 150) * 0.08;

    for (const h of this.input.hands) {
      // วงแหวนบอกว่าลูกไหนหยิบได้
      if (!this.holds.has(h.id)) {
        const b = this.findBallNear(h.pinch.x, h.pinch.y);
        if (b) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * 1.3 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = Math.max(2, this.R * 0.1);
          ctx.stroke();
        }
      }

      const color = h.pinching ? '#facc15' : '#ffffff';
      if (h.isPointer) {
        this.drawDot(ctx, h.pinch.x, h.pinch.y, dot * 0.9, color);
        continue;
      }
      // เคอร์เซอร์ 2 จุด: ปลายนิ้วโป้ง + ปลายนิ้วชี้
      ctx.beginPath();
      ctx.moveTo(h.thumb.x, h.thumb.y);
      ctx.lineTo(h.index.x, h.index.y);
      ctx.strokeStyle = h.pinching ? 'rgba(250,204,21,0.8)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(2, dot * 0.35);
      ctx.stroke();
      this.drawDot(ctx, h.thumb.x, h.thumb.y, dot, color);
      this.drawDot(ctx, h.index.x, h.index.y, dot, color);
      if (h.pinching) {
        ctx.beginPath();
        ctx.arc(h.pinch.x, h.pinch.y, dot * 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = Math.max(2, dot * 0.4);
        ctx.stroke();
      }
    }
  }

  drawDot(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1.5, r * 0.3);
    ctx.stroke();
  }
}
