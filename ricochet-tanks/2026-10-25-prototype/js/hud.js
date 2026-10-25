// HUD：上方的狀態膠囊（關卡、敵人、命數／回合、比分、彈種）與中央的標題橫幅。
import { BULLETS } from './config.js';
import { TANK_COLORS } from './render.js';

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
        `<span><i class="tankdot" style="background:${view.rule === 'team' ? (team === 0 ? TANK_COLORS.p1 : TANK_COLORS.p2) : TANK_COLORS[t.color]}"></i><b>${score.get(team) || 0}</b></span>`).join('')}</span>`;
    }
    if (html !== this.key) { this.key = html; this.status.innerHTML = html; }
    let a = '';
    if (me) {
      const B = BULLETS[me.bullet];
      a = `<i class="tankdot" style="background:${TANK_COLORS[me.color]}"></i>${B.name}${extra.ammo ? `<span class="dim num">${extra.ammo}</span>` : ''}`;
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
