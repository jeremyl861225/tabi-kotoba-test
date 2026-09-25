"""產生根目錄的 index.html：掃描每個測試資料夾的 meta.json，依日期新到舊列出。

用法（在 repo 根目錄）：python3 tools/index.py
每個測試放在 <專案>/<YYYY-MM-DD>-<簡短英文名>/，裡面要有 index.html 與 meta.json：
  {"project": "專案名稱", "date": "YYYY-MM-DD", "title": "測試標題", "summary": "一句說明", "status": "可空，例如「已定案：第 6 種」"}
"""
import glob, html, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    items = []
    for p in glob.glob(os.path.join(ROOT, "*", "*", "meta.json")):
        folder = os.path.relpath(os.path.dirname(p), ROOT)
        m = json.load(open(p, encoding="utf-8"))
        m["href"] = folder.replace(os.sep, "/") + "/"
        items.append(m)
    items.sort(key=lambda m: (m.get("date", ""), m.get("title", "")), reverse=True)
    rows = []
    for m in items:
        e = lambda k: html.escape(m.get(k, ""))
        status = f'<span class="st">{e("status")}</span>' if m.get("status") else ""
        rows.append(f'''  <a class="item" href="{html.escape(m["href"])}">
    <span class="meta">{e("date")}　{e("project")}</span>
    <b>{e("title")}</b>
    <span class="sum">{e("summary")}</span>{status}
  </a>''')
    page = f'''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>測試結果展示</title>
<meta name="theme-color" content="#f7f5f0">
<style>
  body {{ margin: 0; background: #f7f5f0; color: #1c1814; font-family: "Songti TC", "Noto Serif TC", serif; -webkit-text-size-adjust: 100%; }}
  header, main {{ max-width: 560px; margin: 0 auto; padding: 0 16px; }}
  header {{ padding-top: calc(env(safe-area-inset-top, 0px) + 24px); }}
  h1 {{ margin: 0 0 6px; font-size: 26px; }}
  header p {{ margin: 0 0 18px; color: #5d5345; font-size: 15px; line-height: 1.6; }}
  .item {{ display: grid; gap: 4px; margin: 0 0 12px; padding: 16px; border-radius: 16px; background: #fff;
    box-shadow: 0 0 0 1px rgba(60,45,25,.10); color: inherit; text-decoration: none; }}
  .item:active {{ background: #efece6; }}
  .meta {{ font: 13px/1.4 -apple-system, "PingFang TC", sans-serif; color: #786b59; }}
  .item b {{ font-size: 19px; }}
  .sum {{ font-size: 15px; color: #5d5345; line-height: 1.6; }}
  .st {{ justify-self: start; margin-top: 4px; padding: 4px 9px; border-radius: 999px; background: #eef5f0; color: #1f5a3a;
    font: 600 12.5px/1.3 -apple-system, "PingFang TC", sans-serif; }}
  .empty {{ color: #786b59; }}
</style>
</head>
<body>
<header>
  <h1>測試結果展示</h1>
  <p>各專案要給你看、讓你挑的測試頁都放這裡，新的在上面。</p>
</header>
<main>
{chr(10).join(rows) if rows else '  <p class="empty">目前沒有測試。</p>'}
</main>
</body>
</html>
'''
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(page)
    print(f"index.html：{len(items)} 個測試")


if __name__ == "__main__":
    main()
