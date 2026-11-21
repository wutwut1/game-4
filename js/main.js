// =====================================================
//  จุดเริ่มต้น: สร้างระบบต่าง ๆ แล้วผูกปุ่ม / คีย์ลัด
// =====================================================
import { Sound } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const sound = new Sound();
const ui = new UI();
const input = new Input($('camera'), $('game'));
const game = new Game({ canvas: $('game'), sound, input, ui });

// เปิด index.html?debug แล้วพิมพ์ game ใน Console เพื่อดู/แก้ค่าในเกมได้
if (new URLSearchParams(location.search).has('debug')) window.game = game;

// กันหน้าจอมือถือดับระหว่างเล่น (เล่นด้วยมือ ไม่ได้แตะจอ)
let wakeLock = null;
async function keepScreenOn() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ไม่รองรับก็ไม่เป็นไร */ }
}

function startGame() {
  keepScreenOn();
  game.start();
}

function cameraErrorText(err) {
  if (err?.name === 'NotAllowedError') return 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์ แล้วลองใหม่';
  if (err?.name === 'NotFoundError') return 'ไม่พบกล้องในเครื่องนี้ — ลองเล่นด้วยเมาส์ / ทัชสกรีน';
  if (err?.name === 'NotReadableError') return 'กล้องถูกใช้งานโดยโปรแกรมอื่นอยู่ — ปิดโปรแกรมนั้นแล้วลองใหม่';
  return 'โหลดไม่สำเร็จ: ' + (err?.message || err) + ' — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
}

// ทุกปุ่ม: เปิดระบบเสียง (ต้องทำตอนผู้ใช้กดครั้งแรก) + เสียงคลิก
function onClick(id, fn) {
  $(id).addEventListener('click', (e) => {
    sound.init();
    sound.uiClick();
    fn(e);
    e.currentTarget.blur();
  });
}

onClick('btn-start-camera', async () => {
  if (input.cameraOn) return startGame();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    ui.setStatus('ต้องเปิดเกมผ่าน https:// หรือ localhost ถึงจะใช้กล้องได้', true);
    return;
  }
  ui.setBusy(true);
  try {
    await input.startCamera((msg) => ui.setStatus(msg));
    document.body.classList.add('camera-on');
    ui.setStatus('');
    startGame();
  } catch (err) {
    console.error(err);
    ui.setStatus(cameraErrorText(err), true);
  } finally {
    ui.setBusy(false);
  }
});

onClick('btn-start-mouse', startGame);
onClick('btn-pause', () => game.togglePause());
onClick('btn-resume', () => game.resume());
onClick('btn-restart', startGame);
onClick('btn-pause-menu', () => game.toMenu());
onClick('btn-again', startGame);
onClick('btn-over-menu', () => game.toMenu());

onClick('btn-sound', () => {
  sound.setSfx(!sound.sfxOn);
  ui.setToggle('btn-sound', sound.sfxOn);
});
onClick('btn-music', () => {
  sound.setMusic(!sound.musicOn);
  ui.setToggle('btn-music', sound.musicOn);
});

if (document.fullscreenEnabled) {
  onClick('btn-fullscreen', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
} else {
  $('btn-fullscreen').classList.add('hidden'); // เช่น iPhone ไม่รองรับ
}

// คีย์ลัด: P / Esc = หยุด, M = เสียง, N = เพลง
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'p' || key === 'escape') game.togglePause();
  else if (key === 'm') $('btn-sound').click();
  else if (key === 'n') $('btn-music').click();
});

// สลับแอป / แท็บ = หยุดเกมอัตโนมัติ
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
  else if (wakeLock?.released && game.state !== 'menu') keepScreenOn();
});
