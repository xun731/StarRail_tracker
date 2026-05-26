'use strict';

const IMG_BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon';

// ──────────────────────────────────────────────────────────────────────────────
// 五星角色資料（id = Mar-7th/StarRailRes 圖片用 ID）
// ──────────────────────────────────────────────────────────────────────────────
const HSR_CHARACTERS = [
  // 常駐
  { name: '克拉拉',    type: 'standard', id: 1107 },
  { name: '傑帕德',    type: 'standard', id: 1104 },
  { name: '布洛妮婭',  type: 'standard', id: 1101 },
  { name: '瓦爾特',    type: 'standard', id: 1004 },
  { name: '姬子',      type: 'standard', id: 1003 },
  { name: '白露',      type: 'standard', id: 1211 },
  { name: '彥卿',      type: 'standard', id: 1209 },
  // 限定（依 ID 排序）
  { name: '卡芙卡',    type: 'limited',  id: 1005 },
  { name: '銀狼',      type: 'limited',  id: 1006 },
  { name: '希兒',      type: 'limited',  id: 1102 },
  { name: '托帕&帳帳', type: 'limited',  id: 1112 },
  { name: '羅剎',      type: 'limited',  id: 1203 },
  { name: '景元',      type: 'limited',  id: 1204 },
  { name: '刃',        type: 'limited',  id: 1205 },
  { name: '符玄',      type: 'limited',  id: 1208 },
  { name: '鏡流',      type: 'limited',  id: 1212 },
  { name: '丹恆·飲月', type: 'limited',  id: 1213 },
  { name: '藿藿',      type: 'limited',  id: 1217 },
  { name: '椒丘',      type: 'limited',  id: 1218 },
  { name: '飛霄',      type: 'limited',  id: 1220 },
  { name: '雲璃',      type: 'limited',  id: 1221 },
  { name: '靈砂',      type: 'limited',  id: 1222 },
  { name: '忘歸人',    type: 'limited',  id: 1225 },
  { name: '銀枝',      type: 'limited',  id: 1302 },
  { name: '阮梅',      type: 'limited',  id: 1303 },
  { name: '砂金',      type: 'limited',  id: 1304 },
  { name: '真理醫生',  type: 'limited',  id: 1305 },
  { name: '花火',      type: 'limited',  id: 1306 },
  { name: '黑天鵝',    type: 'limited',  id: 1307 },
  { name: '黃泉',      type: 'limited',  id: 1308 },
  { name: '知更鳥',    type: 'limited',  id: 1309 },
  { name: '流螢',      type: 'limited',  id: 1310 },
  { name: '星期日',    type: 'limited',  id: 1313 },
  { name: '翡翠',      type: 'limited',  id: 1314 },
  { name: '波提歐',    type: 'limited',  id: 1315 },
  { name: '亂破',      type: 'limited',  id: 1317 },
  { name: '大理花',    type: 'limited',  id: 1321 },
  { name: '大黑塔',    type: 'limited',  id: 1401 },
  { name: '阿格萊雅',  type: 'limited',  id: 1402 },
  { name: '緹寶',      type: 'limited',  id: 1403 },
  { name: '萬敵',      type: 'limited',  id: 1404 },
  { name: '那刻夏',    type: 'limited',  id: 1405 },
  { name: '賽飛兒',    type: 'limited',  id: 1406 },
  { name: '遐蝶',      type: 'limited',  id: 1407 },
  { name: '白厄',      type: 'limited',  id: 1408 },
  { name: '風堇',      type: 'limited',  id: 1409 },
  { name: '海瑟音',    type: 'limited',  id: 1410 },
  { name: '刻律德菈',  type: 'limited',  id: 1412 },
  { name: '長夜月',    type: 'limited',  id: 1413 },
  { name: '丹恆·騰荒', type: 'limited',  id: 1414 },
  { name: '昔漣',      type: 'limited',  id: 1415 },
  { name: '火花',      type: 'limited',  id: 1501 },
  { name: '爻光',      type: 'limited',  id: 1502 },
  { name: '不死途',    type: 'limited',  id: 1504 },
  { name: '緋英',      type: 'limited',  id: 1505 },
  { name: '銀狼LV.999',type: 'limited',  id: 1506 },
  // 聯動
  { name: 'Saber',     type: 'collab',   id: 1014 },
  { name: 'Archer',    type: 'collab',   id: 1015 },
];

// ──────────────────────────────────────────────────────────────────────────────
// 五星光錐資料
// char: 簽名角色（確認的才填，不確定留 null）
// id:   Mar-7th/StarRailRes 圖片用 ID
// ──────────────────────────────────────────────────────────────────────────────
const HSR_LIGHT_CONES = [
  // ── 確認有簽名角色 ──────────────────────────────────────────────────────────
  { name: '銀河鐵道之夜',   char: '姬子',    id: 23000, type: 'standard' },
  { name: '於夜色中',       char: '希兒',    id: 23001, type: 'limited'  },
  { name: '無可取代的東西', char: '克拉拉',  id: 23002, type: 'standard' },
  { name: '但戰鬥還未結束', char: '布洛妮婭',id: 23003, type: 'standard' },
  { name: '以世界之名',     char: '瓦爾特',  id: 23004, type: 'standard' },
  { name: '制勝的瞬間',     char: '傑帕德',  id: 23005, type: 'standard' },
  { name: '只需等待',       char: '卡芙卡',  id: 23006, type: 'limited'  },
  { name: '雨一直下',       char: '銀狼',    id: 23007, type: 'limited'  },
  { name: '棺的迴響',       char: '羅剎',    id: 23008, type: 'limited'  },
  { name: '到不了的彼岸',   char: '刃',      id: 23009, type: 'limited'  },
  { name: '拂曉之前',       char: '景元',    id: 23010, type: 'limited'  },
  { name: '她已閉上雙眼',   char: '符玄',    id: 23011, type: 'limited'  },
  { name: '如泥酣眠',       char: '彥卿',    id: 23012, type: 'standard'  },
  { name: '時節不居',       char: '白露',    id: 23013, type: 'standard' },
  { name: '此身為劍',       char: '鏡流',    id: 23014, type: 'limited'  },
  { name: '比陽光更明亮的', char: '丹恆·飲月',id: 23015, type: 'limited' },
  { name: '煩惱著，幸福著', char: '托帕&帳帳',id: 23016, type: 'limited' },
  { name: '驚魂夜',         char: '藿藿',    id: 23017, type: 'limited'  },
  { name: '片刻，留在眼底', char: '銀枝',     id: 23018, type: 'limited'  },
  { name: '鏡中故我',       char: '阮梅',    id: 23019, type: 'limited'  },
  { name: '純粹思維的洗禮', char: '真理醫生', id: 23020, type: 'limited'  },
  { name: '遊戲塵寰',       char: '花火',    id: 23021, type: 'limited'  },
  { name: '重塑時光之憶',   char: '黑天鵝',  id: 23022, type: 'limited'  },
  { name: '命運從未公平',   char: '砂金',    id: 23023, type: 'limited'  },
  { name: '行於流逝的岸',   char: '黃泉',    id: 23024, type: 'limited'  },
  { name: '夢應歸於何處',   char: '流螢',    id: 23025, type: 'limited'  },
  { name: '夜色流光溢彩',   char: '知更鳥',  id: 23026, type: 'limited'  },
  { name: '駛向第二次生命', char: '波提歐',  id: 23027, type: 'limited'  },
  { name: '偏偏希望無價',   char: '翡翠',    id: 23028, type: 'limited'  },
  { name: '那無數個春天',   char: '椒丘',    id: 23029, type: 'limited'  },
  { name: '落日時起舞',     char: '雲璃',    id: 23030, type: 'limited'  },
  { name: '我將，巡徵追獵', char: '飛霄',    id: 23031, type: 'limited'  },
  { name: '唯有香如故',     char: '靈砂',    id: 23032, type: 'limited'  },
  { name: '忍法帖·繚亂破魔',char: '亂破',    id: 23033, type: 'limited'  },
  { name: '回到大地的飛行', char: '星期日',  id: 23034, type: 'limited'  },
  { name: '長路終有歸途',   char: '忘歸人',  id: 23035, type: 'limited'  },
  { name: '將光陰織成黃金', char: '阿格萊雅',id: 23036, type: 'limited'  },
  { name: '向著不可追問處', char: '大黑塔',  id: 23037, type: 'limited'  },
  { name: '如果時間是一朵花',char: '緹寶',   id: 23038, type: 'limited'  },
  { name: '血火啊，燃燒前路',char: '萬敵',   id: 23039, type: 'limited'  },
  { name: '讓告別，更美一點',char: '遐蝶',   id: 23040, type: 'limited'  },
  { name: '生命當付之一炬', char: '那刻夏',  id: 23041, type: 'limited'  },
  { name: '願虹光永駐天空', char: '風堇',    id: 23042, type: 'limited'  },
  { name: '謊言在風中飄揚', char: '賽飛兒',  id: 23043, type: 'limited'  },
  { name: '黎明恰如此燃燒', char: '白厄',    id: 23044, type: 'limited'  },
  { name: '沒有回報的加冕', char: 'Saber',   id: 23045, type: 'collab'  },
  { name: '理想燃燒的地獄', char: 'Archer',  id: 23046, type: 'collab'  },
  { name: '海洋為何而歌',   char: '海瑟音',  id: 23047, type: 'limited'  },
  { name: '金血銘刻的時代', char: '刻律德菈', id: 23048, type: 'limited' },
  { name: '致長夜的星光',   char: '長夜月',   id: 23049, type: 'limited'  },
  { name: '勿忘她的火焰',   char: '大理花',   id: 23050, type: 'limited'  },
  { name: '縱然山河萬程',   char: '丹恆·騰荒',id: 23051, type: 'limited'  },
  { name: '愛如此刻永恆',   char: '昔漣',    id: 23052, type: 'limited'  },
  { name: '花花世界迷人眼', char: '火花',    id: 23053, type: 'limited'  },
  { name: '當她決定看見',   char: '爻光',    id: 23054, type: 'limited' },
  { name: '一場謊言的終幕', char: '不死途',   id: 23056, type: 'limited'  },
  { name: '歡迎來到銀河城', char: '銀狼LV.999',id: 23057, type: 'limited'  },
  { name: '邂逅於下一個花季',char: '緋英',   id: 23058, type: 'limited'  },
];

// ── 自動建立名稱→ID 查表 ──────────────────────────────────────────────────────
const CHAR_TO_ID = {};
const LC_TO_ID   = {};
HSR_CHARACTERS.forEach(c  => { CHAR_TO_ID[c.name] = c.id; });
HSR_LIGHT_CONES.forEach(lc => { LC_TO_ID[lc.name] = lc.id; });

/**
 * 依名稱取得角色或光錐的圖片 URL
 * @param {string} name
 * @returns {string|null}
 */
function getImageUrl(name) {
  const cid = CHAR_TO_ID[name];
  if (cid) return `${IMG_BASE}/character/${cid}.png`;
  const lid = LC_TO_ID[name];
  if (lid) return `${IMG_BASE}/light_cone/${lid}.png`;
  return null;
}

// ── 自動補全 ──────────────────────────────────────────────────────────────────

/**
 * 取得指定卡池的自動補全候選清單
 * 光錐池：輸入角色名也能找到該角色的簽名光錐（因顯示格式包含角色名）
 * @param {'character'|'light_cone'|'standard'|'collab_char'|'collab_lc'} pool
 */
function getAutoCompleteItems(pool) {
  if (pool === 'character') {
    return HSR_CHARACTERS.map(c => ({ display: c.name, value: c.name }));
  }
  if (pool === 'light_cone') {
    return HSR_LIGHT_CONES.map(lc => ({
      display: lc.char ? `${lc.name}（${lc.char}）` : lc.name,
      value: lc.name,
    }));
  }
  if (pool === 'collab_char') {
    return HSR_CHARACTERS
      .filter(c => c.type === 'collab')
      .map(c => ({ display: c.name, value: c.name }));
  }
  if (pool === 'collab_lc') {
    return HSR_LIGHT_CONES
      .filter(lc => lc.type === 'collab')
      .map(lc => ({
        display: lc.char ? `${lc.name}（${lc.char}）` : lc.name,
        value: lc.name,
      }));
  }
  // standard: 常駐角色 + 常駐光錐
  const chars = HSR_CHARACTERS
    .filter(c => c.type === 'standard')
    .map(c => ({ display: c.name, value: c.name }));
  const lcs = HSR_LIGHT_CONES
    .filter(lc => lc.type === 'standard')
    .map(lc => ({ display: lc.char ? `${lc.name}（${lc.char}）` : lc.name, value: lc.name }));
  return [...chars, ...lcs];
}

/**
 * 取得 UP池欄位的候選清單（歪的時候填「在哪個 UP 池歪的」）
 * @param {'character'|'light_cone'|'collab_char'|'collab_lc'} pool
 */
function getUpBannerItems(pool) {
  if (pool === 'character') {
    return HSR_CHARACTERS
      .filter(c => c.type === 'limited' || c.type === 'collab')
      .map(c => ({ display: c.name, value: c.name }));
  }
  if (pool === 'collab_char') {
    return HSR_CHARACTERS
      .filter(c => c.type === 'collab')
      .map(c => ({ display: c.name, value: c.name }));
  }
  if (pool === 'collab_lc') {
    return HSR_LIGHT_CONES
      .filter(lc => lc.type === 'collab')
      .map(lc => ({
        display: lc.char ? `${lc.name}（${lc.char}）` : lc.name,
        value: lc.name,
      }));
  }
  return HSR_LIGHT_CONES
    .filter(lc => lc.type === 'limited')
    .map(lc => ({
      display: lc.char ? `${lc.name}（${lc.char}）` : lc.name,
      value: lc.name,
    }));
}

/**
 * 模糊搜尋（前綴優先 + 包含任意位置）
 */
function fuzzySearch(query, items) {
  if (!query) return [];
  const q = query.toLowerCase();
  const prefix = items.filter(i => i.display.toLowerCase().startsWith(q));
  const rest   = items.filter(i =>
    !i.display.toLowerCase().startsWith(q) && i.display.toLowerCase().includes(q));
  return [...prefix, ...rest].slice(0, 10);
}
