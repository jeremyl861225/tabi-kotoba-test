// HUD（v11 白色主題）：左上的暫停鈕＋分數板（戰役：第幾關、章節、敵人迷你坦克、命數；對戰：每隊一列回合點），
// 中央的關卡橫幅，下方的「新發現」坦克卡。
import { TANK_COLORS, TEAM_COLORS, tankTones } from './render.js';
import { TYPES } from './config.js';
import * as MAPS from './maps.js';
import { tankGlyph } from './icons.js';

const heart = '<svg class="i fill" viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.7 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>';
const motion = () => window.Motion;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function chapterOf(level) {
  const C = MAPS.CHAPTERS || [];
  return C.find((c) => level >= c.from && level < c.to) || null;
}

export class Hud {
  constructor(root, { onPause }) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top" hidden>
        <div class="hud-col left">
          <button class="hud-btn glass press" aria-label="暫停"><svg class="i"><use href="#i-pause"/></svg></button>
          <div class="board glass"></div>
        </div>
      </div>
      <div class="banner" hidden><div class="plate glass"><div class="kicker"></div><h2></h2><p></p><div class="tip" hidden></div></div></div>
      <div class="found glass" hidden><canvas></canvas><div><small>新發現</small><b></b><span></span></div></div>`;
    this.top = root.querySelector('.hud-top');
    this.board = root.querySelector('.board');
    this.bannerEl = root.querySelector('.banner');
    this.foundEl = root.querySelector('.found');
    root.querySelector('.hud-btn').addEventListener('click', () => onPause());
    this.key = '';
    this.bannerKey = '';
  }

  show(on) { this.top.hidden = !on; if (!on) { this.hideBanner(true); this.foundEl.hidden = true; } }

  // 單人：分數板在左側（直排）；雙人：場地上方置中（左右兩側被兩個人的搖桿佔了）
  setLayout(kind) { this.root.classList.toggle('duo', kind === 'duo'); }

  // view：game.view() 或客人收到的摘要；tanks：全部坦克
  update(view, me, tanks) {
    if (!view) return;
    let html = '';
    if (view.mode === 'campaign') {
      const ch = chapterOf(view.level);
      const foes = tanks.filter((t) => t.team === 1);
      const lives = Array.from({ length: Math.max(view.lives, 0) }, () => heart).join('');
      html = `<div class="ttl"><span>第</span><b>${view.level + 1}</b><span>關</span></div>
        ${ch ? `<div class="chap">${esc(ch.short || ch.name)}</div>` : ''}
        <div class="sep"></div>
        <div class="foes">${foes.map((t) => { const T = tankTones(t.color); return `<span class="ft ${t.alive ? '' : 'dead'}">${tankGlyph(T.base, T.line)}</span>`; }).join('')}</div>
        <span class="lives">${lives}</span>`;
    } else if (view.mode === 'versus') {
      const teams = new Map();
      for (const t of tanks) if (!teams.has(t.team)) teams.set(t.team, t);
      const score = new Map(view.score);
      const N = view.rounds || 3;
      const rows = [...teams.entries()].map(([team, t]) => {
        const won = score.get(team) || 0;
        const tc = TEAM_COLORS[t.teamColor] || TANK_COLORS[t.color];
        const name = view.rule === 'team' ? (team === 0 ? '藍隊' : '黃隊') : (t.name || '');
        const mine = me && me.team === team;
        return `<div class="teamrow ${mine ? 'me' : ''}" style="--tc:${tc}"><i class="flagdot"></i><span class="nm">${esc(name)}</span><span class="rp">${Array.from({ length: N }, (_, i) => `<i class="${i < won ? 'on' : ''}"></i>`).join('')}</span></div>`;
      }).join('');
      // 三隊以上（大亂鬥）：兩欄、不寫名字（隊色點就是旗子的顏色；自己那一列的點多一圈深色）
      html = `<div class="ttl"><span>先贏</span><b>${N}</b><span>回合</span></div><div class="sep"></div><div class="teams ${teams.size > 2 ? 'many' : ''}">${rows}</div>`;
    }
    if (html !== this.key) { this.key = html; this.board.innerHTML = html; }
    // 橫幅
    const b = view.banner;
    const bk = b && (view.phase === 'intro' || view.phase === 'outro') ? `${b.title}|${b.sub}|${b.tone || ''}|${b.kicker || ''}|${b.tip || ''}` : '';
    if (bk !== this.bannerKey) {
      this.bannerKey = bk;
      if (bk) this.showBanner(b); else this.hideBanner();
    }
  }

  showBanner(b) {
    const el = this.bannerEl;
    el.className = `banner ${b.tone || ''}`;
    el.querySelector('h2').textContent = b.title;
    const k = el.querySelector('.kicker'); k.textContent = b.kicker || ''; k.hidden = !b.kicker;
    const p = el.querySelector('p'); p.textContent = b.sub || ''; p.hidden = !b.sub;
    const tip = el.querySelector('.tip'); tip.textContent = b.tip || ''; tip.hidden = !b.tip;
    el.hidden = false;
    const M = motion();
    if (M) M.animate(el.querySelector('.plate'), { opacity: [0, 1], transform: ['translateY(18px) scale(0.92)', 'translateY(0) scale(1)'] }, { type: 'spring', stiffness: 380, damping: 24 });
  }

  hideBanner(now) {
    const el = this.bannerEl;
    if (el.hidden) return;
    const M = motion();
    if (now || !M) { el.hidden = true; return; }
    M.animate(el.querySelector('.plate'), { opacity: [1, 0], transform: ['scale(1)', 'scale(0.96)'] }, { duration: 0.22 }).then(() => { if (!this.bannerKey) el.hidden = true; });
  }

  // 圖鑑：第一次遇到的坦克（paint(canvas, type) 畫出那台坦克）
  found(types, paint) {
    if (!types.length) return;
    const el = this.foundEl;
    const show = (i) => {
      if (i >= types.length) { el.hidden = true; return; }
      const k = types[i], T = TYPES[k];
      el.querySelector('b').textContent = T.name;
      el.querySelector('span').textContent = T.traits.join('・');
      el.hidden = false;
      paint(el.querySelector('canvas'), k);
      const M = motion();
      if (M) M.animate(el, { opacity: [0, 1], transform: ['translate(-50%, 16px)', 'translate(-50%, 0)'] }, { type: 'spring', stiffness: 420, damping: 28 });
      clearTimeout(this.foundT);
      this.foundT = setTimeout(() => show(i + 1), 2200);
    };
    show(0);
  }
}
