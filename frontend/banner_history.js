'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  HSR 卡池 UP 歷史對照表
// ────────────────────────────────────────────────────────────────────────────
//  用途：匯入抽卡紀錄時判斷「歪」的依據。
//
//  判斷邏輯（implemented in isPullOffBanner()）：
//    1. 該名稱在 data.js 標為 standard  → 一律歪
//    2. 該時間點查到對應 banner 且抽到的就在 UP 清單  → 不歪
//    3. 該時間點查到對應 banner 但 UP 清單沒有此名稱   → 歪
//    4. 查不到對應 banner（資料未收錄）                  → 保守回 false（不標歪），讓使用者手動標
//
//  格式：
//    type  : 'character' | 'light_cone' | 'collab_char' | 'collab_lc'
//    start : 'YYYY-MM-DD HH:MM:SS'（含）
//    end   : 'YYYY-MM-DD HH:MM:SS'（含）
//    up    : ['UP 角色 / 光錐名稱', ...]
//
//  ⚠ 此表需手動維護。資料來源建議：
//    - Mar-7th 社群資源
//  下方範例只涵蓋部分版本，新 banner 請依官方公告補上。
// ════════════════════════════════════════════════════════════════════════════

const BANNER_HISTORY = [
  // ═══ v1.0 (2023-04-26) ══════════════════════════════════════════════════
  { type: 'character',  start: '2023-04-26 06:00:00', end: '2023-05-16 14:59:59', up: ['希兒'] },
  { type: 'light_cone', start: '2023-04-26 06:00:00', end: '2023-05-16 14:59:59', up: ['於夜色中'] },
  { type: 'character',  start: '2023-05-17 18:00:00', end: '2023-06-06 14:59:59', up: ['景元'] },
  { type: 'light_cone', start: '2023-05-17 18:00:00', end: '2023-06-06 14:59:59', up: ['拂曉之前'] },

  // ═══ v1.1 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2023-06-07 06:00:00', end: '2023-06-27 14:59:59', up: ['銀狼'] },
  { type: 'light_cone', start: '2023-06-07 06:00:00', end: '2023-06-27 14:59:59', up: ['雨一直下'] },
  { type: 'character',  start: '2023-06-28 18:00:00', end: '2023-07-18 14:59:59', up: ['卡芙卡'] },
  { type: 'light_cone', start: '2023-06-28 18:00:00', end: '2023-07-18 14:59:59', up: ['只需等待'] },

  // ═══ v1.2 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2023-07-19 06:00:00', end: '2023-08-08 14:59:59', up: ['羅剎'] },
  { type: 'light_cone', start: '2023-07-19 06:00:00', end: '2023-08-08 14:59:59', up: ['棺的迴響'] },
  { type: 'character',  start: '2023-08-09 18:00:00', end: '2023-08-29 14:59:59', up: ['刃'] },
  { type: 'light_cone', start: '2023-08-09 18:00:00', end: '2023-08-29 14:59:59', up: ['到不了的彼岸'] },

  // ═══ v1.3 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2023-09-20 18:00:00', end: '2023-10-10 14:59:59', up: ['符玄'] },
  { type: 'light_cone', start: '2023-09-20 18:00:00', end: '2023-10-10 14:59:59', up: ['她已閉上雙眼'] },

  // ═══ v1.4 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2023-11-01 18:00:00', end: '2023-11-21 14:59:59', up: ['托帕&帳帳'] },
  { type: 'light_cone', start: '2023-11-01 18:00:00', end: '2023-11-21 14:59:59', up: ['煩惱著，幸福著'] },

  // ═══ v1.5 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2023-11-22 06:00:00', end: '2023-12-12 14:59:59', up: ['鏡流'] },
  { type: 'light_cone', start: '2023-11-22 06:00:00', end: '2023-12-12 14:59:59', up: ['此身為劍'] },
  { type: 'character',  start: '2023-12-13 18:00:00', end: '2024-01-02 14:59:59', up: ['丹恆·飲月'] },
  { type: 'light_cone', start: '2023-12-13 18:00:00', end: '2024-01-02 14:59:59', up: ['比陽光更明亮的'] },

  // ═══ v1.6 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2024-01-24 18:00:00', end: '2024-02-05 14:59:59', up: ['藿藿'] },
  { type: 'light_cone', start: '2024-01-24 18:00:00', end: '2024-02-05 14:59:59', up: ['如泥酣眠'] },

  // ═══ v2.0 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2024-02-06 11:00:00', end: '2024-02-27 14:59:59', up: ['黑天鵝'] },
  { type: 'light_cone', start: '2024-02-06 11:00:00', end: '2024-02-27 14:59:59', up: ['重塑時光之憶'] },
  { type: 'character',  start: '2024-02-28 18:00:00', end: '2024-03-26 14:59:59', up: ['黃泉'] },
  { type: 'light_cone', start: '2024-02-28 18:00:00', end: '2024-03-26 14:59:59', up: ['行於流逝的岸'] },

  // ═══ v2.1 ════════════════════════════════════════════════════════════════
  { type: 'character',  start: '2024-03-27 06:00:00', end: '2024-04-16 14:59:59', up: ['真理醫生'] },
  { type: 'light_cone', start: '2024-03-27 06:00:00', end: '2024-04-16 14:59:59', up: ['遊戲塵寰'] },
  { type: 'character',  start: '2024-04-17 18:00:00', end: '2024-05-07 14:59:59', up: ['砂金'] },
  { type: 'light_cone', start: '2024-04-17 18:00:00', end: '2024-05-07 14:59:59', up: ['命運從未公平'] },

  // ═══ TODO：請依官方公告 / Prydwen / Paimon.moe 補上 v2.2 之後的 banner ═══
  //
  // 範例（請取消註解並修正日期 / 名稱）：
  //
  // { type: 'character',  start: '2025-XX-XX HH:MM:SS', end: '2025-XX-XX HH:MM:SS', up: ['緋英'] },
  // { type: 'light_cone', start: '2025-XX-XX HH:MM:SS', end: '2025-XX-XX HH:MM:SS', up: ['邂逅於下一個花季'] },
  //
];

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
 * @param {string} pool        卡池名稱（character / light_cone / collab_char / collab_lc / standard）
 * @param {string} name        抽到的角色 / 光錐名稱
 * @param {string} timestamp   抽出時間 'YYYY-MM-DD HH:MM:SS'
 * @param {string|null} entryType  data.js 中該名稱的 type（standard / limited / collab）
 * @returns {boolean}  true = 歪、false = 沒歪（或無法判定）
 */
function isPullOffBanner(pool, name, timestamp, entryType) {
  // 常駐池本身沒有「歪」概念
  if (pool === 'standard') return false;

  // 規則 1：常駐 5★ 出現在 UP 池 → 必歪
  if (entryType === 'standard') return true;

  // 規則 2 & 3：查當時 banner
  const active = findActiveBanners(pool, timestamp);
  if (active.length === 0) {
    // 對照表沒有對應資料 → 保守回 false，由使用者手動修正
    return false;
  }
  // 抽到的名稱不在任何一個活躍 banner 的 UP 清單 → 歪
  return !active.some(b => b.up.includes(name));
}
