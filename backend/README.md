# 星鐵抽卡紀錄 — 後端

Flask API 純轉發站。接收前端貼來的抽卡 URL，代為呼叫 HoYoLAB API 抓資料、過濾出五星、計算保底，回傳給前端。

**重要**：本後端**不儲存任何使用者資料**（包含 authkey、抽卡紀錄、認證資訊）。所有資料來自前端、處理完直接回傳、不寫硬碟、不寫資料庫。

## 本機開發

```powershell
# 1. 進入後端目錄
cd backend

# 2. 安裝套件（建議用虛擬環境）
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# 3. 啟動
python app.py
# → http://localhost:5000
```

驗證：
```powershell
Invoke-RestMethod http://localhost:5000/api/health
# 回 @{ok=True; service=starrail-tracker-backend}
```

## API 端點

| 路徑 | 方法 | 用途 |
|------|------|------|
| `/api/health` | GET | 健康檢查（部署平台 healthcheck 用） |
| `/api/validate` | POST | 驗證網址（authkey）是否有效，body: `{ url }` |
| `/api/import` | POST | 抓所有池五星，body: `{ url, pools? }` |

`/api/import` body 範例：
```json
{ "url": "https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getGachaLog?authkey=...&authkey_ver=1&sign_type=2&game_biz=hkrpg_global&region=prod_official_asia&..." }
```

回應：
```json
{
  "records": {
    "character":   [...],
    "light_cone":  [...],
    "standard":    [...],
    "collab_char": [...],
    "collab_lc":   [...]
  },
  "errors": [],
  "meta": { "fetched_at": "...", "total_pulls_per_pool": {} }
}
```

## 部署到 Render（免費方案）

### 路徑 A：用 Blueprint（render.yaml 自動配置）
1. 把整個 repo 推上 GitHub
2. 登入 [render.com](https://render.com) → 右上 **New +** → **Blueprint**
3. 連結你的 GitHub repo
4. Render 會自動讀取 repo 根的 `render.yaml`，按下 **Apply**
5. 等 build 完成（首次約 3–5 分鐘）
6. 部署後會給你一個網址，例如：`https://starrail-tracker-backend.onrender.com`
7. 測試：`Invoke-RestMethod https://你的網址/api/health`

### 路徑 B：手動建立 Web Service
1. Render → **New +** → **Web Service** → 連 GitHub repo
2. 設定：
   - **Root Directory**: `backend`
   - **Runtime**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -w 2 -b 0.0.0.0:$PORT app:app --timeout 120`
   - **Health Check Path**: `/api/health`
3. **Environment Variables**：
   - `FLASK_DEBUG` = `0`
   - `ALLOWED_ORIGINS` = 你的前端網址（多個用逗號分隔），或 `*` 開放全部
4. Create Web Service

### 部署完後要做的事
1. **記下 Render 給的網址**（形如 `https://your-app.onrender.com`）
2. **編輯 `frontend/app.js`** 的這行：
   ```js
   const PRODUCTION_BACKEND = 'https://YOUR-APP.onrender.com';
   ```
   把 `YOUR-APP` 換成實際值
3. **重新部署前端**

### Render 免費方案注意事項
- **15 分鐘無流量會 sleep**：首次喚醒約 30–60 秒（首次匯入會顯示「連線後端中…」較久是正常的）
- 每月 750 hours 額度（單一服務 24 小時 × 30 = 720 小時，足夠）
- 沒持久磁碟（本服務無狀態，不需要）

## 取得 authkey 網址

本工具不自動抓 authkey（會違反 miHoYo TOS）。提供兩種使用者自行操作的方法：

**方法 A**：用內附的 `frontend/get_authkey.ps1`（PowerShell 腳本）
- 讀取本機遊戲快取 `data_2`，從中 regex 抽出 URL 並驗證
- 技術上違反 TOS，但社群多年無大規模封號案例
- 使用即接受風險

**方法 B**：純手動，用 Notepad++ 直接打開 `data_2` 搜 `getGachaLog`
- 完全不執行任何程式碼，最透明

詳細步驟在前端「匯入紀錄」分頁的說明卡片。

## 環境變數

| 變數 | 預設 | 用途 |
|------|------|------|
| `PORT` | 5000 | 監聽埠（Render 會自動注入） |
| `FLASK_DEBUG` | 1 | 0 = 生產模式，1 = 開發模式 |
| `ALLOWED_ORIGINS` | * | CORS 白名單，多個用逗號分隔 |
