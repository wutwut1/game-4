// =====================================================
//  ลูกบอล: ฟิสิกส์เบา ๆ (แรงโน้มถ่วง เด้ง กลิ้ง หมุน ยุบตัว)
// =====================================================
import { CONFIG } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PAD = 2;

// วาดลูกบอลเก็บไว้ล่วงหน้า (ตัวลูก + ลายเส้น) ไม่ต้องวาดใหม่ทุกเฟรม = ลื่นขึ้นมาก
function makeSprites(r, color, dpr) {
  const make = (draw) => {
    const size = Math.ceil((r + PAD) * 2 * dpr);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    draw(g, r + PAD);
    return cv;
  };

  const body = make((g, c) => {
    const grad = g.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
    grad.addColorStop(0, color.light);
    grad.addColorStop(0.45, color.base);
    grad.addColorStop(1, color.dark);
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = Math.max(1, r * 0.05);
    g.stroke();
  });

  const seams = make((g, c) => {
    g.beginPath();
    g.arc(c, c, r * 0.97, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = Math.max(1, r * 0.07);
    g.beginPath();
    g.moveTo(c, c - r);
    g.lineTo(c, c + r);
    g.moveTo(c - r, c);
    g.lineTo(c + r, c);
    // เส้นโค้งซ้าย/ขวาแบบลูกบาส
    g.moveTo(c - r * 0.3, c);
    g.arc(c - r * 1.15, c, r * 0.85, 0, Math.PI * 2);
    g.moveTo(c + r * 2, c);
    g.arc(c + r * 1.15, c, r * 0.85, 0, Math.PI * 2);
    g.stroke();
  });

  return { body, seams };
}

export class Ball {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.prevY = y;
    this.color = color;
    this.r = 10;
    this.angle = Math.random() * Math.PI * 2;
    this.spin = 0;
    this.squash = 0;        // ยุบตัวตอนกระแทกพื้น
    this.held = false;
    this.touchedRim = false; // ใช้ดูว่าเป็น swish หรือไม่
    this.lastHoop = null;    // กันนับคะแนนซ้ำห่วงเดิม
    this.soundCooldown = 0;
  }

  setRadius(r, dpr) {
    this.r = r;
    this.sprites = makeSprites(r, this.color, dpr);
  }

  grab() {
    this.held = true;
    this.touchedRim = false;
    this.lastHoop = null;
  }

  release(maxSpeed) {
    this.held = false;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      this.vx *= maxSpeed / speed;
      this.vy *= maxSpeed / speed;
    }
    this.spin = this.vx / this.r;
    return Math.min(speed, maxSpeed);
  }

  // ตอนถือ: บอลวิ่งตามนิ้ว และจำความเร็วไว้ใช้ตอนโยน
  follow(tx, ty, dt, P) {
    const k = 1 - Math.exp(-dt * CONFIG.HOLD_FOLLOW);
    const nx = clamp(this.x + (tx - this.x) * k, this.r, P.width - this.r);
    const ny = clamp(this.y + (ty - this.y) * k, this.r, P.floorY - this.r);
    if (dt > 0) {
      this.vx += ((nx - this.x) / dt - this.vx) * 0.35;
      this.vy += ((ny - this.y) / dt - this.vy) * 0.35;
    }
    this.x = nx;
    this.y = ny;
    this.spin *= 0.95;
    this.angle += this.spin * dt;
  }

  // คืนค่าความแรงที่กระแทกพื้น/ผนัง (0 = ไม่ได้ชน)
  step(dt, P) {
    let impact = 0;
    this.vy += P.gravity * dt;
    const drag = Math.max(0, 1 - P.airDrag * dt);
    this.vx *= drag;
    this.vy *= drag;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // พื้น
    if (this.y + this.r > P.floorY) {
      this.y = P.floorY - this.r;
      if (this.vy > 0) {
        impact = this.vy;
        this.squash = Math.min(0.3, this.squash + (this.vy / P.unit) * 0.1);
        this.vy = this.vy < P.restSpeed ? 0 : -this.vy * P.floorBounce;
      }
      this.vx *= Math.exp(-P.rollFriction * dt);
      this.spin = this.vx / this.r;
    }
    // ผนังซ้าย/ขวา และเพดาน
    if (this.x - this.r < 0) {
      this.x = this.r;
      if (this.vx < 0) { impact = Math.max(impact, -this.vx); this.vx = -this.vx * P.wallBounce; }
    } else if (this.x + this.r > P.width) {
      this.x = P.width - this.r;
      if (this.vx > 0) { impact = Math.max(impact, this.vx); this.vx = -this.vx * P.wallBounce; }
    }
    if (this.y - this.r < 0) {
      this.y = this.r;
      if (this.vy < 0) { impact = Math.max(impact, -this.vy); this.vy = -this.vy * P.wallBounce; }
    }

    this.angle += this.spin * dt;
    this.squash *= Math.exp(-dt * 12);
    return impact;
  }

  drawShadow(ctx, floorY, screenH) {
    const height = floorY - (this.y + this.r);
    const f = 1 - height / (screenH * 0.6);
    if (f <= 0) return;
    ctx.globalAlpha = 0.35 * f;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, floorY - 1, this.r * (0.5 + 0.6 * f), this.r * 0.2 * (0.6 + 0.4 * f), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  draw(ctx) {
    const r = this.r * (this.held ? 1.1 : 1);
    const s = this.squash;
    const size = (r + PAD) * 2;
    ctx.save();
    ctx.translate(this.x, this.y + this.r * s);
    ctx.scale(1 + s * 0.7, 1 - s);
    ctx.drawImage(this.sprites.body, -size / 2, -size / 2, size, size);
    ctx.rotate(this.angle);
    ctx.drawImage(this.sprites.seams, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}
