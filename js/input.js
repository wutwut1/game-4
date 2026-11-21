// =====================================================
//  อินพุต: ตรวจจับมือจากกล้อง (MediaPipe) + เมาส์/ทัช สำรอง
//  ทั้งสองแบบให้ข้อมูล "มือ" หน้าตาเดียวกัน:
//  { id, thumb:{x,y}, index:{x,y}, pinch:{x,y}, pinching, isPointer }
// =====================================================
import { CONFIG } from './config.js';

const MP_VERSION = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// เลขจุดบนมือของ MediaPipe
const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_BASE = 9;

class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.hands = new Map();
    this.lastVideoTime = -1;
    this.lastDetect = 0;
    this.detectInterval = 0;
    this.avgCost = 0;
    this.W = 1;
    this.H = 1;
  }

  get ready() { return !!this.landmarker; }

  async start(onStatus) {
    onStatus('กำลังเปิดกล้อง...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    onStatus('กำลังโหลดระบบตรวจจับมือ...');
    const { FilesetResolver, HandLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: CONFIG.MAX_HANDS,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('GPU ใช้ไม่ได้ เปลี่ยนไปใช้ CPU', err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  update(now, dt, W, H) {
    this.W = W;
    this.H = H;
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || !v.videoWidth) return;

    // ตรวจจับเฉพาะเมื่อกล้องมีภาพใหม่ และเว้นระยะอัตโนมัติถ้าเครื่องช้า
    if (v.currentTime !== this.lastVideoTime && now - this.lastDetect >= this.detectInterval) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      const result = this.landmarker.detectForVideo(v, t0);
      const cost = performance.now() - t0;
      this.avgCost = this.avgCost * 0.9 + cost * 0.1;
      this.detectInterval = this.avgCost > 12 ? this.avgCost * 1.5 : 0;
      this.lastDetect = now;
      this.applyResult(result, now);
    }
    this.smooth(dt, now);
  }

  // แปลงพิกัดในภาพกล้อง (0..1) เป็นพิกัดบนจอ (กล้องแสดงแบบ cover และกลับซ้ายขวาเหมือนกระจก)
  toScreen(p) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const scale = Math.max(this.W / vw, this.H / vh);
    const dw = vw * scale, dh = vh * scale;
    const x = (this.W - dw) / 2 + p.x * dw;
    const y = (this.H - dh) / 2 + p.y * dh;
    return { x: this.W - x, y };
  }

  applyResult(result, now) {
    const all = result.landmarks || [];
    const sides = result.handednesses || result.handedness || [];
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const dist = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const used = new Set();

    all.forEach((lm, i) => {
      let id = sides[i]?.[0]?.categoryName || 'hand';
      if (used.has(id)) id += i;
      used.add(id);

      const thumb = this.toScreen(lm[THUMB_TIP]);
      const index = this.toScreen(lm[INDEX_TIP]);
      // ระยะนิ้วโป้ง-นิ้วชี้ เทียบกับขนาดฝ่ามือ (ใกล้/ไกลกล้องก็ใช้ได้เหมือนกัน)
      const ratio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / Math.max(1e-6, dist(lm[WRIST], lm[MIDDLE_BASE]));

      let hand = this.hands.get(id);
      if (!hand) {
        hand = { id, thumb: { ...thumb }, index: { ...index }, pinch: { x: 0, y: 0 }, pinching: false, isPointer: false };
        this.hands.set(id, hand);
      }
      hand.targetThumb = thumb;
      hand.targetIndex = index;
      hand.lastSeen = now;
      if (hand.pinching) {
        if (ratio > CONFIG.PINCH_END) hand.pinching = false;
      } else if (ratio < CONFIG.PINCH_START) {
        hand.pinching = true;
      }
    });
  }

  // ทำให้เคอร์เซอร์เคลื่อนที่นุ่มนวลทุกเฟรม แม้กล้องจะได้ภาพแค่ 30 fps
  smooth(dt, now) {
    const k = 1 - Math.exp(-dt * CONFIG.HAND_SMOOTH);
    for (const [id, h] of this.hands) {
      if (now - h.lastSeen > CONFIG.HAND_LOST_MS) {
        this.hands.delete(id);
        continue;
      }
      h.thumb.x += (h.targetThumb.x - h.thumb.x) * k;
      h.thumb.y += (h.targetThumb.y - h.thumb.y) * k;
      h.index.x += (h.targetIndex.x - h.index.x) * k;
      h.index.y += (h.targetIndex.y - h.index.y) * k;
      h.pinch.x = (h.thumb.x + h.index.x) / 2;
      h.pinch.y = (h.thumb.y + h.index.y) / 2;
    }
  }
}

export class Input {
  constructor(video, canvas) {
    this.tracker = new HandTracker(video);
    this.pointers = new Map();
    this.hands = [];

    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* บางเบราว์เซอร์ไม่รองรับ */ }
      const p = this.pointerFrom(e);
      p.pinching = true;
    });
    canvas.addEventListener('pointermove', (e) => this.pointerFrom(e));
    const end = (e) => {
      const p = this.pointers.get('p' + e.pointerId);
      if (!p) return;
      p.pinching = false;
      if (e.pointerType !== 'mouse' || e.type === 'pointerleave') this.pointers.delete(p.id);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  get cameraOn() { return this.tracker.ready; }
  get trackedHandCount() { return this.tracker.hands.size; }

  startCamera(onStatus) { return this.tracker.start(onStatus); }

  pointerFrom(e) {
    const id = 'p' + e.pointerId;
    let p = this.pointers.get(id);
    if (!p) {
      const pos = { x: e.clientX, y: e.clientY };
      p = { id, thumb: pos, index: pos, pinch: pos, pinching: false, isPointer: true };
      this.pointers.set(id, p);
    }
    p.pinch.x = e.clientX;
    p.pinch.y = e.clientY;
    return p;
  }

  update(now, dt, W, H) {
    this.tracker.update(now, dt, W, H);
    this.hands = [...this.tracker.hands.values(), ...this.pointers.values()];
  }
}
