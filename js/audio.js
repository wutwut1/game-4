// =====================================================
//  เสียงทั้งหมดสร้างด้วย Web Audio API (ไม่ต้องโหลดไฟล์เสียง)
//  เบาเครื่องและเล่นได้ทุกเบราว์เซอร์
// =====================================================
import { CONFIG } from './config.js';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// คอร์ดของเพลงพื้นหลัง: C - Am - F - G (วนทุก 4 ห้อง)
const CHORDS = [
  { root: 48, notes: [0, 4, 7] },
  { root: 45, notes: [0, 3, 7] },
  { root: 41, notes: [0, 4, 7] },
  { root: 43, notes: [0, 4, 7] },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicTimer = null;
  }

  // ต้องเรียกตอนผู้เล่นกดปุ่มครั้งแรก (เบราว์เซอร์บังคับ)
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const c = (this.ctx = new AudioCtx());

    const compressor = c.createDynamicsCompressor();
    compressor.connect(c.destination);

    this.sfx = c.createGain();
    this.sfx.gain.value = CONFIG.SFX_VOLUME;
    this.sfx.connect(compressor);

    this.music = c.createGain();
    this.music.gain.value = CONFIG.MUSIC_VOLUME;
    this.music.connect(compressor);

    // white noise 1 วินาที ใช้ทำเสียงลม / ฉาบ / เสียงตาข่าย
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // เสียงลมต่อเนื่องตอนบอลเคลื่อนที่ (ปรับดังเบาตามความเร็ว)
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.whooshFilter = c.createBiquadFilter();
    this.whooshFilter.type = 'bandpass';
    this.whooshFilter.Q.value = 0.8;
    this.whooshGain = c.createGain();
    this.whooshGain.gain.value = 0;
    src.connect(this.whooshFilter).connect(this.whooshGain).connect(this.sfx);
    src.start();
  }

  // ---------- ตัวช่วยสร้างเสียง ----------
  tone({ freq, freqEnd, dur, vol, type = 'sine', at, attack = 0.005, dest }) {
    const c = this.ctx;
    if (!c) return;
    const t = at ?? c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ freq, freqEnd, dur, vol, filter = 'bandpass', q = 1, at, attack = 0.005, dest }) {
    const c = this.ctx;
    if (!c) return;
    const t = at ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- เสียงในเกม ----------
  uiClick()   { this.tone({ freq: 660, freqEnd: 990, dur: 0.06, vol: 0.12, type: 'triangle' }); }
  pinchEmpty(){ this.tone({ freq: 1300, dur: 0.035, vol: 0.06 }); }

  grab() {
    this.tone({ freq: 380, freqEnd: 900, dur: 0.1, vol: 0.3 });
    this.tone({ freq: 1200, dur: 0.05, vol: 0.06, type: 'triangle' });
  }

  release(power) {
    if (power > 0.15) {
      this.noise({ freq: 700, freqEnd: 2600, dur: 0.22, vol: 0.1 + power * 0.3, q: 0.9 });
    } else {
      this.tone({ freq: 700, freqEnd: 420, dur: 0.08, vol: 0.12 });
    }
  }

  // strength 0..1
  bounce(strength) {
    this.tone({ freq: 150 + strength * 40, freqEnd: 55, dur: 0.18, vol: 0.15 + strength * 0.5 });
    this.noise({ freq: 900, dur: 0.04, vol: 0.05 + strength * 0.15, filter: 'lowpass' });
  }

  rim(strength) {
    const v = 0.05 + strength * 0.2;
    this.tone({ freq: 1250, dur: 0.3, vol: v, type: 'triangle' });
    this.tone({ freq: 1870, dur: 0.4, vol: v * 0.6 });
    this.tone({ freq: 610, dur: 0.08, vol: v * 0.4, type: 'square' });
  }

  swish() {
    this.noise({ freq: 5200, freqEnd: 2200, dur: 0.35, vol: 0.32, q: 0.7, attack: 0.02 });
  }

  score(combo) {
    const shift = Math.min(combo - 1, 5) * 2;
    [72, 76, 79, 84].forEach((n, i) => {
      this.tone({ freq: midiToFreq(n + shift), dur: 0.28, vol: 0.18, type: 'triangle',
                  at: this.ctx && this.ctx.currentTime + 0.05 + i * 0.065 });
    });
  }

  // ลงห่วงผี: เสียงหัวเราะต่ำ ๆ ไล่ลง + เสียงลมหลอน
  ghost() {
    const t0 = this.ctx && this.ctx.currentTime;
    [0, 1, 2].forEach((i) => {
      this.tone({ freq: 330 - i * 60, freqEnd: 200 - i * 45, dur: 0.22, vol: 0.16, type: 'sawtooth',
                  at: t0 + i * 0.16 });
    });
    this.noise({ freq: 900, freqEnd: 250, dur: 0.6, vol: 0.18, q: 4, attack: 0.05 });
  }

  ghostSpawn() { this.tone({ freq: 220, freqEnd: 140, dur: 0.3, vol: 0.07, type: 'triangle' }); }

  hoopSpawn() { this.tone({ freq: 320, freqEnd: 720, dur: 0.16, vol: 0.08 }); }
  hoopLeave() { this.tone({ freq: 600, freqEnd: 260, dur: 0.18, vol: 0.06 }); }

  tick(urgent) { this.tone({ freq: urgent ? 1400 : 1000, dur: 0.05, vol: urgent ? 0.14 : 0.08, type: 'square' }); }

  beep(go) {
    if (go) {
      this.tone({ freq: 880, dur: 0.5, vol: 0.28, type: 'triangle' });
      this.tone({ freq: 1320, dur: 0.5, vol: 0.12 });
    } else {
      this.tone({ freq: 440, dur: 0.18, vol: 0.25, type: 'triangle' });
    }
  }

  gameOver() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [79, 76, 72, 84].forEach((n, i) => {
      this.tone({ freq: midiToFreq(n), dur: i === 3 ? 0.9 : 0.22, vol: 0.2, type: 'triangle', at: t + i * 0.16 });
    });
  }

  // speed01: 0 = นิ่ง, 1 = เร็วสุด
  setMove(speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.whooshGain.gain.setTargetAtTime(speed01 * speed01 * 0.35, t, 0.05);
    this.whooshFilter.frequency.setTargetAtTime(300 + speed01 * 2200, t, 0.05);
  }

  // ---------- เปิด/ปิด ----------
  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.value = on ? CONFIG.SFX_VOLUME : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.value = on ? CONFIG.MUSIC_VOLUME : 0;
  }

  pause()  { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }

  // ---------- เพลงพื้นหลัง (สร้างสดทีละโน้ต) ----------
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 25);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  scheduleMusic() {
    const sixteenth = 60 / CONFIG.MUSIC_BPM / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += sixteenth;
      this.step++;
    }
  }

  playStep(step, t) {
    const s = step % 16;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
    const m = this.music;

    if (s === 0 || s === 8 || s === 11) {                     // กลองเบส
      this.tone({ freq: 120, freqEnd: 45, dur: 0.2, vol: 0.45, at: t, dest: m });
    }
    if (s === 4 || s === 12) {                                // สแนร์
      this.noise({ freq: 1800, dur: 0.12, vol: 0.12, at: t, dest: m });
    }
    if (s % 2 === 0) {                                        // ไฮแฮท
      this.noise({ freq: 8000, dur: 0.03, vol: s % 4 === 2 ? 0.07 : 0.035, filter: 'highpass', at: t, dest: m });
    }
    if (s === 0 || s === 6 || s === 8 || s === 14) {          // เบส
      const n = chord.root + (s === 14 ? 7 : 0);
      this.tone({ freq: midiToFreq(n), dur: 0.24, vol: 0.22, type: 'triangle', at: t, dest: m });
    }
    if (s % 2 === 0) {                                        // อาร์เพจจิโอ
      const n = chord.root + 24 + chord.notes[ARP[(s / 2) % ARP.length]];
      this.tone({ freq: midiToFreq(n), dur: 0.16, vol: 0.06, type: 'triangle', at: t, dest: m });
    }
  }
}
