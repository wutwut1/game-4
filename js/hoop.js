// =====================================================
//  ห่วง: เกิดแบบสุ่ม ลอยไปมาแบบไร้ทิศทาง อยู่แต่ในโซนด้านบน
// =====================================================

const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const APPEAR_TIME = 0.4;
const SCORED_TIME = 0.7;
const LEAVE_TIME = 0.3;

export class Hoop {
  constructor(x, y, halfWidth, ghost = false) {
    this.ghost = ghost;  // ห่วงผี: ลงแล้วโดนหักคะแนน
    this.clock = Math.random() * 10; // ใช้ทำแอนิเมชันลอย/กระพริบของห่วงผี
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.turn = 0;
    this.state = 'in';   // in → live → scored / out → dead
    this.t = 0;          // เวลาที่อยู่ในสถานะปัจจุบัน
    this.age = 0;
    this.lifetime = 12;
    this.scale = 0;
    this.alpha = 1;
    this.netPulse = 0;
    this.soundCooldown = 0;
    this.setSize(halfWidth);
  }

  setSize(halfWidth) {
    this.halfW = halfWidth;
    this.rimR = Math.max(2, halfWidth * 0.075);
    this.ellH = halfWidth * 0.28;
    this.netH = halfWidth * 1.05;
  }

  get canScore() { return this.state === 'live'; }
  get solid() { return this.state === 'live' || (this.state === 'in' && this.t > APPEAR_TIME * 0.5); }
  get active() { return this.state === 'in' || this.state === 'live'; }
  get dead() { return this.state === 'dead'; }

  setState(s) { this.state = s; this.t = 0; }
  score() { this.setState('scored'); this.netPulse = 1; }
  leave() { if (this.state !== 'dead' && this.state !== 'out') this.setState('out'); }

  update(dt, zone, speed) {
    this.t += dt;
    this.clock += dt;
    this.netPulse = Math.max(0, this.netPulse - dt * 2.2);
    this.soundCooldown -= dt;

    if (this.state === 'in') {
      this.scale = easeOutBack(Math.min(1, this.t / APPEAR_TIME));
      if (this.t >= APPEAR_TIME) this.setState('live');
    } else if (this.state === 'live') {
      this.scale = 1;
      this.age += dt;
      if (this.age > this.lifetime) this.leave();
    } else if (this.state === 'scored') {
      this.scale = 1 + 0.12 * Math.sin(Math.min(1, this.t / 0.25) * Math.PI);
      this.alpha = 1 - clamp((this.t - 0.35) / 0.35, 0, 1);
      if (this.t >= SCORED_TIME) this.setState('dead');
    } else if (this.state === 'out') {
      this.scale = 1 - this.t / LEAVE_TIME;
      this.alpha = this.scale;
      if (this.t >= LEAVE_TIME) this.setState('dead');
    }

    // ลอยไปมา: ทิศทางค่อย ๆ เปลี่ยนแบบสุ่ม
    this.turn = clamp(this.turn + (Math.random() - 0.5) * 9 * dt, -2.2, 2.2);
    this.heading += this.turn * dt;
    const k = 1 - Math.exp(-dt * 1.5);
    this.vx += (Math.cos(this.heading) * speed - this.vx) * k;
    this.vy += (Math.sin(this.heading) * speed * 0.75 - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ชนขอบโซนแล้วเปลี่ยนทิศ
    const left = zone.left + this.halfW + this.rimR;
    const right = zone.right - this.halfW - this.rimR;
    if (this.x < left)  { this.x = left;  this.vx = Math.abs(this.vx);  this.heading = Math.PI - this.heading; }
    if (this.x > right) { this.x = right; this.vx = -Math.abs(this.vx); this.heading = Math.PI - this.heading; }
    if (this.y < zone.top)    { this.y = zone.top;    this.vy = Math.abs(this.vy);  this.heading = -this.heading; }
    if (this.y > zone.bottom) { this.y = zone.bottom; this.vy = -Math.abs(this.vy); this.heading = -this.heading; }
  }

  // บอลชนขอบห่วงซ้าย/ขวา — คืนค่าความแรงที่ชน
  collide(ball, bounce) {
    let impact = 0;
    const minD = ball.r + this.rimR;
    for (const side of [-1, 1]) {
      const rx = this.x + side * this.halfW;
      const dx = ball.x - rx, dy = ball.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d, ny = dy / d;
      ball.x = rx + nx * minD;
      ball.y = this.y + ny * minD;
      const vn = (ball.vx - this.vx) * nx + (ball.vy - this.vy) * ny;
      if (vn < 0) {
        ball.vx -= (1 + bounce) * vn * nx;
        ball.vy -= (1 + bounce) * vn * ny;
        impact = Math.max(impact, -vn);
      }
      ball.touchedRim = true;
    }
    return impact;
  }

  // ลงห่วง = จุดกลางบอลผ่านระดับห่วงจากบนลงล่าง ภายในช่องห่วง
  checkScore(ball) {
    return !ball.held
      && ball.lastHoop !== this
      && ball.vy > 0
      && ball.prevY < this.y
      && ball.y >= this.y
      && Math.abs(ball.x - this.x) < this.halfW - ball.r * 0.2;
  }

  beginDraw(ctx) {
    if (this.scale <= 0.01 || this.alpha <= 0.01) return false;
    // กระพริบเตือนเมื่อห่วงใกล้หายไป
    const warn = this.state === 'live' && this.lifetime - this.age < 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    // ห่วงผีโปร่งแสงและกระพริบเบา ๆ ตลอดเวลา
    const flicker = this.ghost ? 0.82 + 0.12 * Math.sin(this.clock * 5) + 0.06 * Math.sin(this.clock * 17) : 1;
    ctx.globalAlpha = this.alpha * flicker * (warn ? 0.6 + 0.4 * Math.cos(this.age * 14) : 1);
    ctx.lineCap = 'round';
    return true;
  }

  rimArc(ctx, from, to, color) {
    ctx.beginPath();
    ctx.ellipse(0, 0, this.halfW, this.ellH, 0, from, to);
    if (this.ghost) {
      // ขอบห่วงผี: เรืองแสงสีม่วง
      ctx.shadowColor = '#c026d3';
      ctx.shadowBlur = this.rimR * 5;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = this.rimR * 2 + 3;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.rimR * 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ขอบห่วงด้านหลัง (วาดก่อนลูกบอล)
  drawBack(ctx) {
    if (!this.beginDraw(ctx)) return;
    if (this.ghost) {
      // หมอกสีม่วงเข้มในช่องห่วง ให้ดูเป็นหลุมดำน่ากลัว
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.halfW);
      g.addColorStop(0, 'rgba(30,10,50,0.75)');
      g.addColorStop(1, 'rgba(88,28,135,0.15)');
      ctx.beginPath();
      ctx.ellipse(0, 0, this.halfW, this.ellH, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    this.rimArc(ctx, Math.PI, Math.PI * 2, this.ghost ? '#581c87' : '#c2410c');
    ctx.restore();
  }

  // ตาข่าย + ขอบห่วงด้านหน้า (วาดหลังลูกบอล)
  drawFront(ctx) {
    if (!this.beginDraw(ctx)) return;
    if (this.ghost) { this.drawGhostFront(ctx); ctx.restore(); return; }
    const N = 8, LEVELS = 3;
    const sway = clamp(-this.vx / (this.halfW * 4), -0.3, 0.3) * this.halfW;
    const netH = this.netH * (1 + this.netPulse * 0.35);
    const point = (i, k) => {
      const a = Math.PI - (i / N) * Math.PI;
      const f = k / LEVELS;
      const w = 1 - 0.42 * f - this.netPulse * 0.1 * f;
      return [Math.cos(a) * this.halfW * w + sway * f * f, Math.sin(a) * this.ellH * (1 - f) + netH * f];
    };

    ctx.beginPath();
    for (let k = 0; k < LEVELS; k++) {
      for (let i = 0; i < N; i++) {
        const a = point(i, k), b = point(i + 1, k + 1);
        const c = point(i + 1, k), d = point(i, k + 1);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
      }
    }
    const first = point(0, LEVELS);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i <= N; i++) { const p = point(i, LEVELS); ctx.lineTo(p[0], p[1]); }
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(2, this.halfW * 0.045);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1, this.halfW * 0.025);
    ctx.stroke();

    this.rimArc(ctx, 0, Math.PI, '#f97316');
    // ไฮไลต์บนขอบห่วง
    ctx.beginPath();
    ctx.ellipse(0, -this.rimR * 0.4, this.halfW, this.ellH, 0, 0.25, Math.PI - 0.25);
    ctx.strokeStyle = 'rgba(255,237,213,0.8)';
    ctx.lineWidth = this.rimR * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- ห่วงผี: ตาข่ายขาดรุ่งริ่ง + ขอบมีหนาม + ผีลอยอยู่ด้านบน ----------
  drawGhostFront(ctx) {
    const w = this.halfW, c = this.clock;
    const netH = this.netH * (1 + this.netPulse * 0.4);

    // ตาข่ายเป็นเส้นควันห้อยยาวไม่เท่ากัน โบกไปมา
    const N = 7;
    ctx.lineWidth = Math.max(1.5, w * 0.04);
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - (i / N) * Math.PI;
      const x0 = Math.cos(a) * w, y0 = Math.sin(a) * this.ellH;
      const len = netH * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + 1)));
      const sway = Math.sin(c * 3 + i * 1.7) * w * 0.12;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 * 0.8 + sway, y0 + len * 0.5, x0 * 0.6 - sway * 0.6, y0 + len);
      ctx.strokeStyle = i % 2 ? 'rgba(74,222,128,0.6)' : 'rgba(192,132,252,0.75)';
      ctx.stroke();
    }

    this.rimArc(ctx, 0, Math.PI, '#a21caf');

    // หนามแหลมรอบขอบห่วงด้านหน้า = สัญญาณอันตราย
    ctx.fillStyle = '#f0abfc';
    const spikes = 7, sh = this.rimR * 2.4;
    for (let i = 0; i < spikes; i++) {
      const a = 0.2 + (i / (spikes - 1)) * (Math.PI - 0.4);
      const x = Math.cos(a) * w, y = Math.sin(a) * this.ellH;
      const nx = Math.cos(a), ny = Math.sin(a) * 0.6 + 0.4;
      const tx = -ny, ty = nx;
      const bw = this.rimR * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + tx * bw, y + ty * bw);
      ctx.lineTo(x + nx * (sh + this.rimR), y + ny * (sh + this.rimR));
      ctx.lineTo(x - tx * bw, y - ty * bw);
      ctx.closePath();
      ctx.fill();
    }

    this.drawGhostFace(ctx, 0, -w * 0.95 + Math.sin(c * 2.4) * w * 0.08, w * 0.42);
  }

  // ผีตัวเล็ก ๆ ทำหน้าโกรธ ลอยเหนือห่วงผี
  drawGhostFace(ctx, x, y, s) {
    const c = this.clock;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(c * 1.8) * 0.12);

    ctx.beginPath();
    ctx.moveTo(-s, s * 0.9);
    ctx.lineTo(-s, 0);
    ctx.arc(0, 0, s, Math.PI, 0);
    ctx.lineTo(s, s * 0.9);
    // ชายผ้าหยัก ๆ ด้านล่าง ขยับเหมือนลอยอยู่
    const waves = 4;
    for (let i = 0; i < waves; i++) {
      const x1 = s - ((i + 0.5) / waves) * 2 * s;
      const x2 = s - ((i + 1) / waves) * 2 * s;
      const dip = s * (1.25 + 0.12 * Math.sin(c * 6 + i));
      ctx.quadraticCurveTo(x1, dip, x2, s * 0.9);
    }
    ctx.closePath();
    ctx.shadowColor = '#c026d3';
    ctx.shadowBlur = s * 0.8;
    ctx.fillStyle = 'rgba(245,235,255,0.95)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.strokeStyle = 'rgba(88,28,135,0.9)';
    ctx.stroke();

    // ตาแดงก่ำ + คิ้วขมวด
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * s * 0.38, -s * 0.05, s * 0.2, s * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1e1b4b';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(side * s * 0.36, s * 0.02, s * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(side * s * 0.62, -s * 0.42);
      ctx.lineTo(side * s * 0.14, -s * 0.24);
      ctx.strokeStyle = '#1e1b4b';
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.stroke();
    }
    // ปากอ้าหัวเราะ
    ctx.beginPath();
    ctx.ellipse(0, s * 0.45, s * 0.2, s * 0.14 + Math.abs(Math.sin(c * 4)) * s * 0.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1b4b';
    ctx.fill();
    ctx.restore();
  }
}
