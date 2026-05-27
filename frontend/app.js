'use strict';

// ── 常數 ──────────────────────────────────────────────────────────────────────
const POOL_LIMIT  = {
  character: 90, light_cone: 80, standard: 90,
  collab_char: 90, collab_lc: 80,
};
const POOL_HAS_UP = {
  character: true, light_cone: true, standard: false,
  collab_char: true, collab_lc: true,
};

// 名稱 → 池子類型查表（standard / limited / collab），用於自動判斷歪了
const NAME_TO_TYPE = {};
HSR_CHARACTERS.forEach(c => { NAME_TO_TYPE[c.name] = c.type; });
HSR_LIGHT_CONES.forEach(l => { NAME_TO_TYPE[l.name] = l.type; });
function getEntryType(name) { return NAME_TO_TYPE[name] || null; }

// ── 狀態 ──────────────────────────────────────────────────────────────────────
let state = {
  activePool: 'character',
  user: null,
  pools: {
    character:    { pity: 0, guaranteed: false, records: [] },
    light_cone:   { pity: 0, guaranteed: false, records: [] },
    standard:     { pity: 0, records: [] },
    collab_char:  { pity: 0, guaranteed: false, records: [] },
    collab_lc:    { pity: 0, guaranteed: false, records: [] },
  },
  editingId: null,   // 目前正在編輯的 record id
};

// ── 工具 ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * 紀錄指紋（用於匯入時的重複偵測）。
 * 用 name + pullCount + timestamp 三項組合判斷「兩筆紀錄是不是同一抽」。
 * 比 gachaId 寬鬆（手動輸入的紀錄沒有 gachaId 但若 timestamp 一致也算同筆）。
 */
function fingerprint(r) {
  return `${r.name}|${r.pullCount}|${r.timestamp || ''}`;
}

// ── 順序工具 ──────────────────────────────────────────────────────────────────
/**
 * 依 order 升序排列。
 * 新慣例：#1 = 最上方 = 最新抽到的紀錄。
 */
function orderedRecords(records) {
  return [...records].sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });
}

/**
 * 載入後重整 order。若偵測到舊格式（含 date 欄位）或缺 order，
 * 則依 timestamp 新→舊 重新分配 order（#1 = 最新）。
 */
function migrateOrCompactOrders() {
  // 若舊資料有單一 'collab' 池，依名稱類型拆分至 collab_char / collab_lc
  if (state.pools.collab && (!state.pools.collab_char || !state.pools.collab_lc)) {
    const old = state.pools.collab;
    const charRecs = [];
    const lcRecs = [];
    (old.records || []).forEach(r => {
      const c = HSR_CHARACTERS.find(x => x.name === r.name);
      const l = HSR_LIGHT_CONES.find(x => x.name === r.name);
      if (c) charRecs.push(r);
      else if (l) lcRecs.push(r);
      else charRecs.push(r); // 名稱對不上的歸到角色池（罕見）
    });
    state.pools.collab_char = { pity: old.pity || 0, guaranteed: !!old.guaranteed, records: charRecs };
    state.pools.collab_lc   = { pity: 0,             guaranteed: false,            records: lcRecs };
    delete state.pools.collab;
  }

  // 補齊缺失池
  ['character', 'light_cone', 'standard', 'collab_char', 'collab_lc'].forEach(name => {
    if (!state.pools[name]) {
      state.pools[name] = POOL_HAS_UP[name]
        ? { pity: 0, guaranteed: false, records: [] }
        : { pity: 0, records: [] };
    }
  });

  Object.keys(state.pools).forEach(pool => {
    const records = state.pools[pool].records;
    if (!records.length) return;

    const hasLegacyDate = records.some(r => r.date != null);
    const missingOrder  = records.some(r => r.order == null);

    if (hasLegacyDate || missingOrder) {
      // 重置：timestamp 新者排上方（order 1）
      const sorted = [...records].sort((a, b) =>
        (b.timestamp || '').localeCompare(a.timestamp || ''));
      sorted.forEach((r, i) => {
        r.order = i + 1;
        if (r.date != null) delete r.date;
      });
    } else {
      // 僅壓平既有 order（消除間隙），保留使用者手動排序
      const sorted = [...records].sort((a, b) => a.order - b.order);
      sorted.forEach((r, i) => { r.order = i + 1; });
    }
    // 補上 source 欄位（舊資料一律視為 manual）
    records.forEach(r => { if (!r.source) r.source = 'manual'; });

    // Migration：舊版 mergeImportedRecords 會把無 timestamp 的 Excel 紀錄填上
    // createdAt ISO 字串（含 'T'），導致排序時被當成近期紀錄。
    // 偵測：source='import' + 沒有 gachaId + timestamp 是 ISO 格式
    //   → 視為當時被誤填的 Excel 紀錄，清空 timestamp 還原為「無時間」
    records.forEach(r => {
      if (r.source === 'import'
          && !r.gachaId
          && typeof r.timestamp === 'string'
          && r.timestamp.includes('T')) {
        r.timestamp = '';
      }
    });
  });
}

/** 重新計算所有卡池 guaranteed 狀態：以「最上方紀錄」決定 */
function recomputeAllGuaranteed() {
  Object.keys(state.pools).forEach(name => {
    if (!POOL_HAS_UP[name]) return;
    const top = orderedRecords(state.pools[name].records)[0];
    state.pools[name].guaranteed = top ? !!top.isOff : false;
  });
}

// ── 存取資料 ──────────────────────────────────────────────────────────────────
let saveTimer = null;
function persistData() {
  const payload = { pools: state.pools };
  saveLocal(payload);
  if (state.user) {
    showSync('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveToCloud(state.user.uid, payload);
        showSync('saved');
        console.info('[saveToCloud] 寫入成功 users/' + state.user.uid);
      } catch (err) {
        // err 來自 firebase.js classifyFirebaseError
        // 寫入失敗 → error 樣式不自動消失，直到使用者點掉，避免錯過
        showSync('error', `雲端寫入失敗：${err?.message || err}（點此關閉）`);
        console.error('[saveToCloud] 寫入失敗', err);
      }
    }, 1200);
  } else {
    showSync('local');
  }
}

/**
 * 對 pools 算個簡單指紋（不含 id / order）用於比對本機 vs 雲端是否一致。
 */
function poolsContentHash(pools) {
  if (!pools) return '';
  return Object.keys(pools).sort().map(k => {
    const recs = (pools[k]?.records || [])
      .map(r => fingerprint(r))
      .sort()
      .join(',');
    return `${k}=[${recs}]`;
  }).join('|');
}

function totalRecords(pools) {
  if (!pools) return 0;
  return Object.values(pools)
    .reduce((s, p) => s + (Array.isArray(p?.records) ? p.records.length : 0), 0);
}

/**
 * 讀取使用者資料。
 * 回傳：{ source, localHasRecords, conflict?: { cloudPools, localPools } }
 *   - source 'cloud' : Firestore 有資料、已套用
 *   - source 'local' : 雲端空、用 localStorage
 *   - source 'empty' : 都沒資料
 *   - conflict       : 雲端 + 本機都有資料且內容不同，需要使用者選一邊
 *                      （此時 state.pools 預設用 cloud，使用者選 local 時才覆寫）
 */
async function loadData() {
  const local = loadLocal();
  const localHasRecords = !!(local?.pools && Object.values(local.pools)
    .some(p => Array.isArray(p?.records) && p.records.length > 0));

  if (state.user) {
    try {
      const cloud = await loadFromCloud(state.user.uid);
      if (cloud?.pools) {
        // 雲端有資料 — 預設套用
        state.pools = cloud.pools;
        migrateOrCompactOrders();

        // 衝突偵測：本機與雲端都有紀錄、內容不同
        const conflict = (
          localHasRecords &&
          poolsContentHash(cloud.pools) !== poolsContentHash(local.pools)
        ) ? { cloudPools: cloud.pools, localPools: local.pools } : null;

        return { source: 'cloud', localHasRecords, conflict };
      }
    } catch (err) {
      showSync('error', `讀取雲端失敗：${err?.message || err}`);
      // 繼續嘗試 local
    }
  }
  if (local?.pools) {
    state.pools = local.pools;
    migrateOrCompactOrders();
    return { source: 'local', localHasRecords };
  }
  return { source: 'empty', localHasRecords: false };
}

// ── 同步狀態列 ────────────────────────────────────────────────────────────────
let syncHideTimer = null;
function showSync(type, detail) {
  const bar  = $('sync-bar');
  const msgs = {
    saving: '⏳ 同步中…',
    saved:  '✅ 已儲存至雲端',
    error:  '⚠️ 雲端同步失敗，資料已存本機' + (detail ? `（${detail}）` : ''),
    local:  '💾 資料儲存於本機（未登入）',
  };
  bar.textContent = msgs[type];
  bar.className = `sync-bar ${type}`;
  bar.style.display = '';
  clearTimeout(syncHideTimer);
  if (type === 'saved' || type === 'local') {
    syncHideTimer = setTimeout(() => { bar.style.display = 'none'; }, 2500);
  }
}
// 點 error 訊息可關掉
$('sync-bar').addEventListener('click', () => {
  if ($('sync-bar').classList.contains('error')) {
    $('sync-bar').style.display = 'none';
  }
});

// ── 動態載入遠端 banner 歷史（best-effort，失敗用 static fallback） ───────────
/**
 * 從 backend 拉 fandom 的最新 banner，合併進全域 BANNER_HISTORY。
 *
 * - 第一次呼叫會啟動 fetch 並 cache 該 Promise；
 *   後續呼叫回傳同個 Promise（不會重複打 backend）。
 * - 匯入流程 await 它確保 banner 資料就緒，再做歪判定。
 * - 預設冷啟動 backend 給 25 秒 timeout（Render free tier 喚醒約 30s 內）。
 */
let _remoteBannersPromise = null;
function loadRemoteBanners(timeoutMs = 25000) {
  if (_remoteBannersPromise) return _remoteBannersPromise;
  _remoteBannersPromise = (async () => {
    try {
      const customBackend = $('import-backend')?.value;
      const backend = (customBackend || getDefaultBackend()).trim().replace(/\/$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(`${backend}/api/banners`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      const enhanced = convertBannersToHistory(data.banners || []);
      if (enhanced.length === 0) {
        console.info('[banners] 後端回傳了，但本地對照表都沒對應，繼續用 static banner_history.js');
        return false;
      }

      // 合併策略：先用後端的，再把 static 中後端沒涵蓋到的補進去
      const enhancedFp = new Set(enhanced.map(b => `${b.type}|${b.start}|${b.up.join(',')}`));
      const supplement = BANNER_HISTORY.filter(b =>
        !enhancedFp.has(`${b.type}|${b.start}|${b.up.join(',')}`)
      );
      BANNER_HISTORY.length = 0;
      BANNER_HISTORY.push(...enhanced, ...supplement);

      console.info(`[banners] 已從後端載入 ${enhanced.length} 筆 banner（+${supplement.length} 筆 static 補充）`);
      return true;
    } catch (err) {
      // 不擾使用者 — 後端 sleep / 沒部署都會走這條路
      console.info('[banners] 遠端載入失敗，使用 static banner_history.js：', err?.message || err);
      // 失敗後允許重試：清掉 cache，下次呼叫會重新嘗試
      _remoteBannersPromise = null;
      return false;
    }
  })();
  return _remoteBannersPromise;
}
// 不再自動預載 — banner_history.js 靜態資料已涵蓋 1.0-4.1。
// 若 /api/banners 可用，匯入時會 await 一次當作補強；失敗則靜態為主。
// setTimeout(() => loadRemoteBanners(), 0);

// ── Firebase 驗證 ─────────────────────────────────────────────────────────────
initFirebase();

onAuthChange(async user => {
  state.user = user;
  const result = await loadData();
  renderAll();

  if (user) {
    $('auth-loading').style.display = 'none';
    $('auth-signed-out').style.display = 'none';
    $('auth-signed-in').style.display  = '';
    $('auth-avatar').src = user.photoURL || '';
    $('auth-name').textContent = user.displayName || user.email;
    showSync('saved');

    // 情境 A：首次登入遷移（雲端空、本機有紀錄 → 詢問是否上傳）
    if (result?.source === 'local' && result?.localHasRecords) {
      const totals = totalRecords(state.pools);
      openConfirm({
        title: '上傳本機資料到雲端？',
        message:
          `偵測到雲端帳號是空的，但本機有 <strong>${totals}</strong> 筆紀錄。<br>` +
          `要把本機資料上傳到雲端（Firestore）嗎？<br>` +
          `<span style="color:var(--muted)">之後在其他裝置登入同帳號就能看到。</span>`,
        okText: '☁ 上傳到雲端',
        cancelText: '保留本機（不上傳）',
        onOk: () => {
          persistData();
          showSync('saving');
        },
      });
    }

    // 情境 B：本機 + 雲端都有資料但內容不同 → 讓使用者選一邊
    if (result?.conflict) {
      const cloudCount = totalRecords(result.conflict.cloudPools);
      const localCount = totalRecords(result.conflict.localPools);
      openConfirm({
        title: '本機與雲端資料不同',
        message:
          `偵測到兩邊紀錄不一致，請選擇要套用哪一份（另一份會被覆蓋）：<br><br>` +
          `&nbsp;&nbsp;☁ <strong>雲端</strong>：${cloudCount} 筆紀錄<br>` +
          `&nbsp;&nbsp;💾 <strong>本機</strong>：${localCount} 筆紀錄<br><br>` +
          `<span style="color:var(--muted)">目前只能擇一，無法自動合併。</span>`,
        okText: '☁ 使用雲端',
        cancelText: '💾 使用本機',
        onOk: () => {
          // 已預設套用雲端，再寫一次本機以同步
          state.pools = result.conflict.cloudPools;
          migrateOrCompactOrders();
          persistData();   // 同時更新本機與雲端（內容一致，無實質改變）
          renderAll();
        },
        onCancel: () => {
          // 用本機覆寫雲端
          state.pools = result.conflict.localPools;
          migrateOrCompactOrders();
          persistData();   // 觸發寫雲端
          renderAll();
        },
      });
    }
  } else {
    $('auth-loading').style.display  = 'none';
    $('auth-signed-in').style.display = 'none';
    $('auth-signed-out').style.display = '';
    if (!FIREBASE_CONFIGURED) {
      $('auth-signed-out').innerHTML =
        '<p class="auth-hint">💾 未設定 Firebase，資料存於本機</p>';
    }
    showSync('local');
  }
});

// ── DevTools 診斷工具 ─────────────────────────────────────────────────────────
// 在 Console 用 hsrDebug.testWrite() 等指令來驗證雲端讀寫是否真的成功
window.hsrDebug = {
  state: () => state,
  user: () => state.user,
  testWrite: async () => {
    if (!state.user) { console.warn('未登入'); return; }
    try {
      await saveToCloud(state.user.uid, { pools: state.pools, _testAt: new Date().toISOString() });
      console.log('✅ 寫入成功，去 Firebase Console 看 users/' + state.user.uid);
    } catch (e) { console.error('❌ 寫入失敗', e); }
  },
  testRead: async () => {
    if (!state.user) { console.warn('未登入'); return; }
    try {
      const data = await loadFromCloud(state.user.uid);
      console.log('☁ 雲端目前的資料：', data);
      return data;
    } catch (e) { console.error('❌ 讀取失敗', e); }
  },
  forceUpload: () => persistData(),
};
console.info('%c[HSR Tracker] 診斷指令：hsrDebug.testWrite() / hsrDebug.testRead() / hsrDebug.forceUpload()', 'color:#7c5cbf');

$('sign-in-btn')?.addEventListener('click', async () => {
  try {
    await signInWithGoogle();
  } catch (err) {
    showSync('error', err?.message || '登入失敗');
    console.error('[signInWithGoogle]', err?.code, err);
  }
});
$('sign-out-btn')?.addEventListener('click', signOut);

// 防呆：5 秒內 Firebase 沒回應就強制顯示「未登入」畫面，避免卡在「載入中…」
setTimeout(() => {
  const loading = $('auth-loading');
  if (loading && loading.style.display !== 'none') {
    loading.style.display = 'none';
    $('auth-signed-out').style.display = '';
    if (!FIREBASE_CONFIGURED) {
      $('auth-signed-out').innerHTML =
        '<p class="auth-hint">💾 未設定 Firebase，資料存於本機</p>';
    }
  }
}, 5000);

// ── Tab 切換 ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'stats') renderStats();
  });
});

// 統計頁的「編輯模式」toggle
$('stats-edit-toggle')?.addEventListener('click', () => {
  statsEditMode = !statsEditMode;
  statsSelectedIds.clear();         // 切換時清空選取
  statsMovePickerActive = false;    // 也退出 picker 模式
  statsMovePickerPool   = null;
  renderStats();
});

// 批量操作：全選 / 取消選 / 刪除所選
$('batch-select-all')?.addEventListener('click', () => {
  document.querySelectorAll('#tab-stats .bar-cb').forEach(cb => {
    const key = `${cb.dataset.pool}:${cb.dataset.id}`;
    statsSelectedIds.add(key);
    cb.checked = true;
  });
  updateBatchCount();
});
$('batch-select-none')?.addEventListener('click', () => {
  statsSelectedIds.clear();
  document.querySelectorAll('#tab-stats .bar-cb').forEach(cb => { cb.checked = false; });
  updateBatchCount();
});
$('batch-move-btn')?.addEventListener('click', () => {
  if (statsSelectedIds.size === 0) return;
  // 檢查是否全部在同一池
  const pools = new Set([...statsSelectedIds].map(k => k.split(':')[0]));
  if (pools.size > 1) {
    showSync('error', '批量移動只支援同一池內的紀錄，請只勾選同一池');
    return;
  }
  statsMovePickerActive = true;
  statsMovePickerPool   = [...pools][0];
  renderStats();
});

$('picker-cancel')?.addEventListener('click', () => {
  statsMovePickerActive = false;
  statsMovePickerPool   = null;
  renderStats();
});

$('batch-delete-btn')?.addEventListener('click', () => {
  const count = statsSelectedIds.size;
  if (!count) return;
  openConfirm({
    title: '批量刪除',
    message:
      `確定要刪除選中的 <strong>${count}</strong> 筆紀錄嗎？<br>` +
      `<span style="color:var(--red)">此動作無法復原。</span>`,
    okText: '確認刪除',
    cancelText: '取消',
    onOk: () => {
      // 依 pool 分組
      const byPool = {};
      statsSelectedIds.forEach(key => {
        const [pool, id] = key.split(':');
        (byPool[pool] = byPool[pool] || new Set()).add(id);
      });
      // 各池過濾
      Object.entries(byPool).forEach(([pool, ids]) => {
        if (!state.pools[pool]) return;
        state.pools[pool].records = state.pools[pool].records.filter(r => !ids.has(r.id));
      });
      statsSelectedIds.clear();
      migrateOrCompactOrders();
      recomputeAllGuaranteed();
      persistData();
      renderRecordList();
      renderStats();
    },
  });
});

// ── 卡池切換 ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.pool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activePool = btn.dataset.pool;
    syncInputFromPool();
    renderRecordList();
  });
});

// ── 保底步進器 ────────────────────────────────────────────────────────────────
$('pity-plus').addEventListener('click', () => {
  const pool = state.pools[state.activePool];
  pool.pity = Math.min(pool.pity + 1, POOL_LIMIT[state.activePool] - 1);
  $('pity-now').value = pool.pity;
  updateInputPityBar();
  persistData();
});
$('pity-minus').addEventListener('click', () => {
  const pool = state.pools[state.activePool];
  pool.pity = Math.max(pool.pity - 1, 0);
  $('pity-now').value = pool.pity;
  updateInputPityBar();
  persistData();
});
$('pity-now').addEventListener('change', () => {
  const pool = state.pools[state.activePool];
  const limit = POOL_LIMIT[state.activePool];
  pool.pity = Math.max(0, Math.min(parseInt($('pity-now').value) || 0, limit - 1));
  $('pity-now').value = pool.pity;
  updateInputPityBar();
  persistData();
});
$('guaranteed').addEventListener('change', () => {
  state.pools[state.activePool].guaranteed = $('guaranteed').checked;
  persistData();
});

function updateInputPityBar() {
  const pity  = state.pools[state.activePool].pity;
  const limit = POOL_LIMIT[state.activePool];
  $('input-pity-bar').style.width = (pity / limit * 100).toFixed(1) + '%';
  $('pity-max-hint').textContent  = `/ ${limit} 大保底`;
}

function syncInputFromPool() {
  const pool = state.pools[state.activePool];
  $('pity-now').value       = pool.pity;
  $('guaranteed').checked   = pool.guaranteed || false;
  $('guaranteed-row').style.display = POOL_HAS_UP[state.activePool] ? '' : 'none';
  $('is-off-row').style.display     = POOL_HAS_UP[state.activePool] ? '' : 'none';
  $('up-banner-row').style.display  = 'none';
  updateInputPityBar();
  updateInsertPosSelect();

  acItems = getAutoCompleteItems(state.activePool);
  upItems = getUpBannerItems(state.activePool);
}

// ── 插入位置選擇器 ────────────────────────────────────────────────────────────
function updateInsertPosSelect() {
  const sel = $('insert-pos');
  if (!sel) return;
  const pool   = state.pools[state.activePool];
  const sorted = orderedRecords(pool.records);

  sel.innerHTML = '<option value="-1">新增至最上方（最新，預設）</option>';
  sorted.forEach((r, i) => {
    const label = r.name.length > 7 ? r.name.slice(0, 7) + '…' : r.name;
    sel.innerHTML +=
      `<option value="${i}">插入到 #${i + 1} ${esc(label)} 之後</option>`;
  });
}

// ── 主要自動補全 ──────────────────────────────────────────────────────────────
let acItems = getAutoCompleteItems('character');
let acIndex = -1;
const nameInput = $('name-input');
const acList    = $('autocomplete-list');

const autoCheckMain = () => maybeAutoCheckIsOff(nameInput, $('is-off'));

nameInput.addEventListener('input', () => {
  const matches = fuzzySearch(nameInput.value.trim(), acItems);
  renderAcList(acList, matches, nameInput, acIndex, i => { acIndex = i; }, autoCheckMain);
  acIndex = -1;
  autoCheckMain();   // 使用者完整鍵入名稱（不靠 autocomplete）也要觸發
});
nameInput.addEventListener('keydown', e =>
  handleAcKey(e, acList, nameInput, () => acIndex, i => { acIndex = i; }, autoCheckMain));
nameInput.addEventListener('blur', () =>
  setTimeout(() => { acList.style.display = 'none'; }, 150));

// ── UP池自動補全 ──────────────────────────────────────────────────────────────
let upItems = getUpBannerItems('character');
let upIndex = -1;
const upInput = $('up-banner-input');
const upList  = $('up-banner-list');

upInput.addEventListener('input', () => {
  const matches = fuzzySearch(upInput.value.trim(), upItems);
  renderAcList(upList, matches, upInput, upIndex, i => { upIndex = i; });
  upIndex = -1;
});
upInput.addEventListener('keydown', e =>
  handleAcKey(e, upList, upInput, () => upIndex, i => { upIndex = i; }));
upInput.addEventListener('blur', () =>
  setTimeout(() => { upList.style.display = 'none'; }, 150));

// 歪的 checkbox 控制 UP池欄位顯示
$('is-off').addEventListener('change', () => {
  $('up-banner-row').style.display = $('is-off').checked ? '' : 'none';
  if (!$('is-off').checked) upInput.value = '';
});

// ── 編輯 Modal 的自動補全 ─────────────────────────────────────────────────────
let editAcIndex = -1;
let editUpIndex = -1;
const editNameInput = $('edit-name-input');
const editAcList    = $('edit-autocomplete-list');
const editUpInput   = $('edit-up-banner-input');
const editUpList    = $('edit-up-banner-list');

const autoCheckEdit = () => maybeAutoCheckIsOff(editNameInput, $('edit-is-off'));

editNameInput.addEventListener('input', () => {
  const matches = fuzzySearch(editNameInput.value.trim(), acItems);
  renderAcList(editAcList, matches, editNameInput, editAcIndex, i => { editAcIndex = i; }, autoCheckEdit);
  editAcIndex = -1;
  autoCheckEdit();
});
editNameInput.addEventListener('keydown', e =>
  handleAcKey(e, editAcList, editNameInput, () => editAcIndex, i => { editAcIndex = i; }, autoCheckEdit));
editNameInput.addEventListener('blur', () =>
  setTimeout(() => { editAcList.style.display = 'none'; }, 150));

editUpInput.addEventListener('input', () => {
  const matches = fuzzySearch(editUpInput.value.trim(), upItems);
  renderAcList(editUpList, matches, editUpInput, editUpIndex, i => { editUpIndex = i; });
  editUpIndex = -1;
});
editUpInput.addEventListener('keydown', e =>
  handleAcKey(e, editUpList, editUpInput, () => editUpIndex, i => { editUpIndex = i; }));
editUpInput.addEventListener('blur', () =>
  setTimeout(() => { editUpList.style.display = 'none'; }, 150));

$('edit-is-off').addEventListener('change', () => {
  $('edit-up-banner-row').style.display = $('edit-is-off').checked ? '' : 'none';
  if (!$('edit-is-off').checked) editUpInput.value = '';
});

// ── 自動補全共用函式 ──────────────────────────────────────────────────────────
function renderAcList(list, matches, input, currentIdx, setIdx, onSelect) {
  if (!matches.length) { list.style.display = 'none'; return; }
  list.innerHTML = matches
    .map(m => `<li data-value="${esc(m.value)}">${esc(m.display)}</li>`)
    .join('');
  list.style.display = '';
  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = li.dataset.value;
      list.style.display = 'none';
      setIdx(-1);
      onSelect?.();
    });
  });
}
function handleAcKey(e, list, input, getIdx, setIdx, onSelect) {
  const items = list.querySelectorAll('li');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setIdx((getIdx() + 1) % items.length);
    highlightAc(items, getIdx());
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setIdx((getIdx() - 1 + items.length) % items.length);
    highlightAc(items, getIdx());
  } else if (e.key === 'Enter' && getIdx() >= 0) {
    input.value = items[getIdx()].dataset.value;
    list.style.display = 'none';
    setIdx(-1);
    onSelect?.();
  } else if (e.key === 'Escape') {
    list.style.display = 'none';
  }
}

// ── 自動勾選「歪了」：在 UP 池且名稱為常駐池角色/光錐時 ─────────────────────
function maybeAutoCheckIsOff(input, checkbox) {
  if (!POOL_HAS_UP[state.activePool]) return;
  const name = (input.value || '').trim();
  if (!name) return;
  if (getEntryType(name) === 'standard' && !checkbox.checked) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }
}
function highlightAc(items, idx) {
  items.forEach((li, i) => li.classList.toggle('active', i === idx));
  if (idx >= 0) items[idx]?.scrollIntoView({ block: 'nearest' });
}

// ── 新增紀錄 ──────────────────────────────────────────────────────────────────
$('add-record-btn').addEventListener('click', addRecord);
$('pull-count-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addRecord();
});

function addRecord() {
  const name      = nameInput.value.trim();
  const pullCount = parseInt($('pull-count-input').value);
  const isOff     = POOL_HAS_UP[state.activePool] ? $('is-off').checked : false;
  const upBanner  = isOff ? (upInput.value.trim() || null) : null;

  if (!name) {
    nameInput.style.borderColor = 'var(--red)'; nameInput.focus(); return;
  }
  nameInput.style.borderColor = '';
  if (!pullCount || pullCount < 1 || pullCount > 90) {
    $('pull-count-input').style.borderColor = 'var(--red)';
    $('pull-count-input').focus(); return;
  }
  $('pull-count-input').style.borderColor = '';

  const pool   = state.pools[state.activePool];
  const sorted = orderedRecords(pool.records);

  // -1 = 最上方（新一筆變 #1）；N>=0 = 插入到第 N+1 筆之後
  const insertVal = parseInt($('insert-pos')?.value ?? '-1');

  let newOrder;
  if (insertVal < 0 || sorted.length === 0) {
    // 新增至最上方 → 變成 #1，全部下移
    pool.records.forEach(r => { r.order += 1; });
    newOrder = 1;
  } else {
    const afterOrder = sorted[insertVal].order;
    newOrder = afterOrder + 1;
    pool.records.forEach(r => {
      if (r.order > afterOrder) r.order += 1;
    });
  }

  pool.records.push({
    id: newId(),
    name, pullCount, isOff, upBanner,
    order: newOrder,
    timestamp: new Date().toISOString(),
    source: 'manual',
  });

  // 依「最上方紀錄」重算 guaranteed
  recomputeAllGuaranteed();

  // 重置保底 + 清表單
  pool.pity = 0;
  $('pity-now').value = 0;
  $('guaranteed').checked = pool.guaranteed;
  updateInputPityBar();
  nameInput.value = '';
  $('pull-count-input').value = '';
  $('is-off').checked = false;
  $('up-banner-row').style.display = 'none';
  upInput.value = '';
  if ($('insert-pos')) $('insert-pos').value = '-1';

  persistData();
  renderRecordList();
}

// ── 編輯紀錄 ──────────────────────────────────────────────────────────────────
function openEditModal(recordId, poolName = state.activePool) {
  const pool = state.pools[poolName];
  const rec  = pool?.records.find(r => r.id === recordId);
  if (!rec) return;

  state.editingId   = recordId;
  state.editingPool = poolName;   // 記住改的是哪個池
  $('edit-modal-order').textContent = `#${rec.order}  ·  ${poolName}`;
  editNameInput.value = rec.name;
  editNameInput.style.borderColor = '';
  $('edit-pull-count-input').value = rec.pullCount;
  $('edit-pull-count-input').style.borderColor = '';

  const showOff = POOL_HAS_UP[poolName];
  $('edit-is-off-row').style.display = showOff ? '' : 'none';
  $('edit-is-off').checked = !!rec.isOff;
  $('edit-up-banner-row').style.display = (showOff && rec.isOff) ? '' : 'none';
  editUpInput.value = rec.upBanner || '';

  $('edit-modal').style.display = '';
}

function closeEditModal() {
  state.editingId = null;
  state.editingPool = null;
  $('edit-modal').style.display = 'none';
}

function saveEdit() {
  const id = state.editingId;
  const poolName = state.editingPool || state.activePool;
  if (!id) return;

  const pool = state.pools[poolName];
  const rec  = pool?.records.find(r => r.id === id);
  if (!rec) { closeEditModal(); return; }

  const name      = editNameInput.value.trim();
  const pullCount = parseInt($('edit-pull-count-input').value);
  const isOff     = POOL_HAS_UP[poolName] ? $('edit-is-off').checked : false;
  const upBanner  = isOff ? (editUpInput.value.trim() || null) : null;

  if (!name) {
    editNameInput.style.borderColor = 'var(--red)';
    editNameInput.focus(); return;
  }
  if (!pullCount || pullCount < 1 || pullCount > 90) {
    $('edit-pull-count-input').style.borderColor = 'var(--red)';
    $('edit-pull-count-input').focus(); return;
  }

  rec.name      = name;
  rec.pullCount = pullCount;
  rec.isOff     = isOff;
  rec.upBanner  = upBanner;

  recomputeAllGuaranteed();
  // 若改的是現在 active pool，同步 guaranteed 顯示
  if (poolName === state.activePool) {
    $('guaranteed').checked = pool.guaranteed;
  }

  closeEditModal();
  persistData();
  renderRecordList();
  // 若統計頁開著，也要 refresh
  if (document.querySelector('.tab[data-tab="stats"]')?.classList.contains('active')) {
    renderStats();
  }
}

// Modal 事件
$('edit-modal-close').addEventListener('click', closeEditModal);
$('edit-cancel-btn').addEventListener('click', closeEditModal);
$('edit-save-btn').addEventListener('click', saveEdit);
$('edit-modal').addEventListener('click', e => {
  if (e.target === $('edit-modal')) closeEditModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('edit-modal').style.display !== 'none') closeEditModal();
});

// ── 拖曳排序（共用狀態） ──────────────────────────────────────────────────────
let dragSrcId = null;

// ── 渲染紀錄列表（輸入頁） ────────────────────────────────────────────────────
function renderRecordList() {
  const pool = state.pools[state.activePool];
  $('record-badge').textContent = `${pool.records.length} 筆`;
  const list = $('record-list');

  if (!pool.records.length) {
    list.innerHTML = '<p class="empty-hint">此卡池尚無紀錄</p>';
    updateInsertPosSelect();
    return;
  }

  const ordered = orderedRecords(pool.records);
  list.innerHTML = ordered.map((r, i) => {
    const isFirst = i === 0;
    const isLast  = i === ordered.length - 1;
    return `
    <div class="record-item" data-id="${esc(r.id)}" draggable="true">
      <span class="ri-order">#${r.order}</span>
      <span class="ri-drag" title="拖曳排序（桌面）">⠿</span>
      <div class="ri-move-group">
        <button class="ri-move" data-dir="up"   data-id="${esc(r.id)}"
          ${isFirst ? 'disabled' : ''} title="上移">▲</button>
        <button class="ri-move" data-dir="down" data-id="${esc(r.id)}"
          ${isLast  ? 'disabled' : ''} title="下移">▼</button>
      </div>
      <span class="ri-name">⭐ ${esc(r.name)}${r.source === 'import' ? ' <span class="ri-source-icon" title="從遊戲匯入">📥</span>' : ''}</span>
      <span class="ri-pity">${r.pullCount} 抽</span>
      ${POOL_HAS_UP[state.activePool]
        ? `<span class="ri-tag ${r.isOff ? 'off' : 'up'}">${r.isOff ? '歪' : 'UP'}</span>`
        : ''}
      <button class="ri-edit" data-id="${esc(r.id)}" title="編輯">✏️</button>
      <button class="ri-del"  data-id="${esc(r.id)}" title="刪除">✕</button>
    </div>`;
  }).join('');

  // 編輯
  list.querySelectorAll('.ri-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  // 上 / 下移（觸控裝置友善）
  list.querySelectorAll('.ri-move').forEach(btn => {
    btn.addEventListener('click', () => moveRecord(btn.dataset.id, btn.dataset.dir));
  });

  // 刪除（含確認）
  list.querySelectorAll('.ri-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = state.pools[state.activePool].records.find(r => r.id === btn.dataset.id);
      const name = rec?.name || '此筆';
      openConfirm({
        title:   '確認刪除',
        message: `確定要刪除「${esc(name)}」#${rec?.order} 嗎？此動作無法復原。`,
        onOk:    () => {
          state.pools[state.activePool].records =
            state.pools[state.activePool].records.filter(r => r.id !== btn.dataset.id);
          migrateOrCompactOrders();
          recomputeAllGuaranteed();
          $('guaranteed').checked = state.pools[state.activePool].guaranteed;
          persistData();
          renderRecordList();
        }
      });
    });
  });

  // 拖曳排序
  list.querySelectorAll('.record-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragSrcId = item.dataset.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.record-item').forEach(i => i.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.record-item').forEach(i => i.classList.remove('drag-over'));
      if (item.dataset.id !== dragSrcId) item.classList.add('drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrcId || dragSrcId === item.dataset.id) return;
      const p     = state.pools[state.activePool];
      const items = orderedRecords(p.records);
      const srcIdx = items.findIndex(r => r.id === dragSrcId);
      const tgtIdx = items.findIndex(r => r.id === item.dataset.id);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const [moved] = items.splice(srcIdx, 1);
      items.splice(tgtIdx, 0, moved);
      items.forEach((r, i) => { r.order = i + 1; });
      dragSrcId = null;
      recomputeAllGuaranteed();
      $('guaranteed').checked = p.guaranteed;
      persistData();
      renderRecordList();
    });
  });

  updateInsertPosSelect();
}

// ── 視覺進度條渲染（統計頁） ─────────────────────────────────────────────────
function barColorClass(pullCount, limit) {
  const pct = pullCount / limit;
  if (pct <= 0.44) return 'bar-green';
  if (pct <= 0.67) return 'bar-yellow';
  if (pct <= 0.88) return 'bar-orange';
  return 'bar-red';
}

function renderBarItem(r, pool, opts = {}) {
  const { editable = false, isFirst = false, isLast = false, pickerState = '' } = opts;
  const limit  = POOL_LIMIT[pool];
  const pct    = Math.min(r.pullCount / limit * 100, 100).toFixed(1);
  const color  = barColorClass(r.pullCount, limit);
  const imgUrl = getImageUrl(r.name);
  const hasUp  = POOL_HAS_UP[pool];
  const tag    = hasUp
    ? `<span class="bar-tag ${r.isOff ? 'off' : 'up'}">${r.isOff ? '歪' : 'UP'}</span>`
    : '';
  const sub    = r.upBanner ? `歪自：${r.upBanner}` : '';

  const srcIcon = r.source === 'import'
    ? ' <span class="bar-source-icon" title="從遊戲匯入">📥</span>' : '';

  // ──────────────── Picker 模式：點擊選目標 ────────────────
  // pickerState = 'pickable' (可點選為目標) / 'moving' (被選中、要被移動) / 'dimmed' (其他池)
  if (pickerState) {
    return `
      <div class="bar-item ${r.isOff ? 'is-off' : ''} ${r.source === 'import' ? 'is-import' : ''} ${pickerState}"
           data-id="${esc(r.id)}" data-pool="${pool}">
        <div class="bar-order">#${r.order}</div>
        <div class="bar-thumb">
          ${imgUrl
            ? `<img src="${esc(imgUrl)}" alt="${esc(r.name)}" loading="lazy"
                 onerror="this.parentElement.textContent='${esc(r.name[0] || '?')}'">`
            : esc(r.name[0] || '?')}
        </div>
        <div class="bar-content">
          <div class="bar-name">${esc(r.name)}${srcIcon}</div>
          ${sub ? `<div class="bar-sub">${esc(sub)}</div>` : ''}
          <div class="bar-track">
            <div class="bar-fill ${color}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="bar-count">${r.pullCount} 抽</div>
        ${tag}
      </div>`;
  }

  // ──────────────── 編輯模式：拖曳 + 勾選 + 內嵌輸入 + 動作鈕 ────────────────
  if (editable) {
    const checked = statsSelectedIds.has(`${pool}:${r.id}`) ? 'checked' : '';
    return `
      <div class="bar-item editable ${r.isOff ? 'is-off' : ''} ${r.source === 'import' ? 'is-import' : ''}"
           draggable="true" data-id="${esc(r.id)}" data-pool="${pool}">
        <span class="bar-drag" title="拖曳排序">⠿</span>
        <input type="checkbox" class="bar-cb" data-id="${esc(r.id)}" data-pool="${pool}" ${checked} />
        <div class="bar-order">#${r.order}</div>
        <div class="bar-thumb">
          ${imgUrl
            ? `<img src="${esc(imgUrl)}" alt="${esc(r.name)}" loading="lazy"
                 onerror="this.parentElement.textContent='${esc(r.name[0] || '?')}'">`
            : esc(r.name[0] || '?')}
        </div>
        <div class="bar-content">
          <input type="text" class="bar-name-input" data-id="${esc(r.id)}" data-pool="${pool}"
                 value="${esc(r.name)}" placeholder="名稱" />
          ${sub ? `<div class="bar-sub">${esc(sub)}</div>` : ''}
          <div class="bar-track">
            <div class="bar-fill ${color}" style="width:${pct}%"></div>
          </div>
        </div>
        <input type="number" class="bar-pull-input" data-id="${esc(r.id)}" data-pool="${pool}"
               value="${r.pullCount}" min="1" max="90" title="抽數" />
        ${tag}
        <div class="bar-actions">
          <button class="bar-act-btn" data-act="up"   data-id="${esc(r.id)}" data-pool="${pool}"
            ${isFirst ? 'disabled' : ''} title="上移">▲</button>
          <button class="bar-act-btn" data-act="down" data-id="${esc(r.id)}" data-pool="${pool}"
            ${isLast  ? 'disabled' : ''} title="下移">▼</button>
          <button class="bar-act-btn" data-act="edit" data-id="${esc(r.id)}" data-pool="${pool}"
            title="開完整編輯（歪 / UP 池等）">✏️</button>
          <button class="bar-act-btn act-del" data-act="del" data-id="${esc(r.id)}" data-pool="${pool}"
            title="刪除">✕</button>
        </div>
      </div>`;
  }

  // ──────────────── 非編輯模式：純檢視 ────────────────
  return `
    <div class="bar-item ${r.isOff ? 'is-off' : ''} ${r.source === 'import' ? 'is-import' : ''}">
      <div class="bar-order">#${r.order}</div>
      <div class="bar-thumb">
        ${imgUrl
          ? `<img src="${esc(imgUrl)}" alt="${esc(r.name)}" loading="lazy"
               onerror="this.parentElement.textContent='${esc(r.name[0] || '?')}'">`
          : esc(r.name[0] || '?')}
      </div>
      <div class="bar-content">
        <div class="bar-name">${esc(r.name)}${srcIcon}</div>
        ${sub ? `<div class="bar-sub">${esc(sub)}</div>` : ''}
        <div class="bar-track">
          <div class="bar-fill ${color}" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="bar-count">${r.pullCount} 抽</div>
      ${tag}
    </div>`;
}

// 統計頁的「編輯模式」開關 — 開啟後每筆 bar item 出現編輯按鈕
let statsEditMode = false;
// 編輯模式下勾選的紀錄（key = `${pool}:${id}`）
const statsSelectedIds = new Set();
// 拖曳中的紀錄
let statsDragId = null;
let statsDragPool = null;
// 批量移動 picker 模式
let statsMovePickerActive = false;
let statsMovePickerPool   = null;

// ── 浮動 autocomplete（給統計頁 inline name input 用） ─────────────────────
function attachNameAutocomplete(input) {
  const pool = input.dataset.pool;
  const items = getAutoCompleteItems(pool);
  const list = $('floating-ac-list');
  let idx = -1;

  function show(matches) {
    list.innerHTML = matches
      .map(m => `<li data-value="${esc(m.value)}">${esc(m.display)}</li>`)
      .join('');
    const rect = input.getBoundingClientRect();
    list.style.left   = `${rect.left + window.scrollX}px`;
    list.style.top    = `${rect.bottom + window.scrollY + 2}px`;
    list.style.width  = `${rect.width}px`;
    list.style.display = '';
    idx = -1;
    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('mousedown', e => {
        e.preventDefault();   // 防止 input 立即失焦
        input.value = li.dataset.value;
        hide();
        // 用 rAF 等下一幀再 blur，確保 value 已套上
        requestAnimationFrame(() => input.blur());
      });
    });
  }
  function hide() {
    list.style.display = 'none';
    idx = -1;
  }
  function highlight() {
    list.querySelectorAll('li').forEach((li, i) =>
      li.classList.toggle('active', i === idx));
    if (idx >= 0) list.children[idx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { hide(); return; }
    const matches = fuzzySearch(q, items);
    if (matches.length) show(matches);
    else hide();
  });
  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q) {
      const matches = fuzzySearch(q, items);
      if (matches.length) show(matches);
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(hide, 150);   // 給 li mousedown 緩衝
  });
  input.addEventListener('keydown', e => {
    const lis = list.querySelectorAll('li');
    if (e.key === 'ArrowDown' && lis.length) {
      e.preventDefault();
      idx = (idx + 1) % lis.length;
      highlight();
    } else if (e.key === 'ArrowUp' && lis.length) {
      e.preventDefault();
      idx = (idx - 1 + lis.length) % lis.length;
      highlight();
    } else if (e.key === 'Enter' && idx >= 0 && lis[idx]) {
      e.preventDefault();
      input.value = lis[idx].dataset.value;
      hide();
      input.blur();
    }
  });
}

// ── 統計渲染 ──────────────────────────────────────────────────────────────────
function renderStats() {
  const hasAny = Object.values(state.pools).some(p => p.records.length > 0);
  $('stats-empty-hint').style.display = hasAny ? 'none' : '';
  $('stats-content').style.display    = hasAny ? '' : 'none';
  if (!hasAny) return;

  // 更新編輯模式 toggle 按鈕的視覺
  const editToggle = $('stats-edit-toggle');
  if (editToggle) {
    editToggle.textContent = statsEditMode ? '✓ 編輯模式（點此關閉）' : '✏️ 開啟編輯模式';
    editToggle.classList.toggle('active', statsEditMode);
  }
  // 批量操作 bar：只在編輯模式且未在 picker 模式時顯示
  const batchBar = $('stats-batch-bar');
  if (batchBar) batchBar.style.display = (statsEditMode && !statsMovePickerActive) ? 'flex' : 'none';
  // Picker banner：只在 picker 模式顯示
  const pickerBanner = $('stats-picker-banner');
  if (pickerBanner) {
    pickerBanner.style.display = statsMovePickerActive ? 'flex' : 'none';
    if (statsMovePickerActive) $('picker-count').textContent = statsSelectedIds.size;
  }

  renderPoolStats('character');
  renderPoolStats('light_cone');
  renderPoolStats('collab_char');
  renderPoolStats('collab_lc');
  renderPoolStats('standard');

  // ── 動作按鈕（▲▼ ✏️ ✕）────────────────────────────────────────────────────
  document.querySelectorAll('#tab-stats .bar-act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const act  = btn.dataset.act;
      const id   = btn.dataset.id;
      const pool = btn.dataset.pool;
      if (act === 'up' || act === 'down') {
        moveRecord(id, act, pool);
      } else if (act === 'edit') {
        openEditModal(id, pool);
      } else if (act === 'del') {
        deleteRecordFromStats(id, pool);
      }
    });
  });

  if (!statsEditMode) return;   // 以下功能只在編輯模式啟用

  // ── 內嵌名稱輸入 ───────────────────────────────────────────────────────────
  document.querySelectorAll('#tab-stats .bar-name-input').forEach(input => {
    let original = input.value;
    input.addEventListener('focus', () => { original = input.value; });
    input.addEventListener('keydown', e => {
      // 注意：autocomplete 也綁 keydown 處理 ArrowDown/Up/Enter
      // 這裡只處理 Escape（autocomplete 不處理）
      if (e.key === 'Escape') { input.value = original; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const newName = input.value.trim();
      const id   = input.dataset.id;
      const pool = input.dataset.pool;
      const rec  = state.pools[pool]?.records.find(r => r.id === id);
      if (!rec) return;
      if (!newName) { input.value = rec.name; return; }   // 空字串不允許
      if (newName === rec.name) return;                    // 沒變化
      rec.name = newName;
      persistData();
      renderRecordList();
      renderStats();   // 重 render 以更新圖片等
    });
    // 掛 autocomplete
    attachNameAutocomplete(input);
  });

  // ── 內嵌抽數輸入 ───────────────────────────────────────────────────────────
  document.querySelectorAll('#tab-stats .bar-pull-input').forEach(input => {
    let original = input.value;
    input.addEventListener('focus', () => { original = input.value; });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = original; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const v    = parseInt(input.value, 10);
      const id   = input.dataset.id;
      const pool = input.dataset.pool;
      const rec  = state.pools[pool]?.records.find(r => r.id === id);
      if (!rec) return;
      if (!Number.isFinite(v) || v < 1 || v > 90) { input.value = rec.pullCount; return; }
      if (v === rec.pullCount) return;
      rec.pullCount = v;
      persistData();
      renderRecordList();
      renderStats();   // 重 render 以更新進度條長度/顏色
    });
  });

  // ── checkbox 勾選 ─────────────────────────────────────────────────────────
  document.querySelectorAll('#tab-stats .bar-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = `${cb.dataset.pool}:${cb.dataset.id}`;
      if (cb.checked) statsSelectedIds.add(key);
      else statsSelectedIds.delete(key);
      updateBatchCount();
    });
  });
  updateBatchCount();

  // ── 拖曳排序 ──────────────────────────────────────────────────────────────
  document.querySelectorAll('#tab-stats .bar-item.editable').forEach(item => {
    item.addEventListener('dragstart', e => {
      statsDragId   = item.dataset.id;
      statsDragPool = item.dataset.pool;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('#tab-stats .bar-item').forEach(i =>
        i.classList.remove('drag-over'));
      statsDragId = null;
      statsDragPool = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 只在同一池內 highlight
      if (item.dataset.pool === statsDragPool && item.dataset.id !== statsDragId) {
        document.querySelectorAll('#tab-stats .bar-item').forEach(i =>
          i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!statsDragId) return;
      if (item.dataset.pool !== statsDragPool) return;   // 不允許跨池
      if (item.dataset.id === statsDragId) return;

      const pool = state.pools[item.dataset.pool];
      const ordered = orderedRecords(pool.records);
      const srcIdx = ordered.findIndex(r => r.id === statsDragId);
      const tgtIdx = ordered.findIndex(r => r.id === item.dataset.id);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const [moved] = ordered.splice(srcIdx, 1);
      ordered.splice(tgtIdx, 0, moved);
      ordered.forEach((r, i) => { r.order = i + 1; });

      recomputeAllGuaranteed();
      persistData();
      renderRecordList();
      renderStats();
    });
  });

  // ── Picker 模式：點 pickable bar 執行批量移動 ─────────────────────────────
  if (statsMovePickerActive) {
    document.querySelectorAll('#tab-stats .bar-item.pickable').forEach(item => {
      item.addEventListener('click', () => {
        executeBatchMove(item.dataset.pool, item.dataset.id);
      });
    });
  }
}

/** 更新批量操作 bar 的計數 + 按鈕 disabled 狀態 */
function updateBatchCount() {
  const count = statsSelectedIds.size;
  $('batch-count').textContent = count;
  $('batch-delete-btn').disabled = count === 0;
  $('batch-move-btn').disabled   = count === 0;
}

/** 把選中的紀錄一次性移動到指定目標的「之後」位置 */
function executeBatchMove(targetPool, targetId) {
  const pool = state.pools[targetPool];
  if (!pool) return;

  // 只取「目標池」內的選中 id
  const selectedIdsInPool = new Set(
    [...statsSelectedIds]
      .filter(k => k.startsWith(`${targetPool}:`))
      .map(k => k.split(':')[1])
  );
  if (!selectedIdsInPool.size) return;
  if (selectedIdsInPool.has(targetId)) return;   // 目標不能是自己

  const ordered   = orderedRecords(pool.records);
  const moving    = ordered.filter(r => selectedIdsInPool.has(r.id));
  const remainder = ordered.filter(r => !selectedIdsInPool.has(r.id));

  const targetIdx = remainder.findIndex(r => r.id === targetId);
  if (targetIdx < 0) return;

  // 在 remainder 中目標之後插入 moving 整批
  const merged = [
    ...remainder.slice(0, targetIdx + 1),
    ...moving,                                // 保留 moving 內部相對順序
    ...remainder.slice(targetIdx + 1),
  ];
  merged.forEach((r, i) => { r.order = i + 1; });

  // 清狀態、退出 picker 模式
  statsMovePickerActive = false;
  statsMovePickerPool   = null;
  statsSelectedIds.clear();

  recomputeAllGuaranteed();
  persistData();
  renderRecordList();
  renderStats();
}

function renderPoolStats(pool) {
  const p       = state.pools[pool];
  const records = p.records;
  const limit   = POOL_LIMIT[pool];
  const hasUp   = POOL_HAS_UP[pool];

  const totalPulls = records.reduce((s, r) => s + r.pullCount, 0) + p.pity;
  const fiveCount  = records.length;
  const avgPity    = fiveCount
    ? (records.reduce((s, r) => s + r.pullCount, 0) / fiveCount).toFixed(1) : '—';
  const upRecs     = records.filter(r => !r.isOff);
  const avgUpPity  = (hasUp && upRecs.length)
    ? (upRecs.reduce((s, r) => s + r.pullCount, 0) / upRecs.length).toFixed(1) : '—';
  const offRate    = (hasUp && fiveCount)
    ? `${(records.filter(r => r.isOff).length / fiveCount * 100).toFixed(0)}%` : '—';

  const cells = hasUp
    ? [
        { num: totalPulls, lbl: '總抽數' },
        { num: fiveCount,  lbl: '出金次數' },
        { num: avgPity,    lbl: '平均出金抽數' },
        { num: avgUpPity,  lbl: '平均 UP 抽數' },
        { num: offRate,    lbl: '歪率' },
        { num: p.pity,     lbl: '目前保底進度' },
      ]
    : [
        { num: totalPulls, lbl: '總抽數' },
        { num: fiveCount,  lbl: '出金次數' },
        { num: avgPity,    lbl: '平均出金抽數' },
        { num: p.pity,     lbl: '目前保底進度' },
      ];

  $(`sg-${pool}`).innerHTML = cells.map(c =>
    `<div class="stat-cell">
       <div class="stat-num">${c.num}</div>
       <div class="stat-lbl">${c.lbl}</div>
     </div>`
  ).join('');

  // 保底進度條
  const pct = Math.min(p.pity / limit * 100, 100).toFixed(1);
  $(`stat-pity-bar-${pool}`).style.width = pct + '%';
  $(`stat-pity-label-${pool}`).textContent = `${p.pity} / ${limit}`;
  const gl = $(`stat-guaranteed-label-${pool}`);
  if (gl) gl.textContent = (hasUp && p.guaranteed) ? '✅ 大保底觸發中' : '';

  // 視覺進度條列表
  const wrap = $(`records-table-${pool}`);
  if (!records.length) { wrap.innerHTML = '<p class="empty-hint">無紀錄</p>'; return; }

  const pityHtml = `
    <div class="bar-pity-now">
      <div class="bar-thumb">？</div>
      已墊 <strong>${p.pity}</strong> 抽（目前保底）
    </div>`;

  const ordered = orderedRecords(records);
  const barsHtml = ordered.map((r, i) => {
    let pickerState = '';
    if (statsMovePickerActive) {
      const key = `${pool}:${r.id}`;
      if (statsSelectedIds.has(key)) pickerState = 'moving';
      else if (pool === statsMovePickerPool) pickerState = 'pickable';
      else pickerState = 'dimmed';
    }
    return renderBarItem(r, pool, {
      editable: statsEditMode && !statsMovePickerActive,   // picker 中暫停 editable UI
      isFirst:  i === 0,
      isLast:   i === ordered.length - 1,
      pickerState,
    });
  }).join('');
  wrap.innerHTML = pityHtml + barsHtml;
}

// ── 上下移動（觸控友善的排序替代方案） ───────────────────────────────────────
function moveRecord(id, dir, poolName = state.activePool) {
  const pool  = state.pools[poolName];
  if (!pool) return;
  const items = orderedRecords(pool.records);
  const idx   = items.findIndex(r => r.id === id);
  if (idx < 0) return;
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return;
  // 交換 order
  const o1 = items[idx].order;
  const o2 = items[swapWith].order;
  items[idx].order      = o2;
  items[swapWith].order = o1;
  recomputeAllGuaranteed();
  if (poolName === state.activePool) {
    $('guaranteed').checked = pool.guaranteed;
  }
  persistData();
  renderRecordList();
  if (document.querySelector('.tab[data-tab="stats"]')?.classList.contains('active')) {
    renderStats();
  }
}

// 從統計頁刪除紀錄（含確認）
function deleteRecordFromStats(id, poolName) {
  const pool = state.pools[poolName];
  if (!pool) return;
  const rec = pool.records.find(r => r.id === id);
  if (!rec) return;
  openConfirm({
    title:   '確認刪除',
    message: `確定要刪除「${esc(rec.name)}」#${rec.order}（${poolName}）嗎？此動作無法復原。`,
    onOk:    () => {
      pool.records = pool.records.filter(r => r.id !== id);
      migrateOrCompactOrders();
      recomputeAllGuaranteed();
      if (poolName === state.activePool) {
        $('guaranteed').checked = pool.guaranteed;
      }
      persistData();
      renderRecordList();
      renderStats();
    },
  });
}

// ── 通用 Confirm 對話框 ──────────────────────────────────────────────────────
let confirmOkCallback = null;
let confirmCancelCallback = null;
function openConfirm({
  title = '確認',
  message = '',
  okText = '確認',
  cancelText = '取消',
  onOk,
  onCancel,
}) {
  $('confirm-title').textContent   = title;
  $('confirm-message').innerHTML   = message;   // 允許簡單 HTML（已 esc）
  $('confirm-ok').textContent      = okText;
  $('confirm-cancel').textContent  = cancelText;
  confirmOkCallback     = onOk;
  confirmCancelCallback = onCancel;
  $('confirm-modal').style.display = '';
}
function closeConfirm(triggerCancel = true) {
  const cancelCb = confirmCancelCallback;
  confirmOkCallback = null;
  confirmCancelCallback = null;
  $('confirm-modal').style.display = 'none';
  if (triggerCancel && cancelCb) cancelCb();
}
$('confirm-cancel').addEventListener('click', () => closeConfirm(true));
$('confirm-ok').addEventListener('click', () => {
  const cb = confirmOkCallback;
  closeConfirm(false);   // OK 路徑不觸發 onCancel
  cb?.();
});
$('confirm-modal').addEventListener('click', e => {
  if (e.target === $('confirm-modal')) closeConfirm(true);
});

// ── JSON 備份：匯出 ──────────────────────────────────────────────────────────
$('export-btn').addEventListener('click', () => {
  const payload = {
    version:    1,
    exportedAt: new Date().toISOString(),
    pools:      state.pools,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `starrail-tracker-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── JSON 備份：匯入 ──────────────────────────────────────────────────────────
$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data?.pools || typeof data.pools !== 'object') {
        throw new Error('檔案格式不正確（缺少 pools 欄位）');
      }
      // 驗證已有池子（缺池會在 migrate 時自動補）
      ['character', 'light_cone', 'standard'].forEach(p => {
        if (!data.pools[p] || !Array.isArray(data.pools[p].records)) {
          throw new Error(`缺少卡池：${p}`);
        }
      });
      const totalRecs = Object.values(data.pools).reduce((s, p) => s + p.records.length, 0);
      openConfirm({
        title: '確認匯入備份',
        message:
          `將以備份檔覆蓋目前的資料：<br>` +
          `&nbsp;&nbsp;• 紀錄共 <strong>${totalRecs}</strong> 筆<br>` +
          `&nbsp;&nbsp;• 備份時間：${data.exportedAt || '未知'}<br><br>` +
          `<span style="color:var(--red)">⚠ 目前資料會被取代！建議先匯出當前資料備份。</span>`,
        onOk: () => {
          state.pools = data.pools;
          migrateOrCompactOrders();
          recomputeAllGuaranteed();
          persistData();
          renderAll();
        },
      });
    } catch (err) {
      openConfirm({
        title: '匯入失敗',
        message: `無法解析備份檔：${esc(err.message)}`,
        onOk: () => {},
      });
    } finally {
      $('import-file').value = '';   // 允許再選同一檔
    }
  };
  reader.readAsText(file);
});

// ── 複製 PowerShell 腳本到剪貼簿 ────────────────────────────────────────────
$('copy-script-btn')?.addEventListener('click', async () => {
  const btn = $('copy-script-btn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 載入中…';
  try {
    const resp = await fetch('get_authkey.ps1');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    await navigator.clipboard.writeText(text);
    btn.textContent = '✅ 已複製，請貼到記事本另存為 .ps1';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  } catch (err) {
    btn.textContent = `❌ 複製失敗：${err.message}`;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
});

// ── 匯入抽卡紀錄（連線 Flask 後端） ─────────────────────────────────────────
let importPreviewData = null;   // 後端回傳的 raw 預覽資料
let importPreviewSource = 'authkey';   // 'authkey' | 'file' — 決定 confirm 時的插入模式

const importBackend = $('import-backend');
const importUrl     = $('import-url');
const importStatus  = $('import-status');

/**
 * 預設後端位址：本機開發走 localhost，線上版走部署 URL。
 * 用 location.hostname 判斷，使用者完全不用設定。
 * 部署完後，把下方的 PRODUCTION_BACKEND 換成你的 Render URL。
 */
const PRODUCTION_BACKEND = 'https://starrail-tracker-backend.onrender.com';  // ← 部署後改這行
function getDefaultBackend() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    return 'http://localhost:5000';
  }
  return PRODUCTION_BACKEND;
}

function setImportStatus(type, msg) {
  importStatus.style.display = msg ? '' : 'none';
  importStatus.className = `import-status ${type}`;
  importStatus.textContent = msg;
}

// ── 檔案匯入（CSV / Excel） ─────────────────────────────────────────────────
const PAPAPARSE_CDN = 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js';
const XLSX_CDN      = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const FIELD_MAP_IDS = ['map-name', 'map-pull', 'map-isoff', 'map-upbanner', 'map-time', 'map-pool'];

let fileParsedRows = null;
let parsedWorkbook = null;   // XLSX workbook 物件（保留以便切換分頁時用）
let fileParsedHeaders = [];

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`載入失敗：${src}`));
    document.head.appendChild(s);
  });
}

function setFileStatus(type, msg) {
  const bar = $('import-file-status');
  bar.style.display = msg ? '' : 'none';
  bar.className = `import-status ${type}`;
  bar.textContent = msg;
}

/** 把各種真假值正規化成 boolean。空白 = false。 */
function parseIsOffValue(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (['true', '1', '是', '歪', 'yes', 'y', 'off', 'lose'].includes(s)) return true;
  if (['false', '0', '否', '未歪', '沒歪', 'no', 'n', 'up', 'win'].includes(s)) return false;
  return true;   // 有非空值且不在已知 false 列表 → 視為 true
}

/** 把使用者填的「卡池」欄位值對應到內部 pool key。 */
function parsePoolValue(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const map = {
    'character': 'character', '11': 'character',
    '角色': 'character', '角色活動': 'character', '角色池': 'character', '角色活動池': 'character',
    'light_cone': 'light_cone', 'lightcone': 'light_cone', 'weapon': 'light_cone', '12': 'light_cone',
    '光錐': 'light_cone', '光錐池': 'light_cone', '光錐活動池': 'light_cone',
    'standard': 'standard', '1': 'standard',
    '常駐': 'standard', '常駐池': 'standard',
    'collab_char': 'collab_char', '聯動角色': 'collab_char', '聯動角色池': 'collab_char',
    'collab_lc': 'collab_lc', '聯動光錐': 'collab_lc', '聯動光錐池': 'collab_lc',
  };
  return map[s] || null;
}

function autoMapField(selectId, headers, keywords) {
  const found = headers.find(h =>
    keywords.some(k => h && h.toString().toLowerCase().includes(k.toLowerCase()))
  );
  if (found) $(selectId).value = found;
}

function fillMappingDropdowns(headers) {
  const optionHtml = '<option value="">— 不對應 —</option>' +
    headers.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('');
  FIELD_MAP_IDS.forEach(id => { $(id).innerHTML = optionHtml; });

  autoMapField('map-name',     headers, ['名稱', 'name', '角色', '光錐', '物品', 'item']);
  autoMapField('map-pull',     headers, ['抽數', 'pullcount', 'pull_count', 'count', 'pity']);
  autoMapField('map-isoff',    headers, ['歪', 'isoff', 'is_off', 'off']);
  autoMapField('map-upbanner', headers, ['歪自', 'upbanner', 'up_banner', '當期', 'up角色']);
  autoMapField('map-time',     headers, ['時間', 'time', 'date', 'timestamp', '日期']);
  autoMapField('map-pool',     headers, ['卡池', 'pool', 'gacha_type', 'banner']);
}

async function onFileChosen(file) {
  setFileStatus('loading', '⏳ 解析檔案中…');
  $('import-file-mapping').style.display = 'none';
  fileParsedRows = null;
  fileParsedHeaders = [];

  const ext = file.name.toLowerCase().split('.').pop();
  try {
    if (ext === 'csv') {
      await loadScriptOnce(PAPAPARSE_CDN);
      const text = await file.text();
      const result = window.Papa.parse(text, { header: true, skipEmptyLines: true });
      if (result.errors?.length) console.warn('[CSV] parse warnings', result.errors);
      fileParsedRows = result.data;
      fileParsedHeaders = result.meta.fields || [];
    } else if (ext === 'xlsx' || ext === 'xls') {
      await loadScriptOnce(XLSX_CDN);
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      fileParsedRows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
      fileParsedHeaders = fileParsedRows.length
        ? Object.keys(fileParsedRows[0])
        : [];
    } else {
      throw new Error('不支援的檔案格式（請選 .csv / .xlsx / .xls）');
    }

    if (!fileParsedRows?.length) throw new Error('檔案內容為空');

    fillMappingDropdowns(fileParsedHeaders);
    $('import-file-rowcount').textContent =
      `共讀到 ${fileParsedRows.length} 列、${fileParsedHeaders.length} 個欄位。請對應下列欄位後按「預覽匯入紀錄」。`;
    $('import-file-mapping').style.display = '';
    setFileStatus('success', `✅ 已讀取 ${file.name}`);
  } catch (err) {
    setFileStatus('error', `❌ ${err.message || err}`);
  }
}

$('import-file-input').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  onFileChosen(file);
});

$('import-file-preview-btn').addEventListener('click', async () => {
  if (!fileParsedRows?.length) {
    setFileStatus('error', '⚠ 還沒選檔案');
    return;
  }
  const mapName     = $('map-name').value;
  const mapPull     = $('map-pull').value;
  const mapIsOff    = $('map-isoff').value;
  const mapUpBanner = $('map-upbanner').value;
  const mapTime     = $('map-time').value;
  const mapPool     = $('map-pool').value;
  const defaultPool = $('default-pool').value;

  if (!mapName || !mapPull) {
    setFileStatus('error', '⚠ 必填欄位「名稱」與「抽數」尚未對應');
    return;
  }

  const grouped = Object.fromEntries(Object.keys(POOL_LIMIT).map(p => [p, []]));
  let skipped = 0;

  fileParsedRows.forEach(row => {
    const name = String(row[mapName] ?? '').trim();
    const pull = parseInt(row[mapPull], 10);
    if (!name || !pull || pull < 1) { skipped++; return; }

    const poolRaw = mapPool ? parsePoolValue(row[mapPool]) : null;
    const pool = poolRaw || defaultPool;
    if (!grouped[pool]) { skipped++; return; }

    const isOff   = mapIsOff    ? parseIsOffValue(row[mapIsOff]) : false;
    const upBann  = mapUpBanner ? (String(row[mapUpBanner] ?? '').trim() || null) : null;
    const tsRaw   = mapTime     ? String(row[mapTime] ?? '').trim() : '';

    grouped[pool].push({
      name,
      pullCount: pull,
      isOff,
      upBanner: upBann,
      timestamp: tsRaw,
      gachaId: null,     // 檔案匯入無 gachaId，只能靠 fingerprint 去重
      source: 'import',
    });
  });

  const total = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);
  if (!total) {
    setFileStatus('error', '⚠ 沒有任何有效紀錄可匯入（檢查欄位對應）');
    return;
  }

  importPreviewData = grouped;
  importPreviewSource = 'file';   // 標記為檔案來源，confirm 時用 file-insert-pos

  if (window._bannerMissLog) window._bannerMissLog.clear();

  setFileStatus('success',
    `✅ 已轉換 ${total} 筆紀錄${skipped ? `（跳過 ${skipped} 筆無效列）` : ''}。請至下方預覽勾選。`);
  renderImportPreview();
  // 滾到預覽區
  $('import-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const missCount = window._bannerMissLog?.size || 0;
  if (missCount > 0) {
    console.warn(
      `[歪判定] 有 ${missCount} 筆紀錄的時間沒對應到 banner（在 console 跑 [...window._bannerMissLog] 看清單）`
    );
  }
});

$('import-fetch-btn').addEventListener('click', async () => {
  const backend = (importBackend.value || getDefaultBackend()).trim().replace(/\/$/, '');
  const url     = importUrl.value.trim();

  if (!url || !url.includes('authkey=')) {
    setImportStatus('error', '⚠ 請貼上完整抽卡網址（要含 authkey 參數）');
    importUrl.focus();
    return;
  }

  setImportStatus('loading', '⏳ 連線後端中…匯入需 30–90 秒（要分頁拉 6 個月歷史）');
  $('import-preview').style.display = 'none';
  importPreviewData = null;

  try {
    const resp = await fetch(`${backend}/api/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText} ${txt.slice(0, 100)}`);
    }
    const data = await resp.json();

    if (data.error) throw new Error(data.error);

    importPreviewData = data.records || {};
    importPreviewSource = 'authkey';   // 標記來源（authkey 走 timestamp 排序）

    const totals = Object.entries(importPreviewData)
      .map(([p, arr]) => `${p}:${arr.length}`).join('  ');
    const errMsg = data.errors?.length
      ? `（部分卡池有錯：${data.errors.map(e => `${e.pool}=${e.error}`).join('; ')}）`
      : '';

    // banner 資料已靜態烘進 banner_history.js（1.0–4.1 完整），不必等遠端
    if (window._bannerMissLog) window._bannerMissLog.clear();

    setImportStatus('success', `✅ 抓取完成。${totals}${errMsg}`);
    renderImportPreview();

    // 若有大量找不到 banner，提醒使用者
    const missCount = window._bannerMissLog?.size || 0;
    if (missCount > 0) {
      console.warn(
        `[歪判定] 有 ${missCount} 筆紀錄的時間沒對應到 banner（在 console 跑 [...window._bannerMissLog] 看清單）。` +
        `可能原因：後端 sleep / banner_chars.js 該版本沒收 / banner 日期不在範圍。`
      );
    }
  } catch (err) {
    let msg = err.message || String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      msg = '無法連線後端伺服器，請稍後再試。(如果是第一次嘗試，建議30秒後再試一次)';
    }
    setImportStatus('error', `❌ ${msg}`);
  }
});

function renderImportPreview() {
  if (!importPreviewData) return;

  const poolMeta = {
    character:   { label: '角色活動池', cls: 'character-header' },
    light_cone:  { label: '光錐活動池', cls: 'lc-header' },
    collab_char: { label: '聯動角色池', cls: 'collab-char-header' },
    collab_lc:   { label: '聯動光錐池', cls: 'collab-lc-header' },
    standard:    { label: '常駐池',     cls: 'std-header' },
  };

  let html = '';
  Object.keys(poolMeta).forEach(pool => {
    const items = importPreviewData[pool] || [];
    if (!items.length) return;

    // 既有紀錄的 dedup 索引
    const existingRecs = state.pools[pool]?.records || [];
    const existingGachaIds = new Set(existingRecs.map(r => r.gachaId).filter(Boolean));
    const existingFps = new Set(existingRecs.map(r => fingerprint(r)));

    html += `<div class="import-pool-section">
      <div class="import-pool-title ${poolMeta[pool].cls}">
        ${poolMeta[pool].label}（${items.length} 筆五星）
      </div>`;

    items.forEach((r, i) => {
      // 用 banner history 重新判定 isOff（後端只認常駐角色為歪，不夠精準）
      const entryType = getEntryType(r.name);
      r.isOff = isPullOffBanner(pool, r.name, r.timestamp, entryType);

      // dedup：先看 gachaId（最精準），再看 fingerprint（name + pullCount + timestamp）
      const isDupById = r.gachaId && existingGachaIds.has(r.gachaId);
      const isDupByFp = existingFps.has(fingerprint(r));
      const isDup = isDupById || isDupByFp;

      const statusTag = isDup
        ? '<span class="imp-dup-tag">已存在</span>'
        : '<span class="imp-new-tag">新紀錄</span>';

      html += `
        <label class="import-item ${isDup ? 'dup' : ''}">
          <input type="checkbox" class="imp-cb" data-pool="${pool}" data-idx="${i}"
                 ${isDup ? '' : 'checked'} />
          <span class="imp-name">⭐ ${esc(r.name)}</span>
          ${r.isOff ? '<span class="imp-off-tag">歪</span>' : ''}
          <span class="imp-pity">${r.pullCount} 抽</span>
          <span class="imp-date">${esc(r.timestamp || '')}</span>
          ${statusTag}
        </label>`;
    });
    html += '</div>';
  });

  if (!html) {
    html = '<p class="empty-hint">此次抓取沒有五星紀錄</p>';
  }

  $('import-preview-list').innerHTML = html;
  $('import-preview').style.display = '';

  $('import-preview-list').querySelectorAll('.imp-cb').forEach(cb => {
    cb.addEventListener('change', updateImportSelectedCount);
  });
  updateImportSelectedCount();
}

function updateImportSelectedCount() {
  const all     = $('import-preview-list').querySelectorAll('.imp-cb');
  const checked = $('import-preview-list').querySelectorAll('.imp-cb:checked');
  $('import-selected-count').textContent = `已勾選 ${checked.length} / ${all.length} 筆`;
}

$('import-select-all').addEventListener('click', () => {
  $('import-preview-list').querySelectorAll('.imp-cb').forEach(cb => cb.checked = true);
  updateImportSelectedCount();
});
$('import-select-none').addEventListener('click', () => {
  $('import-preview-list').querySelectorAll('.imp-cb').forEach(cb => cb.checked = false);
  updateImportSelectedCount();
});

$('import-confirm-btn').addEventListener('click', () => {
  if (!importPreviewData) return;

  // 收集勾選的（依 POOL_LIMIT 動態建立，避免新增池後再漏改）
  const selected = Object.fromEntries(
    Object.keys(POOL_LIMIT).map(p => [p, []])
  );
  $('import-preview-list').querySelectorAll('.imp-cb:checked').forEach(cb => {
    const pool = cb.dataset.pool;
    const idx  = parseInt(cb.dataset.idx);
    if (importPreviewData[pool]?.[idx]) selected[pool].push(importPreviewData[pool][idx]);
  });

  const total = Object.values(selected).reduce((s, arr) => s + arr.length, 0);
  if (!total) {
    setImportStatus('error', '⚠ 未勾選任何紀錄');
    return;
  }

  // 決定插入模式：兩種來源都讀各自的 select
  // authkey 預設 'top'（保留現有紀錄順序、不全池重排）
  // file 預設 'bottom'（Excel 多半是舊紀錄）
  const insertMode = importPreviewSource === 'file'
    ? ($('file-insert-pos')?.value || 'bottom')
    : ($('authkey-insert-pos')?.value || 'top');

  const modeLabel = {
    top:       '插入到最上方（最新）',
    bottom:    '插入到最下方（最舊）',
    timestamp: '依時間戳記與現有紀錄混排',
  }[insertMode] || insertMode;

  openConfirm({
    title: '確認匯入',
    message:
      `將匯入 <strong>${total}</strong> 筆五星紀錄。<br>` +
      `插入方式：<strong>${modeLabel}</strong><br>` +
      `匯入紀錄會以 <strong>📥</strong> 標記。<br>` +
      `<span style="color:var(--muted)">已存在的（gachaId 或同 name+pullCount+timestamp）會自動跳過。手動紀錄內容不會被修改。</span>`,
    onOk: () => {
      let added = 0;
      Object.keys(selected).forEach(pool => {
        added += mergeImportedRecords(pool, selected[pool], insertMode);
      });
      recomputeAllGuaranteed();
      persistData();

      importPreviewData = null;
      importPreviewSource = 'authkey';   // 重置回預設
      $('import-preview').style.display = 'none';
      setImportStatus('success', `✅ 已匯入 ${added} 筆新紀錄`);

      renderAll();
    },
  });
});

/**
 * 把後端回傳的匯入紀錄合併進指定卡池。
 * 規則：
 *   - 跳過 gachaId 已存在的（防重複匯入）
 *   - 新紀錄按 timestamp DESC 排序，放在 #1..#N
 *   - 既有紀錄 order 全體 += 新增筆數，相對順序不變（不修改手動內容）
 * @returns 實際新增筆數
 */
/**
 * 把 timestamp 字串轉成毫秒（用於排序）。
 * 兼容 ISO 8601（手動紀錄）與 HoYoLAB 'YYYY-MM-DD HH:MM:SS'（匯入紀錄）。
 * 失敗回 0。
 */
function parseTimestamp(ts) {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * 把匯入紀錄合併進指定卡池。
 *
 * @param {string} poolName
 * @param {Array}  importedItems
 * @param {'timestamp'|'top'|'bottom'} insertMode
 *   - 'timestamp'：全池依 timestamp 重排（適合 authkey 匯入，每筆有真實時間）
 *   - 'top'      ：新匯入塞最上方 #1..#N（適合最新資料的批次匯入）
 *   - 'bottom'   ：新匯入塞最下方（適合 Excel/CSV 補登的舊紀錄）
 */
function mergeImportedRecords(poolName, importedItems, insertMode = 'timestamp') {
  const pool = state.pools[poolName];

  // 重複偵測：gachaId（精準）+ fingerprint（手動紀錄沒 gachaId 時的 fallback）
  const existingIds = new Set(pool.records.map(r => r.gachaId).filter(Boolean));
  const existingFps = new Set(pool.records.map(r => fingerprint(r)));

  const fresh = importedItems.filter(r => {
    const dupId = r.gachaId && existingIds.has(r.gachaId);
    const dupFp = existingFps.has(fingerprint(r));
    return !(dupId || dupFp);
  });
  if (!fresh.length) return 0;

  // 建立新紀錄物件
  // ⚠ timestamp 不要 fallback 到 new Date()，否則 Excel 沒對應時間欄的紀錄會被
  //   填上「現在」→ 之後 timestamp 排序時被當最新 → 跑到最上方。
  //   保留空字串 → parseTimestamp 回 0 → 自然落到最下方（符合 Excel 補登舊紀錄的期待）。
  const newRecs = fresh.map(r => ({
    id:        newId(),
    name:      r.name,
    pullCount: r.pullCount,
    isOff:     !!r.isOff,
    upBanner:  r.upBanner || null,
    timestamp: r.timestamp || '',
    gachaId:   r.gachaId || null,
    source:    'import',
  }));

  if (insertMode === 'top') {
    // 新紀錄之間先依 timestamp 由新到舊排
    newRecs.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
    // 既有紀錄整體下移
    pool.records.forEach(r => { r.order = (r.order || 0) + newRecs.length; });
    // 新紀錄佔 #1..#N
    newRecs.forEach((r, i) => { r.order = i + 1; });
    pool.records.push(...newRecs);
  } else if (insertMode === 'bottom') {
    // 新紀錄之間先依 timestamp 由新到舊排（同 timestamp 維持原順序）
    newRecs.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
    // 排到最下方
    const baseOrder = pool.records.length;
    newRecs.forEach((r, i) => { r.order = baseOrder + i + 1; });
    pool.records.push(...newRecs);
  } else {
    // 'timestamp' — 全池依 timestamp 重排
    pool.records.push(...newRecs);
    pool.records.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
    pool.records.forEach((r, i) => { r.order = i + 1; });
  }

  return fresh.length;
}

// ── 全部渲染 ──────────────────────────────────────────────────────────────────
function renderAll() {
  syncInputFromPool();
  renderRecordList();
  if (document.querySelector('.tab[data-tab="stats"]')?.classList.contains('active')) {
    renderStats();
  }
}
