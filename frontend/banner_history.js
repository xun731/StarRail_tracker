'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  HSR Banner 歷史 — 完整對照表（自動由 RAW_BANNER_DATES + BANNER_CHARS 組合）
// ────────────────────────────────────────────────────────────────────────────
//  載入順序（index.html）：
//    data.js          → HSR_LIGHT_CONES（含 char 欄位用於光錐反查）
//    banner_chars.js  → BANNER_CHARS（每期 UP 角色清單）
//    banner_history.js → 本檔，組合出 BANNER_HISTORY + isPullOffBanner()
//
//  本檔本身不依賴後端。只要 RAW_BANNER_DATES 有對應期次的日期，
//  系統就能判斷該時間點的歪。新版本上線時：
//    1. 在 banner_chars.js 加上 'X.X 第一期': ['角色名']
//    2. 在下方 RAW_BANNER_DATES 加上對應日期
//  光錐 banner 會自動從 data.js HSR_LIGHT_CONES 反查產生。
//
//  日期來源：https://honkai-star-rail.fandom.com/zh/wiki/躍遷 （手動同步）
// ════════════════════════════════════════════════════════════════════════════

const RAW_BANNER_DATES = [
  // ─── 1.x ────────────────────────────────────────────────────────────────
  { v: '1.0', p: '第一期', s: '2023-04-26', e: '2023-05-17' },
  { v: '1.0', p: '第二期', s: '2023-05-17', e: '2023-06-06' },
  { v: '1.1', p: '第一期', s: '2023-06-07', e: '2023-06-28' },
  { v: '1.1', p: '第二期', s: '2023-06-28', e: '2023-07-18' },
  { v: '1.2', p: '第一期', s: '2023-07-19', e: '2023-08-09' },
  { v: '1.2', p: '第二期', s: '2023-08-09', e: '2023-08-29' },
  { v: '1.3', p: '第一期', s: '2023-08-30', e: '2023-09-20' },
  { v: '1.3', p: '第二期', s: '2023-09-20', e: '2023-10-10' },
  { v: '1.4', p: '第一期', s: '2023-10-11', e: '2023-10-27' },
  { v: '1.4', p: '第二期', s: '2023-10-27', e: '2023-11-14' },
  { v: '1.5', p: '第一期', s: '2023-11-15', e: '2023-12-06' },
  { v: '1.5', p: '第二期', s: '2023-12-06', e: '2023-12-26' },
  { v: '1.6', p: '第一期', s: '2023-12-27', e: '2024-01-17' },
  { v: '1.6', p: '第二期', s: '2024-01-17', e: '2024-02-05' },

  // ─── 2.x ────────────────────────────────────────────────────────────────
  { v: '2.0', p: '第一期', s: '2024-02-06', e: '2024-02-29' },
  { v: '2.0', p: '第二期', s: '2024-02-29', e: '2024-03-26' },
  { v: '2.1', p: '第一期', s: '2024-03-27', e: '2024-04-17' },
  { v: '2.1', p: '第二期', s: '2024-04-17', e: '2024-05-07' },
  { v: '2.2', p: '第一期', s: '2024-05-08', e: '2024-05-29' },
  { v: '2.2', p: '第二期', s: '2024-05-29', e: '2024-06-18' },
  { v: '2.3', p: '第一期', s: '2024-06-19', e: '2024-07-10' },
  { v: '2.3', p: '第二期', s: '2024-07-10', e: '2024-07-30' },
  { v: '2.4', p: '第一期', s: '2024-07-31', e: '2024-08-21' },
  { v: '2.4', p: '第二期', s: '2024-08-21', e: '2024-09-09' },
  { v: '2.5', p: '第一期', s: '2024-09-10', e: '2024-10-02' },
  { v: '2.5', p: '第二期', s: '2024-10-02', e: '2024-10-22' },
  { v: '2.6', p: '第一期', s: '2024-10-23', e: '2024-11-13' },
  { v: '2.6', p: '第二期', s: '2024-11-13', e: '2024-12-02' },
  { v: '2.7', p: '第一期', s: '2024-12-04', e: '2024-12-25' },
  { v: '2.7', p: '第二期', s: '2024-12-25', e: '2025-01-14' },

  // ─── 3.x ────────────────────────────────────────────────────────────────
  { v: '3.0', p: '第一期', s: '2025-01-15', e: '2025-02-05' },
  { v: '3.0', p: '第二期', s: '2025-02-05', e: '2025-02-25' },
  { v: '3.1', p: '第一期', s: '2025-02-26', e: '2025-03-19' },
  { v: '3.1', p: '第二期', s: '2025-03-19', e: '2025-04-08' },
  { v: '3.2', p: '第一期', s: '2025-04-09', e: '2025-04-30' },
  { v: '3.2', p: '第二期', s: '2025-04-30', e: '2025-05-20' },
  { v: '3.3', p: '第一期', s: '2025-05-21', e: '2025-06-11' },
  { v: '3.3', p: '第二期', s: '2025-06-11', e: '2025-07-01' },
  // 3.4 依 3 週節奏估算（fandom 該段資料顯示有誤）
  { v: '3.4', p: '第一期', s: '2025-07-02', e: '2025-07-22' },
  { v: '3.4', p: '第二期', s: '2025-07-22', e: '2025-08-12' },
  { v: '3.5', p: '第一期', s: '2025-08-13', e: '2025-09-02' },
  { v: '3.5', p: '第二期', s: '2025-09-02', e: '2025-09-23' },
  { v: '3.6', p: '第一期', s: '2025-09-24', e: '2025-10-15' },
  { v: '3.6', p: '第二期', s: '2025-10-15', e: '2025-11-04' },
  { v: '3.7', p: '第一期', s: '2025-11-05', e: '2025-11-26' },
  { v: '3.7', p: '第二期', s: '2025-11-26', e: '2025-12-16' },
  { v: '3.8', p: '第一期', s: '2025-12-17', e: '2026-01-07' },
  // 17173 把 fandom 的「3.8 第二期」對應到「中期」、把第三期對應到「第二期」
  { v: '3.8', p: '中期',   s: '2026-01-07', e: '2026-01-28' },
  { v: '3.8', p: '第二期', s: '2026-01-28', e: '2026-02-12' },

  // ─── 4.x ────────────────────────────────────────────────────────────────
  // 4.0 fandom 尚未收，依 3 週節奏估算（4.1 起始 2026-03-25 反推）
  { v: '4.0', p: '第一期', s: '2026-02-13', e: '2026-03-03 11:59:59' },
  { v: '4.0', p: '第二期', s: '2026-03-03 12:00:00', e: '2026-03-24 15:00:00' },

  // 4.1 來源：官方公告（含精確時間）
  // 不死途為「全場」設計，貫穿 03/25 - 04/21 15:00；
  // 上半 03/25 - 04/08 11:59 搭風堇，下半 04/08 12:00 - 04/21 15:00 搭波提歐
  { v: '4.1', p: '第一期', s: '2026-03-25 11:00:00', e: '2026-04-08 11:59:59' },
  { v: '4.1', p: '第二期', s: '2026-04-08 12:00:00', e: '2026-04-21 15:00:00' },

  // 4.2 來源：官方公告（含精確時間）
  { v: '4.2', p: '第一期', s: '2026-04-22 11:00:00', e: '2026-05-13 11:59:59' },
  { v: '4.2', p: '第二期', s: '2026-05-13 12:00:00', e: '2026-06-01 03:59:59' },
];

// 把 date-only / date-time 字串統一成完整 'YYYY-MM-DD HH:MM:SS'
// 日期僅給 'YYYY-MM-DD' 時，start 套 06:00:00、end 套 14:59:59 為近似
function _asDateTime(s, isEnd) {
  return (s && s.length > 10) ? s : `${s} ${isEnd ? '14:59:59' : '06:00:00'}`;
}

// 聯動池（長期開放，end 留 9999 表示尚未結束）
const COLLAB_BANNERS = [
  {
    type: 'collab_char',
    start: '2025-07-11 06:00:00',
    end:   '9999-12-31 23:59:59',
    up:    ['Saber', 'Archer'],
  },
  {
    type: 'collab_lc',
    start: '2025-07-11 06:00:00',
    end:   '9999-12-31 23:59:59',
    up:    ['沒有回報的加冕', '理想燃燒的地獄'],
  },
];

// ── 由 RAW_BANNER_DATES + BANNER_CHARS + HSR_LIGHT_CONES 合成完整 BANNER_HISTORY ─
const BANNER_HISTORY = [];

(function buildBannerHistory() {
  const noChars = [];
  const noLc    = [];

  for (const d of RAW_BANNER_DATES) {
    const key = `${d.v} ${d.p}`;
    const chars = (typeof BANNER_CHARS !== 'undefined') ? BANNER_CHARS[key] : null;
    if (!chars || chars.length === 0) {
      noChars.push(key);
      continue;
    }
    const start = _asDateTime(d.s, false);
    const end   = _asDateTime(d.e, true);

    // 角色 banner（含新+復刻）
    BANNER_HISTORY.push({ type: 'character', start, end, up: [...chars] });

    // 光錐 banner（從 data.js HSR_LIGHT_CONES 反查每位角色的簽名光錐）
    const lcs = (typeof HSR_LIGHT_CONES !== 'undefined')
      ? chars.map(c => HSR_LIGHT_CONES.find(lc => lc.char === c)?.name).filter(Boolean)
      : [];
    if (lcs.length > 0) {
      BANNER_HISTORY.push({ type: 'light_cone', start, end, up: lcs });
    }
    if (lcs.length < chars.length) {
      const missing = chars.filter(c =>
        !(typeof HSR_LIGHT_CONES !== 'undefined'
          && HSR_LIGHT_CONES.find(lc => lc.char === c))
      );
      noLc.push(`${key}: ${missing.join(',')}`);
    }
  }

  // 聯動池附加
  BANNER_HISTORY.push(...COLLAB_BANNERS);

  if (noChars.length) {
    console.warn(
      `[banner_history] 有 ${noChars.length} 期日期已收但 banner_chars.js 沒對應角色：\n  ` +
      noChars.join('\n  ')
    );
  }
  if (noLc.length) {
    console.info(
      `[banner_history] ${noLc.length} 期有角色找不到簽名光錐（不影響歪判定，僅光錐 banner 不會記錄該位）：\n  ` +
      noLc.join('\n  ')
    );
  }
  console.info(`[banner_history] 建立完成：${BANNER_HISTORY.length} 筆 banner entries（含聯動）`);
})();

/**
 * 找出在指定時間點，指定卡池的所有活躍 banner（理論上 0 或 1 個）。
 */
function findActiveBanners(pool, timestamp) {
  if (!timestamp) return [];
  return BANNER_HISTORY.filter(b =>
    b.type === pool &&
    timestamp >= b.start &&
    timestamp <= b.end
  );
}

/**
 * 判斷某筆紀錄是否「歪」。
 * @returns {boolean}  true = 歪、false = 沒歪（或無法判定）
 */
function isPullOffBanner(pool, name, timestamp, entryType) {
  if (pool === 'standard') return false;
  if (entryType === 'standard') return true;

  const active = findActiveBanners(pool, timestamp);
  if (active.length === 0) {
    if (typeof window !== 'undefined' && window._bannerMissLog) {
      window._bannerMissLog.add(`${pool}|${timestamp}|${name}`);
    }
    return false;
  }
  return !active.some(b => b.up.includes(name));
}

if (typeof window !== 'undefined' && !window._bannerMissLog) {
  window._bannerMissLog = new Set();
}
