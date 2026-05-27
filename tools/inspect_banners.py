"""
比對後端 /api/banners 抓到的 (版本+期次)，列出 frontend/banner_chars.js 還沒收的，
方便新版本上線時補表。

用法：
  1. 確認後端有跑（python backend/app.py）— 或加 --remote 指向 Render
  2. 在專案根執行：python tools/inspect_banners.py
  3. 把印出的 (版本 期次) 加進 banner_chars.js 的 BANNER_CHARS

範例：
  python tools/inspect_banners.py
  python tools/inspect_banners.py --remote https://starrail-tracker-backend.onrender.com

注意：若 localhost:5000 拒絕連線，是後端沒跑起來。先去 backend/ 跑 python app.py。
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request


def fetch_banners(backend_url: str):
    url = backend_url.rstrip('/') + '/api/banners'
    print(f'抓 {url} ...')
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.URLError as e:
        raise SystemExit(
            f'❌ 連不到後端：{e}\n'
            f'   若用本機，先跑 `cd backend && python app.py`\n'
            f'   若用部署版，加 --remote https://<your-app>.onrender.com'
        )


def load_mapped_keys(chars_js_path: str):
    """從 banner_chars.js 抓出 BANNER_CHARS 已對應的 (版本 期次) 字串。"""
    with open(chars_js_path, 'r', encoding='utf-8') as f:
        text = f.read()
    # 抓所有 '版本 期次': [...] 形式
    return set(re.findall(r"'(\d+\.\d+\s+第[一二三四五六七八九十]+期)'\s*:", text))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        '--remote', default='http://localhost:5000',
        help='後端網址，預設 http://localhost:5000'
    )
    ap.add_argument(
        '--chars', default='frontend/banner_chars.js',
        help='banner_chars.js 路徑（從專案根算）'
    )
    args = ap.parse_args()

    data = fetch_banners(args.remote)

    if 'error' in data:
        print(f'❌ 後端錯誤：{data["error"]}', file=sys.stderr)
        sys.exit(1)

    banners = data.get('banners', [])
    versions = sorted(set(b['version'] for b in banners), key=lambda v: tuple(int(x) for x in v.split('.')))
    print(f'✅ 後端抓到 {len(banners)} 期 banner（版本 {versions[0]} ～ {versions[-1]}）')

    try:
        mapped = load_mapped_keys(args.chars)
    except FileNotFoundError:
        print(f'❌ 找不到 {args.chars}', file=sys.stderr)
        sys.exit(1)

    print(f'✅ banner_chars.js 已收 {len(mapped)} 期')

    fandom_keys = set(f"{b['version']} {b['phase']}" for b in banners)
    unmapped = sorted(fandom_keys - mapped,
                      key=lambda s: (tuple(int(x) for x in s.split()[0].split('.')), s))

    print()
    print('═══════════════════════════════════════════════════════════════════')
    print(f'  fandom 有、banner_chars.js 還沒收（共 {len(unmapped)} 期）')
    print('═══════════════════════════════════════════════════════════════════')

    if not unmapped:
        print('  🎉 全部都有對應，無需補表')
        return

    print()
    for key in unmapped:
        # 從 banners 找該 key 對應的日期資訊以供參考
        match = next((b for b in banners if f"{b['version']} {b['phase']}" == key), None)
        date_str = f"{match['start'][:10]} ~ {match['end'][:10]}" if match else ''
        deco_str = ', '.join(match.get('items', [])) if match else ''
        print(f"  '{key}': [''], // {date_str}  裝飾名: {deco_str}")

    print()
    print('複製上面的行到 banner_chars.js 的 BANNER_CHARS，填上實際角色名（陣列）。')
    print('角色名請用 data.js 中的繁體名稱（如「希兒」「銀狼」「丹恆·飲月」）。')


if __name__ == '__main__':
    main()
