# 測試結果展示（tabi-kotoba-test）

所有專案要給使用者看、讓他挑的測試頁都放這個 repo（2026-09-25 使用者指定）。
網址：<https://jeremyl861225.github.io/tabi-kotoba-test/>（他通常用手機看）。
名字沿用第一次的用途（旅ことば配色試看），實際上是所有專案共用的展示站。

## 放法

1. 開工前 `git pull --rebase`（可能有別的 session 同時在放東西）。
2. 一個測試一個資料夾：`<專案>/<YYYY-MM-DD>-<簡短英文名>/`，裡面要有：
   - `index.html`：給使用者看的頁面（手機優先；上方放「← 所有測試」連回 `../../`）。
   - `meta.json`：`{"project","date","title","summary","status"}`，`status` 可空（選定後寫「已定案：…」）。
3. 在根目錄跑 `python3 tools/index.py` 重產首頁清單。
4. 只 `git add` 自己的資料夾與 `index.html`，commit、push。Pages 約 1 分鐘建好；
   先用 `curl -s <網址> | grep <新字>` 確認上線再給使用者網址。

## 規則

- **這是 public repo**：不可放病人資料、院內資料、個資、未公開的指引內容、授權不明的圖片。
- 同一個 `jeremyl861225.github.io` 網域上還有很多正式 App：
  - 放正式 App 的複本時，**localStorage／sessionStorage 的鍵名要改掉**（加 `-test`），**不要註冊 service worker**，
    否則會讀寫到正式版的學習紀錄、清到正式版的離線快取。
  - 測試頁不要做成正式 App 範圍內的網址（正式版的 service worker 會把範圍內任何網址都回成 App）。
- 不要刪別的 session 的測試資料夾；舊測試要清理先問使用者。
- 刪整個 repo 需要 `delete_repo` 權限，目前的 gh 登入沒有。
