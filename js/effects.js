// =====================================================
//  เอฟเฟกต์: พลุกระดาษตอนลงห่วง และตัวเลขคะแนนลอยขึ้น
// =====================================================

const MAX_PARTICLES = 300;

export class Effects {
  constructor() {
    this.particles = [];
    this.texts = [];
  }

  clear() {
    this.particles.length = 0;
    this.texts.length = 0;
  }

  burst(x, y, colors, count, speed, size) {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const life = 0.7 + Math.random() * 0.5;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.4,
        life, maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  text(x, y, str, color, size, delay = 0) {
    this.texts.push({ x, y, str, color, size, life: 1.1, maxLife: 1.1, delay });
  }

  update(dt, gravity) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += gravity * dt;
      p.vx *= 0.98;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      if (t.delay > 0) { t.delay -= dt; continue; }
      t.y -= t.size * 1.4 * dt;
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5));
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      if (t.delay > 0) continue;
      const age = t.maxLife - t.life;
      const pop = age < 0.15 ? 0.6 + (age / 0.15) * 0.5 : 1.1 - Math.min(0.1, (age - 0.15));
      ctx.globalAlpha = Math.min(1, t.life / 0.4);
      ctx.font = `900 ${Math.round(t.size * pop)}px system-ui, "Segoe UI", sans-serif`;
      ctx.lineWidth = t.size * 0.16;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
