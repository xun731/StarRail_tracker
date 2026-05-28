# ⭐ 星穹鐵道抽卡紀錄 StarRail Gacha Tracker

追蹤《崩壞：星穹鐵道》各卡池的保底進度、記錄每一次五星出金，並用視覺化圖表分析歪率與平均抽數。

> 大一自主學習專案：練習純前端（HTML/CSS/JS）+ Python Flask 後端 + Firebase 雲端整合的完整流程。

🔗 **線上展示**：<https://star-rail-tracker-mu.vercel.app/>

---

## ✨ 功能特色

- **五個獨立卡池**：角色活動池、光錐活動池、聯動角色池、聯動光錐池、常駐池，各自獨立計算保底進度
- **三種記錄方式**
  - 手動輸入（含角色/光錐名稱模糊搜尋自動補全）
  - **authkey 網址匯入**：透過後端代理拉取 HoYoLAB 最近六個月的抽卡歷史
  - **CSV / Excel 上傳**：欄位自由對應、支援多分頁切換，補登六個月以前的舊紀錄
- **精準「歪」判定**：依抽出時間點比對歷史 UP 對照表（`banner_history.js` + `banner_chars.js`），自動標註是否歪掉
- **「略」紀錄**：補記中間遺失的抽數，計入總抽數但不影響出金/平均/歪率統計
- **匯入自動更新已墊抽數**：匯入後自動偵測最後一金之後墊了幾抽
- **統計分析**：總抽數、出金次數、平均出金/UP 抽數、歪率，搭配彩色橫向進度條（依抽數區間變色）
- **批量編輯模式**：inline 改名稱/抽數、拖曳排序、勾選批量移動 / 刪除
- **資料同步與備份**
  - Firebase Google 登入 + Firestore 雲端同步（跨裝置）
  - 未登入時自動 fallback 至 localStorage
  - JSON 備份匯出/匯入、Excel 匯出
  - 本機與雲端衝突時跳出選擇對話框

---

## 🛠 技術棧

| 層 | 使用技術 |
|----|---------|
| 前端 | 純 HTML / CSS / JavaScript（無框架、無 build step）|
| 後端 | Python 3 + Flask + flask-cors + requests + gunicorn |
| 雲端 | Firebase Authentication（Google）+ Firestore |
| 函式庫（CDN 懶載入）| PapaParse（CSV 解析）、SheetJS / xlsx（Excel 讀寫）|
| 部署 | Vercel（前端靜態站）+ Render（後端 API）|

### 資料來源
| 用途 | 來源 |
|------|------|
| 角色 / 光錐圖片 | [Mar-7th/StarRailRes](https://github.com/Mar-7th/StarRailRes) |
| 卡池日期 | [Honkai: Star Rail 中文 Wiki（fandom）](https://honkai-star-rail.fandom.com/zh/wiki/%E8%B7%83%E8%BF%81) |
| 歷代 UP 角色 | 17173 社群整理 |
| authkey 擷取腳本 | 改編自 [Star Rail Station](https://starrailstation.com)（Apache-2.0）|

---

## 📁 專案結構

```
StarRail_tracker/
├── frontend/                  # 靜態前端（部署到 Vercel）
│   ├── index.html
│   ├── style.css
│   ├── app.js                 # 主要邏輯
│   ├── data.js                # 五星角色 / 光錐資料（名稱、圖片 ID、簽名角色）
│   ├── banner_chars.js        # 各版本各期次的 UP 角色清單
│   ├── banner_history.js      # 卡池日期 + 歪判定（isPullOffBanner）
│   ├── firebase.js            # Firebase 初始化、Auth、Firestore、localStorage 備援
│   ├── get_authkey.ps1        # （可選）PowerShell authkey 擷取腳本
│   └── vercel.json
├── backend/                   # Flask API（部署到 Render）
│   ├── app.py                 # /api/health, /api/validate, /api/import, /api/banners
│   ├── requirements.txt
│   ├── Procfile
│   └── README.md              # 後端專屬說明
├── tools/
│   └── inspect_banners.py     # 列出 fandom 有但 banner_chars.js 未收錄的期次
├── firestore.rules            # Firestore 安全規則（只能讀寫自己的文件）
├── render.yaml                # Render Blueprint
├── netlify.toml               # （備用）Netlify 設定
└── openspec/                  # spec-driven 開發設定
```

---

## 🚀 本機開發

### 前端
純靜態檔，用任意 HTTP server 起即可：
```bash
cd frontend
python -m http.server 3000
# 開 http://localhost:3000
```

### 後端
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate      # macOS/Linux
pip install -r requirements.txt
python app.py
# → http://localhost:5000
```

前端會自動依網域判斷後端位址：本機 → `http://localhost:5000`，線上 → Render 部署位址。

---

## ☁ 部署

### 前端（Vercel）
1. 連接 GitHub repo
2. **Settings → General → Root Directory** 設為 `frontend`
3. 部署完成後，將 `frontend/app.js` 的 `PRODUCTION_BACKEND` 改為你的 Render 後端網址

### 後端（Render）
用根目錄的 `render.yaml`（Blueprint），或手動建立 Web Service：
- Root Directory：`backend`
- Build：`pip install -r requirements.txt`
- Start：`gunicorn -w 2 -b 0.0.0.0:$PORT app:app --timeout 120`
- Health Check：`/api/health`

詳見 [`backend/README.md`](backend/README.md)。

### Firebase（雲端同步，可選）
1. 建立 Firebase 專案，啟用 Authentication → Google 登入
2. **Authentication → Settings → Authorized domains** 加入你的前端網域
3. 建立 Firestore Database，將 `firestore.rules` 貼到規則並發佈
4. 將 `firebaseConfig` 填入 `frontend/firebase.js`

未設定 Firebase 時，資料會存在瀏覽器 localStorage，功能不受影響。

---

## 🔑 如何取得 authkey 網址

星穹鐵道沒有內建「複製抽卡 URL」按鈕，需從遊戲本機快取讀取。前端「匯入紀錄」分頁有完整圖文教學，兩種方式擇一：

- **方法 A**：執行 `frontend/get_authkey.ps1`（自動從快取抽出 URL 並複製到剪貼簿）
- **方法 B**：用 Notepad++ 開啟遊戲快取 `data_2`，搜尋 `getGachaLog` 手動複製

> ⚠ 自動擷取技術上違反 miHoYo 用戶協議；本工具僅讀取本機快取、不注入遊戲、不傳送資料到第三方。使用即接受風險。

---

## 📜 授權

本專案為個人學習用途。`get_authkey.ps1` 改編自 Star Rail Station（Apache License 2.0）。
角色 / 光錐名稱、圖片版權均屬 HoYoverse / miHoYo。
