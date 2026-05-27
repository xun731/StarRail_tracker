"""
星穹鐵道抽卡紀錄 — Flask 後端
用途：接收前端的 authkey，代為呼叫 HoYoLAB API 取得抽卡歷史，
      過濾出五星並計算保底，回傳給前端。

執行：
  pip install -r requirements.txt
  python app.py
  → 後端啟動於 http://localhost:5000
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import re
import requests
import time
from urllib.parse import urlparse, parse_qs

app = Flask(__name__)

# CORS：開發允許全部、生產環境可以用環境變數 ALLOWED_ORIGINS 限定來源
# 多個 origins 用逗號分隔，例如：
#   ALLOWED_ORIGINS=https://your-app.netlify.app,https://your-app.pages.dev
_allowed = os.environ.get('ALLOWED_ORIGINS', '*')
if _allowed == '*':
    CORS(app)
else:
    CORS(app, origins=[o.strip() for o in _allowed.split(',') if o.strip()])

# ─── 常數 ─────────────────────────────────────────────────────────────────────
# HoYoLAB / MiHoYo 抽卡紀錄 API 端點
# 注意：路徑前綴是 hkrpg_gacha_record（不是 gacha_record，那是舊版/原神）

# 一般池（角色 / 光錐 / 常駐）
HSR_API_OS = 'https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getGachaLog'
HSR_API_CN = 'https://public-operation-hkrpg.mihoyo.com/common/hkrpg_gacha_record/api/getGachaLog'

# 聯動池（getLdGachaLog，Ld = Limited 聯動）
HSR_API_OS_LD = 'https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getLdGachaLog'
HSR_API_CN_LD = 'https://public-operation-hkrpg.mihoyo.com/common/hkrpg_gacha_record/api/getLdGachaLog'

# 聯動池 pool 名稱（用於切換 endpoint）
COLLAB_POOLS = {'collab_char', 'collab_lc'}

# 卡池類型對應（前端名稱 ↔ HoYoLAB 數字）
GACHA_TYPES = {
    'character':   '11',   # 角色活動躍遷
    'light_cone':  '12',   # 光錐活動躍遷
    'standard':    '1',    # 常駐躍遷
    # ⚠ HSR 聯動 gacha_type 官方無公開文件，下方為社群推測值。
    # 若 retcode != 0 抓不到，可改試替代候選：5, 6, 21, 22, 41, 42
    # fetch_pool 會把錯誤收進 errors 陣列，不影響其他池的抓取流程。
    'collab_char': '21',   # 聯動角色躍遷（推測，待驗證）
    'collab_lc':   '22',   # 聯動光錐躍遷（推測，待驗證）
}

# 每頁最大筆數（HoYoLAB 上限為 20）
PAGE_SIZE = 20
# 分頁間休息時間，避免被 ban
SLEEP_BETWEEN_REQUESTS = 0.6
# 最大頁數（安全閥）
MAX_PAGES = 200


# ─── 工具函式 ────────────────────────────────────────────────────────────────

# 從原始 URL 保留下來的關鍵參數（不同伺服器 / 帳號的 authkey 簽章可能依賴這些值）
PRESERVED_PARAMS = {
    'authkey', 'authkey_ver', 'sign_type', 'game_biz',
    'lang', 'region', 'auth_appid', 'plat_type',
}


def parse_url_to_base(url: str):
    """
    把使用者貼的完整網址拆解為 (base_endpoint, params_dict)。

    base_endpoint 是 scheme + host + path（不含 query）；
    params_dict 只保留 PRESERVED_PARAMS 內的鍵，過濾掉 gacha_id / timestamp /
    device_model 等與本次請求無關的雜訊。
    """
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    qs = parse_qs(parsed.query)
    params = {k: v[0] for k, v in qs.items() if k in PRESERVED_PARAMS and v}
    return base, params


def adjust_endpoint_for_pool(base_endpoint: str, pool_name: str) -> str:
    """
    依 pool 名稱切換 endpoint：
      - 聯動池 → 確保路徑是 getLdGachaLog
      - 其他池 → 確保路徑是 getGachaLog
    """
    is_collab = pool_name in COLLAB_POOLS
    if is_collab:
        if 'getLdGachaLog' in base_endpoint:
            return base_endpoint
        return base_endpoint.replace('getGachaLog', 'getLdGachaLog')
    if 'getGachaLog' in base_endpoint and 'getLdGachaLog' not in base_endpoint:
        return base_endpoint
    return base_endpoint.replace('getLdGachaLog', 'getGachaLog')


def fetch_pool(url: str, gacha_type: str, pool_name: str = '') -> list:
    """
    抓取單一卡池的所有抽卡紀錄（分頁直到沒有為止）。

    輸入是使用者貼的完整網址（含 authkey 與其他必要簽章參數），
    本函式會：
      1. 保留 URL 中的 authkey / authkey_ver / sign_type / game_biz /
         region / auth_appid / plat_type / lang 等簽章相關參數
      2. 依 pool_name 切到 getGachaLog 或 getLdGachaLog
      3. 覆寫 gacha_type / page / size / end_id 以分頁

    回傳：list of raw items，新→舊排序（HoYoLAB 預設）
    """
    base_endpoint, base_params = parse_url_to_base(url)
    endpoint = adjust_endpoint_for_pool(base_endpoint, pool_name)

    all_records = []
    end_id = '0'
    page = 1

    while page <= MAX_PAGES:
        params = dict(base_params)
        params['gacha_type'] = gacha_type
        params['page']       = str(page)
        params['size']       = str(PAGE_SIZE)
        params['end_id']     = end_id
        # 確保 lang 至少有值（部分舊版 URL 不含 lang 會回 retcode!=0）
        params.setdefault('lang', 'zh-tw')

        resp = requests.get(endpoint, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        if data.get('retcode') != 0:
            raise RuntimeError(
                f"HoYoLAB API 錯誤 [{data.get('retcode')}]：{data.get('message')}"
            )

        items = data.get('data', {}).get('list', [])
        if not items:
            break

        all_records.extend(items)
        end_id = items[-1]['id']
        page += 1
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return all_records


def extract_five_stars(raw_records: list, gacha_type: str) -> list:
    """
    把 HoYoLAB 原始抽卡資料 → 我們前端用的五星紀錄格式。

    raw_records 是新→舊排序；
    為了計算保底（從上一個五星之後算起），需要先反轉成舊→新，
    累計保底計數，到五星時記錄並歸零，最後再反轉回新→舊。

    回傳格式（每筆）：
    {
      gachaId:   str,    # HoYoLAB 唯一 id（用於去重）
      name:      str,
      itemType:  str,    # '角色' 或 '光錐'
      pullCount: int,    # 本保底耗多少抽
      timestamp: str,    # 'YYYY-MM-DD HH:MM:SS'
      isOff:     bool,   # 暫定：常駐池角色 → True；其他 → False（使用者可再改）
      source:    'import',
    }
    """
    # 反轉成舊→新
    chronological = list(reversed(raw_records))

    # 常駐池五星角色名單（用於判斷是否「歪了」）
    # 這份名單與 frontend/data.js 的 standard 角色保持一致
    STANDARD_FIVE_STARS = {
        '克拉拉', '傑帕德', '布洛妮婭', '瓦爾特', '姬子', '白露', '彥卿'
    }

    five_stars = []
    pity_count = 0

    for item in chronological:
        pity_count += 1
        if item.get('rank_type') == '5':
            name = item.get('name', '')
            item_type = item.get('item_type', '')
            # 自動判斷是否「歪」：
            #   - 常駐池：沒有歪的概念，固定 False
            #   - 限定池：若五星是常駐角色 → 歪了；否則 → 暫設 False，由使用者校正
            if gacha_type == '1':  # 常駐
                is_off = False
            else:
                is_off = (item_type == '角色' and name in STANDARD_FIVE_STARS)

            five_stars.append({
                'gachaId':   item['id'],
                'name':      name,
                'itemType':  item_type,
                'pullCount': pity_count,
                'timestamp': item.get('time', ''),
                'isOff':     is_off,
                'source':    'import',
            })
            pity_count = 0

    # 反轉回「新→舊」，對應前端 #1 = 最新的慣例
    return list(reversed(five_stars))


# ─── API 端點 ────────────────────────────────────────────────────────────────

@app.route('/api/health')
def health():
    """簡單健康檢查"""
    return jsonify({'ok': True, 'service': 'starrail-tracker-backend'})


# ─── Banner 歷史代理（fandom wiki）───────────────────────────────────────────

FANDOM_API = 'https://honkai-star-rail.fandom.com/zh/api.php'
FANDOM_PAGE = '躍遷'
BANNERS_CACHE_TTL = 12 * 60 * 60   # 12 小時
_banners_cache = {'data': None, 'fetched_at': 0}


def _parse_yymmdd(yymmdd: str) -> str:
    """'23.04.26' → '2023-04-26 00:00:00'。失敗回空字串。"""
    m = re.match(r'^(\d{2})\.(\d{2})\.(\d{2})$', yymmdd.strip())
    if not m:
        return ''
    yy, mm, dd = m.groups()
    return f'20{yy}-{mm}-{dd} 00:00:00'


def _parse_banner_wikitext(wikitext: str):
    """
    從 wiki 原始碼解析 banner 列表。

    結構（觀察自 fandom 躍遷頁）：
      {| class="article-table sortable"
      |+ 1.0版本
      |-
      |第一期<br>23.04.26<br>23.05.17||
      [[File:蝶立鋒矚 2023-04-26.png|175px|link=蝶立鋒矚/2023-04-26]]
      [[File:流昴定影 2023-04-26.png|175px|link=流昴定影/2023-04-26]]
      |-
      ...
      |}

    每張表代表一個版本；表內每個 row 是一期；row 內可能含 2 個或更多 File 連結
    （第一個為角色 banner、第二個為光錐 banner；聯動時可能有 4 個）。

    回傳：[
      {
        'version': '1.0',
        'phase':   '第一期',
        'start':   '2023-04-26 00:00:00',
        'end':     '2023-05-17 00:00:00',
        'items':   ['蝶立鋒矚', '流昴定影'],  # 裝飾名（按出現順序）
      }, ...
    ]
    """
    results = []
    current_version = None

    # 用 |+ XX版本 把 wikitext 切成「每個版本一段」
    blocks = re.split(r'\|\+\s*([\d.]+)版本', wikitext)
    # split 結果是 [前置, 版本1, 內容1, 版本2, 內容2, ...]
    for i in range(1, len(blocks), 2):
        version = blocks[i].strip()
        body = blocks[i + 1] if i + 1 < len(blocks) else ''

        # 每個 row 以 |- 分隔；row 內以 |XX期<br>YY.MM.DD<br>YY.MM.DD|| 開頭
        rows = re.split(r'\|-+', body)
        for row in rows:
            # 期次 + 兩個日期
            m = re.search(
                r'(第[一二三四五六七八九十]+期)\s*<br>\s*([\d.]+)\s*<br>\s*([\d.]+)',
                row
            )
            if not m:
                continue
            phase, start_raw, end_raw = m.groups()
            start = _parse_yymmdd(start_raw)
            end = _parse_yymmdd(end_raw)
            if not start:
                continue

            # 抽出所有 File 連結中的「裝飾名」（File: 與 ' YYYY' 或 '.png' 之間那段）
            files = re.findall(r'\[\[File:\s*([^\|\]]+?)\s+\d{4}-\d{2}-\d{2}\.png', row)
            items = [f.strip() for f in files if f.strip()]
            if not items:
                continue

            results.append({
                'version': version,
                'phase':   phase,
                'start':   start,
                'end':     end,
                'items':   items,
            })

    return results


def _fetch_banner_history():
    """從 fandom 抓 + 快取。失敗會 raise。"""
    now = time.time()
    if _banners_cache['data'] is not None and (now - _banners_cache['fetched_at']) < BANNERS_CACHE_TTL:
        return _banners_cache['data']

    resp = requests.get(
        FANDOM_API,
        params={
            'action': 'parse',
            'page':   FANDOM_PAGE,
            'format': 'json',
            'prop':   'wikitext',
        },
        headers={
            # 用真實瀏覽器 UA 避免被 fandom 擋
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    wikitext = data.get('parse', {}).get('wikitext', {}).get('*', '')
    if not wikitext:
        raise RuntimeError('fandom 回應沒有 wikitext')

    banners = _parse_banner_wikitext(wikitext)
    _banners_cache['data'] = banners
    _banners_cache['fetched_at'] = now
    return banners


@app.route('/api/banners')
def get_banners():
    """
    回傳 fandom wiki 上抓到的 banner 歷史。

    Response: {
      banners: [ { version, phase, start, end, items: [decorative_name, ...] } ],
      meta:    { source, fetched_at, count },
      note:    string  # 提醒前端：items 是裝飾名，需要本地對照表轉成角色名
    }

    Query: ?force=1  強制忽略快取重抓
    """
    if request.args.get('force') == '1':
        _banners_cache['data'] = None
    try:
        banners = _fetch_banner_history()
        return jsonify({
            'banners': banners,
            'meta': {
                'source': f'{FANDOM_API}?page={FANDOM_PAGE}',
                'fetched_at': time.strftime(
                    '%Y-%m-%d %H:%M:%S', time.localtime(_banners_cache['fetched_at'])
                ),
                'count': len(banners),
            },
            'note': 'items 為 banner 裝飾名（如「蝶立鋒矚」），請前端用 banner_name_map.js 對照成實際角色 / 光錐名',
        })
    except Exception as e:
        return jsonify({'error': f'抓取或解析失敗：{e}'}), 502


@app.route('/api/validate', methods=['POST'])
def validate_authkey():
    """
    驗證 URL 是否有效（只抓 1 筆測試）
    Body: { url: str }   或舊版相容 { authkey: str }
    """
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or body.get('authkey') or '').strip()

    if not url or 'authkey=' not in url:
        return jsonify({'ok': False, 'error': '缺少有效的抽卡網址（須含 authkey）'}), 400

    try:
        base_endpoint, base_params = parse_url_to_base(url)
        # 常駐池為驗證目標（gacha_type=1 一定存在）
        endpoint = adjust_endpoint_for_pool(base_endpoint, pool_name='')
        params = dict(base_params)
        params.update({'gacha_type': '1', 'page': '1', 'size': '1', 'end_id': '0'})
        params.setdefault('lang', 'zh-tw')

        resp = requests.get(endpoint, params=params, timeout=10)
        data = resp.json()
        if data.get('retcode') == 0:
            return jsonify({'ok': True, 'region': data.get('data', {}).get('region')})
        return jsonify({
            'ok': False,
            'error': f"[{data.get('retcode')}] {data.get('message')}"
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/import', methods=['POST'])
def import_records():
    """
    主要匯入端點：抓所有池歷史 → 過濾五星 → 計算保底

    Body: {
      url: str (使用者直接貼的完整抽卡網址，必須包含 authkey 等簽章參數),
      pools?:  ['character', 'light_cone', 'standard',
                'collab_char', 'collab_lc']  (預設全部),
    }

    向後相容：若 body 用 `authkey` 鍵裝完整 URL 也接受。

    Response: {
      records: {
        character:    [...五星紀錄],
        light_cone:   [...五星紀錄],
        standard:     [...五星紀錄],
        collab_char:  [...五星紀錄],   # 走 getLdGachaLog endpoint
        collab_lc:    [...五星紀錄],   # 同上
      },
      errors: [{ pool, error }],
      meta: { fetched_at, total_pulls_per_pool }
    }
    """
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or body.get('authkey') or '').strip()
    pools = body.get('pools') or list(GACHA_TYPES.keys())

    if not url or 'authkey=' not in url:
        return jsonify({'error': '缺少有效的抽卡網址（必須是完整 URL，含 authkey 與其他簽章參數）'}), 400

    results = {}
    errors  = []
    meta    = {'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S'),
               'total_pulls_per_pool': {}}

    for pool_name in pools:
        if pool_name not in GACHA_TYPES:
            errors.append({'pool': pool_name, 'error': '未知的卡池'})
            continue
        gacha_type = GACHA_TYPES[pool_name]
        try:
            raw = fetch_pool(url, gacha_type, pool_name)
            five_stars = extract_five_stars(raw, gacha_type)
            results[pool_name] = five_stars
            meta['total_pulls_per_pool'][pool_name] = len(raw)
        except Exception as e:
            results[pool_name] = []
            errors.append({'pool': pool_name, 'error': str(e)})

    return jsonify({
        'records': results,
        'errors':  errors,
        'meta':    meta,
    })


# ─── 啟動 ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Local 開發：debug=True 會自動重啟。Render 上不會走到這裡（用 gunicorn）。
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug)
