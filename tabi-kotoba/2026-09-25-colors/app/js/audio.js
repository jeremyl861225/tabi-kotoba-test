// 發音：預錄音檔，Nanami（女）與 Keita（男）。一個 <audio> 重複使用——
// iOS 只要第一次是點擊觸發，之後同一個元素就能自動播放，而且靜音鍵開著也有聲音。
import { store } from './store.js';

export const AUDIO_CACHE = 'tabi-kotoba-audio';
const VOICES = { n: '女聲', k: '男聲' };
const player = new Audio();
player.preload = 'auto';
let flip = 0;
let playingBtn = null;

export const voiceName = (v) => VOICES[v];

export function nextVoice() {
  const v = store.settings.voice;
  if (v === 'n' || v === 'k') return v;
  return flip % 2 === 0 ? 'n' : 'k';
}

export function audioUrl(id, part, voice) {
  return `audio/${voice}/${id}${part === 'x' ? 'x' : ''}.mp3`;
}

function clearPlaying() {
  if (playingBtn) playingBtn.classList.remove('playing');
  playingBtn = null;
}
player.addEventListener('ended', clearPlaying);
player.addEventListener('pause', clearPlaying);

// part: 'w' 單字、'x' 例句；回傳實際用的聲音
export function play(id, part = 'w', btn = null, voice = null) {
  const v = voice || nextVoice();
  if (!voice && store.settings.voice === 'alt') flip++;
  clearPlaying();
  player.pause();
  player.src = audioUrl(id, part, v);
  player.defaultPlaybackRate = store.settings.rate;
  player.playbackRate = store.settings.rate;
  if ('preservesPitch' in player) player.preservesPitch = true;
  if (btn) { playingBtn = btn; btn.classList.add('playing'); }
  const p = player.play();
  if (p && p.catch) {
    p.catch((err) => {
      clearPlaying();
      if (err && err.name === 'NotAllowedError') return; // 尚未點擊過，瀏覽器不讓自動播放
      document.dispatchEvent(new CustomEvent('audio-error', { detail: { id, part } }));
    });
  }
  return v;
}

export function stop() { player.pause(); }

// 離線下載：把音檔放進獨立快取（改版不會清掉）
export async function cachedSet() {
  if (!('caches' in window)) return new Set();
  const c = await caches.open(AUDIO_CACHE);
  const keys = await c.keys();
  return new Set(keys.map((r) => new URL(r.url).pathname.split('/audio/')[1]));
}

export async function downloadAudio(urls, onProgress, signal) {
  const c = await caches.open(AUDIO_CACHE);
  const have = await cachedSet();
  const todo = urls.filter((u) => !have.has(u.replace(/^audio\//, '')));
  let done = urls.length - todo.length;
  let failed = 0;
  onProgress(done, urls.length, failed);
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      if (signal && signal.aborted) return;
      const u = todo[i++];
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (!res.ok) throw new Error(res.status);
        await c.put(u, res);
      } catch (e) {
        failed++;
      }
      done++;
      onProgress(done, urls.length, failed);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { done, failed };
}
