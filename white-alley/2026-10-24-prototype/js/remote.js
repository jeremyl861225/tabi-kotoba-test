// 房主這邊每個連線客人的輸入佇列。輸入走不重送、不排序的通道，所以：
//   ・依序號排：比已收過的舊的直接丟（亂序到達的取消不會被當成比較新的瞄準）
//   ・取消是持續狀態：客人每包都帶「目前這次按壓的編號 pr」與「最後被取消的按壓 cx」，
//     cx === pr 就代表這次按壓已取消——取消那一包掉了，後面每一包還是會說「已取消」，不會變成誤丟
//   ・放手時的蓄力 ch 也每包都帶，直到下一次按壓
//   ・客人斷流（背景、卡住）：0.25 秒沒新輸入就停下腳步；瞄準維持原狀（只是舉著石頭，沒有放手就不會丟）。
//     不取消瞄準：網路或掉幀卡一下很常見，取消會把正在蓄力的那一投吃掉；真的斷線時連線會被回收
export const STALE_TICKS = 15;

export class RemoteInput {
  constructor() {
    this.q = [];
    this.maxSeq = 0;     // 收過最大的序號
    this.last = null;
    this.idle = 0;
    this.ack = 0;        // 已經餵進模擬的最後一個序號（快照回報給客人做修正）
  }

  push(m) {
    if (!(m.s > this.maxSeq)) return false;
    this.maxSeq = m.s;
    this.q.push(m);
    // 堆太多就丟舊的，別讓延遲越積越大——但只丟「跟下一包同一個按壓狀態」的移動包，
    // 按下／放開／取消的轉換點一定留著（不然整次按壓都可能被丟掉，房主根本沒看到）
    while (this.q.length > 6) {
      const q = this.q;
      let i = 0;
      while (i < q.length - 1 && !(q[i].aim === q[i + 1].aim && q[i].pr === q[i + 1].pr && q[i].cx === q[i + 1].cx)) i++;
      q.splice(i < q.length - 1 ? i : 0, 1);
    }
    return true;
  }

  // 每個模擬 tick 取一次；還沒收過任何輸入回傳 null
  next() {
    const x = this.q.shift();
    if (x) { this.last = x; this.ack = x.s; this.idle = 0; } else this.idle++;
    const m = this.last;
    if (!m) return null;
    const cancelled = m.cx != null && m.cx === m.pr;
    const still = this.idle > STALE_TICKS;
    return { mx: still ? 0 : m.mx, mz: still ? 0 : m.mz, yaw: m.yaw, pitch: m.pitch, aim: !!m.aim && !cancelled, cancel: cancelled, ch: m.ch };
  }
}
