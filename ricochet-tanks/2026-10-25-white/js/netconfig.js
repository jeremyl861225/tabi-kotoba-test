// 連線設定。Supabase 的 anon key 是「公開金鑰」，設計上就會出現在前端；
// 跳彈坦克只用 Realtime Broadcast 交換 WebRTC 的連線資訊（房號配對），遊戲資料走點對點，不碰任何資料表。
// 與白巷、todo-app 共用同一個 Supabase 專案（免費方案每人只有 2 個專案）；頻道名稱前綴 rt- 跟白巷的 wa- 分開。
export const SUPABASE = {
  url: 'https://dawcpdgonxmhojwonkut.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhd2NwZGdvbnhtaG9qd29ua3V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NzYwMDUsImV4cCI6MjEwMTE1MjAwNX0.eTxxyJQK3WrMXVm134BUX1yx4REm8rvXmzG-UJhTR0I',
};
export const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
