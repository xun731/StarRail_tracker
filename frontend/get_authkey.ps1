# ════════════════════════════════════════════════════════════════════════════
#  星穹鐵道 authkey 擷取工具
# ════════════════════════════════════════════════════════════════════════════
#
#  ⚠ 風險聲明：本腳本只讀本機快取檔，不寫不注入不傳資料到外部。
#    技術上違反 miHoYo TOS，但多年無大規模封號案例。使用即接受風險。
#    替代方案：用 Notepad++ 直接打開 data_2 搜 "getGachaLog"。
#
#  用法：
#    1. 啟動星穹鐵道，遊戲內進入 躍遷 → 紀錄 頁面
#    2. PowerShell 執行：
#       powershell -ExecutionPolicy Bypass -File .\get_authkey.ps1
#    3. URL 自動進剪貼簿，貼到網頁「匯入紀錄」分頁
#
#  Based on: Star Rail Station's get_warp_link_os.ps1 (Apache License 2.0)
#  https://github.com/Star-Rail-Station
# ════════════════════════════════════════════════════════════════════════════

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web
$ProgressPreference = 'SilentlyContinue'

Write-Host ""
Write-Host "=== 星穹鐵道 authkey 擷取工具 ===" -ForegroundColor Yellow
Write-Host ""

# ── 1. 找 Player.log（前 11 行內含安裝路徑）──────────────────────────────
Write-Host "[1/4] 搜尋 Player.log..." -ForegroundColor Cyan

$appData = [Environment]::GetFolderPath('ApplicationData')
$locallow = "$appData\..\LocalLow\Cognosphere\Star Rail"
$logPath = "$locallow\Player.log"

if (-not (Test-Path $logPath)) {
    Write-Host "  X 找不到 Player.log，請先啟動過星穹鐵道海外版。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    return
}

$logLines = Get-Content $logPath -TotalCount 11 -ErrorAction SilentlyContinue
if (-not $logLines) {
    $logPath = "$locallow\Player-prev.log"
    if (Test-Path $logPath) {
        $logLines = Get-Content $logPath -TotalCount 11 -ErrorAction SilentlyContinue
    }
}

if (-not $logLines) {
    Write-Host "  X 讀取 Player.log 失敗。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    return
}

Write-Host "  OK Player.log: $logPath" -ForegroundColor Green

# ── 2. 從 log 解析遊戲安裝路徑 ───────────────────────────────────────────
Write-Host "[2/4] 解析遊戲安裝路徑..." -ForegroundColor Cyan

$gamePath = $null
foreach ($line in $logLines) {
    if ($line.StartsWith("Loading player data from ")) {
        $gamePath = $line.Replace("Loading player data from ", "").Replace("data.unity3d", "")
        break
    }
}

if (-not $gamePath) {
    Write-Host "  X Player.log 找不到 Loading player data from 那行。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    return
}

Write-Host "  OK 安裝路徑: $gamePath" -ForegroundColor Green

# ── 3. 找最新版本 webCaches 目錄（依版號排，不是時間）─────────────────
Write-Host "[3/4] 搜尋快取目錄..." -ForegroundColor Cyan

$cachePath = $null
$maxVersion = 0
$webCacheRoot = "$gamePath\webCaches"

if (Test-Path $webCacheRoot) {
    $cacheFolders = Get-ChildItem $webCacheRoot -Directory -ErrorAction SilentlyContinue
    foreach ($folder in $cacheFolders) {
        if ($folder.Name -match '^\d+\.\d+\.\d+\.\d+$') {
            $version = [int64](-join $folder.Name.Split("."))
            if ($version -ge $maxVersion) {
                $maxVersion = $version
                $cachePath = "$webCacheRoot\$($folder.Name)\Cache\Cache_Data\data_2"
            }
        }
    }
}

# 如果沒找到帶版號的目錄，退回直接路徑
if (-not $cachePath -or -not (Test-Path $cachePath)) {
    $cachePath = "$webCacheRoot\Cache\Cache_Data\data_2"
}

if (-not (Test-Path $cachePath)) {
    Write-Host "  X 找不到快取檔 data_2。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    return
}

Write-Host "  OK 快取檔: $cachePath" -ForegroundColor Green

# ── 4. 解析快取 + 驗證 URL ────────────────────────────────────────────────
Write-Host "[4/4] 解析 URL 並逐一驗證有效性..." -ForegroundColor Cyan

# 複製到 temp 再讀，避免遊戲鎖檔
$tmpPath = [IO.Path]::GetTempPath() + [Guid]::NewGuid().ToString()
try {
    Copy-Item -Path $cachePath -Destination $tmpPath -ErrorAction Stop
    $cacheData = Get-Content -Encoding UTF8 -Raw $tmpPath
}
catch {
    Write-Host "  X 讀取快取檔失敗: $_" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    return
}
finally {
    if (Test-Path $tmpPath) {
        Remove-Item -Path $tmpPath -ErrorAction SilentlyContinue
    }
}

# 用 '1/0/' 分隔（Chromium 快取格式特徵）
$blocks = $cacheData -split '1/0/'
$foundUrl = $null

# 從最後一條往前找
for ($i = $blocks.Length - 1; $i -ge 0; $i--) {
    $block = $blocks[$i]
    if (-not $block.StartsWith('http')) { continue }

    $isGachaLog = $block.Contains('getGachaLog')
    $isLdGachaLog = $block.Contains('getLdGachaLog')
    if (-not $isGachaLog -and -not $isLdGachaLog) { continue }

    # 拆掉 null character 之後的雜訊
    $url = ($block -split "`0")[0]

    # 實際打 API 驗證
    try {
        $resp = Invoke-WebRequest -Uri $url -ContentType "application/json" -UseBasicParsing -TimeoutSec 8
        $json = $resp.Content | ConvertFrom-Json
    }
    catch {
        continue
    }

    if ($json.retcode -ne 0) { continue }

    # 清理 URL：只保留必要參數
    $uri = [Uri]$url
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    $keep = @('authkey', 'authkey_ver', 'sign_type', 'game_biz', 'lang', 'region', 'auth_appid', 'plat_type')
    $allKeys = @($query.AllKeys)
    foreach ($k in $allKeys) {
        if ($keep -notcontains $k) {
            $query.Remove($k)
        }
    }
    $foundUrl = "$($uri.Scheme)://$($uri.Host)$($uri.AbsolutePath)?$($query.ToString())"
    break
}

if (-not $foundUrl) {
    Write-Host ""
    Write-Host "  X 快取中找不到目前有效的抽卡 URL。" -ForegroundColor Red
    Write-Host "    請確認:" -ForegroundColor Gray
    Write-Host "    1. 已在遊戲內打開 躍遷 -> 紀錄 頁面" -ForegroundColor Gray
    Write-Host "    2. authkey 約 24 小時失效，是否太久沒打開" -ForegroundColor Gray
    Read-Host "按 Enter 結束"
    return
}

Set-Clipboard -Value $foundUrl

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  OK URL 已驗證且複製到剪貼簿!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
$preview = $foundUrl.Substring(0, [Math]::Min($foundUrl.Length, 120))
Write-Host "  URL 預覽: $preview..." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  -> 回網頁 [匯入紀錄] 分頁 Ctrl+V 貼上" -ForegroundColor Yellow
Write-Host ""

Read-Host "按 Enter 結束"
