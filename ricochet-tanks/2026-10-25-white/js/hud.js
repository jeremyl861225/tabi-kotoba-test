// HUD：上方的狀態膠囊（關卡、敵人、命數／回合、比分、彈種）與中央的標題橫幅。
import { BULLETS } from './config.js';
import { TANK_COLORS, TEAM_COLORS } from './render.js';

// 彈種小圖（v9：原本是一塊藍方塊，五種彈長得一樣）：淺色圓底上畫遊戲裡的深色炮彈，外圈是隊色
const SHELL = (x, y, a, w = 9, h = 5) => `<g transform="rotate(${a} ${x} ${y})"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="#4A4458"/><path d="M${x + w / 2 - h / 2} ${y - h / 2}a${h / 2} ${h / 2} 0 0 1 0 ${h}z" fill="#fff"/></g>`;
const BULLET_SVG = {
  standard: SHELL(12, 12, -40, 14, 7),
  rocket: `<path d="M7 16.6l-4.4 3 1.6-5z" fill="#F0723C"/>${SHELL(13, 11, -40, 14, 6.4)}`,
  ricochet: `<path d="M3.5 18.5l4-6 3 5" fill="none" stroke="#8C84A0" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1.6 1.8"/>${SHELL(15, 9.5, -40, 11, 6)}`,
  scatter: `${SHELL(7.5, 15.5, -60, 8, 4.4)}${SHELL(12, 10.5, -40, 8, 4.4)}${SHELL(16.5, 15.5, -20, 8, 4.4)}`,
  blast: `<circle cx="11" cy="13" r="5.6" fill="#4A4458"/><circle cx="9.4" cy="11.4" r="1.6" fill="#fff" opacity="0.5"/><path d="M15 9l2.2-2.2" stroke="#4A4458" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="6" r="1.7" fill="#F0723C"/>`,
};
const bicon = (t) => `<i class="bicon" style="${t.teamColor ? `box-shadow:0 0 0 2px ${TEAM_COLORS[t.teamColor]}` : ''}"><svg viewBox="0 0 24 24">${BULLET_SVG[t.bullet] || BULLET_SVG.standard}</svg></i>`;


const heart = '<svg class="i fill" viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.7 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>';
const motion = () => window.Motion;

export class Hud {
  constructor(root, { onPause }) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top" hidden>
        <div class="hud-col left">
          <button class="hud-btn glass press" aria-label="暫停"><svg class="i"><use href="#i-pause"/></svg></button>
          <div class="chip glass status"></div>
        </div>
        <div class="hud-col right"><div class="chip glass ammo-chip"></div></div>
      </div>
      <div class="banner" hidden><div class="plate glass"><h2></h2><p></p></div></div>`;
    this.top = root.querySelector('.hud-top');
    this.status = root.querySelector('.status');
    this.ammoChip = root.querySelector('.ammo-chip');
    this.bannerEl = root.querySelector('.banner');
    root.querySelector('.hud-btn').addEventListener('click', () => onPause());
    this.key = '';
    this.bannerKey = '';
  }

  show(on) { this.top.hidden = !on; if (!on) this.hideBanner(true); }

  // 單人：狀態卡在左側暗區（直排）；雙人：場地上方置中（左右兩側被兩個人的搖桿佔了）
  setLayout(kind) { this.root.classList.toggle('duo', kind === 'duo'); }

  // view：game.view() 或客人收到的摘要；me：自己的坦克（可能是 null）；tanks：全部坦克
  update(view, me, tanks, extra = {}) {
    if (!view) return;
    let html = '';
    if (view.mode === 'campaign') {
      const foes = tanks.filter((t) => t.team === 1);
      const lives = Array.from({ length: Math.max(view.lives, 0) }, () => heart).join('');
      html = `<span class="line"><span class="dim">第</span><b>${view.level + 1}</b><span class="dim">關</span></span>
        <span class="foes">${foes.map((t) => `<i class="${t.alive ? '' : 'dead'}" style="--c:${TANK_COLORS[t.color]}"></i>`).join('')}</span>
        <span class="lives">${lives}</span>`;
    } else if (view.mode === 'versus') {
      const teams = new Map();
      for (const t of tanks) if (!teams.has(t.team)) teams.set(t.team, t);
      const score = new Map(view.score);
      html = `<span class="line"><span class="dim">先贏</span><b>${view.rounds}</b></span><span class="scoreline">${[...teams.entries()].map(([team, t]) =>
        `<span style="--tc:${TEAM_COLORS[t.teamColor] || TANK_COLORS[t.color]}"><i class="teamdot"></i><b>${score.get(team) || 0}</b></span>`).join('')}</span>`;
    }
    if (html !== this.key) { this.key = html; this.status.innerHTML = html; }
    let a = '';
    if (me) {
      const B = BULLETS[me.bullet];
      a = `${bicon(me)}${B.name}${extra.ammo ? `<span class="dim num">${extra.ammo}</span>` : ''}`;
    }
    if (a !== this.akey) { this.akey = a; this.ammoChip.innerHTML = a; this.ammoChip.hidden = !a; }
    // 橫幅
    const b = view.banner;
    const bk = b && (view.phase === 'intro' || view.phase === 'outro') ? `${b.title}|${b.sub}|${b.tone || ''}` : '';
    if (bk !== this.bannerKey) {
      this.bannerKey = bk;
      if (bk) this.showBanner(b); else this.hideBanner();
    }
  }

  showBanner(b) {
    const el = this.bannerEl;
    el.className = `banner ${b.tone || ''}`;
    el.querySelector('h2').textContent = b.title;
    const p = el.querySelector('p');
    p.textContent = b.sub || ''; p.hidden = !b.sub;
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
}
