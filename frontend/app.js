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
      } catch (err) {
        // err 來自 firebase.js classifyFirebaseError
        showSync('error', err?.message || '未知錯誤');
      }
    }, 1200);
  } else {
    showSync('local');
  }
}

async function loadData() {
  if (state.user) {
    try {
      const cloud = await loadFromCloud(state.user.uid);
      if (cloud?.pools) {
        state.pools = cloud.pools;
        migrateOrCompactOrders();
        return;
      }
    } catch (err) {
      showSync('error', `讀取雲端失敗：${err?.message || err}`);
      // 繼續嘗試 local
    }
  }
  const local = loadLocal();
  if (local?.pools) {
    state.pools = local.pools;
    migrateOrCompactOrders();
  }
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

// ── Firebase 驗證 ─────────────────────────────────────────────────────────────
initFirebase();

onAuthChange(async user => {
  state.user = user;
  await loadData();
  renderAll();

  if (user) {
    $('auth-loading').style.display = 'none';
    $('auth-signed-out').style.display = 'none';
    $('auth-signed-in').style.display  = '';
    $('auth-avatar').src = user.photoURL || '';
    $('auth-name').textContent = user.displayName || user.email;
    showSync('saved');
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
function openEditModal(recordId) {
  const pool = state.pools[state.activePool];
  const rec  = pool.records.find(r => r.id === recordId);
  if (!rec) return;

  state.editingId = recordId;
  $('edit-modal-order').textContent = `#${rec.order}`;
  editNameInput.value = rec.name;
  editNameInput.style.borderColor = '';
  $('edit-pull-count-input').value = rec.pullCount;
  $('edit-pull-count-input').style.borderColor = '';

  const showOff = POOL_HAS_UP[state.activePool];
  $('edit-is-off-row').style.display = showOff ? '' : 'none';
  $('edit-is-off').checked = !!rec.isOff;
  $('edit-up-banner-row').style.display = (showOff && rec.isOff) ? '' : 'none';
  editUpInput.value = rec.upBanner || '';

  $('edit-modal').style.display = '';
}

function closeEditModal() {
  state.editingId = null;
  $('edit-modal').style.display = 'none';
}

function saveEdit() {
  const id = state.editingId;
  if (!id) return;

  const pool = state.pools[state.activePool];
  const rec  = pool.records.find(r => r.id === id);
  if (!rec) { closeEditModal(); return; }

  const name      = editNameInput.value.trim();
  const pullCount = parseInt($('edit-pull-count-input').value);
  const isOff     = POOL_HAS_UP[state.activePool] ? $('edit-is-off').checked : false;
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
  $('guaranteed').checked = pool.guaranteed;

  closeEditModal();
  persistData();
  renderRecordList();
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

function renderBarItem(r, pool) {
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

// ── 統計渲染 ──────────────────────────────────────────────────────────────────
function renderStats() {
  const hasAny = Object.values(state.pools).some(p => p.records.length > 0);
  $('stats-empty-hint').style.display = hasAny ? 'none' : '';
  $('stats-content').style.display    = hasAny ? '' : 'none';
  if (!hasAny) return;
  renderPoolStats('character');
  renderPoolStats('light_cone');
  renderPoolStats('collab_char');
  renderPoolStats('collab_lc');
  renderPoolStats('standard');
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

  const barsHtml = orderedRecords(records).map(r => renderBarItem(r, pool)).join('');
  wrap.innerHTML = pityHtml + barsHtml;
}

// ── 上下移動（觸控友善的排序替代方案） ───────────────────────────────────────
function moveRecord(id, dir) {
  const pool  = state.pools[state.activePool];
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
  $('guaranteed').checked = pool.guaranteed;
  persistData();
  renderRecordList();
}

// ── 通用 Confirm 對話框 ──────────────────────────────────────────────────────
let confirmCallback = null;
function openConfirm({ title = '確認', message = '', onOk }) {
  $('confirm-title').textContent   = title;
  $('confirm-message').innerHTML   = message;   // 允許簡單 HTML（已 esc）
  confirmCallback = onOk;
  $('confirm-modal').style.display = '';
}
function closeConfirm() {
  confirmCallback = null;
  $('confirm-modal').style.display = 'none';
}
$('confirm-cancel').addEventListener('click', closeConfirm);
$('confirm-ok').addEventListener('click', () => {
  const cb = confirmCallback;
  closeConfirm();
  cb?.();
});
$('confirm-modal').addEventListener('click', e => {
  if (e.target === $('confirm-modal')) closeConfirm();
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

$('import-fetch-btn').addEventListener('click', async () => {
  const backend = (importBackend.value || getDefaultBackend()).trim().replace(/\/$/, '');
  const url     = importUrl.value.trim();

  if (!url || !url.includes('authkey=')) {
    setImportStatus('error', '⚠ 請貼上完整抽卡網址（要含 authkey 參數）');
    importUrl.focus();
    return;
  }

  setImportStatus('loading', '⏳ 連線後端中…首次匯入需 10–60 秒（要分頁拉 6 個月歷史）');
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

    const totals = Object.entries(importPreviewData)
      .map(([p, arr]) => `${p}:${arr.length}`).join('  ');
    const errMsg = data.errors?.length
      ? `（部分卡池有錯：${data.errors.map(e => `${e.pool}=${e.error}`).join('; ')}）`
      : '';

    setImportStatus('success', `✅ 抓取完成。${totals}${errMsg}`);
    renderImportPreview();
  } catch (err) {
    let msg = err.message || String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      msg = '無法連線後端伺服器，請稍後再試。';
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
    const existing = new Set(
      (state.pools[pool]?.records || [])
        .map(r => r.gachaId).filter(Boolean));

    html += `<div class="import-pool-section">
      <div class="import-pool-title ${poolMeta[pool].cls}">
        ${poolMeta[pool].label}（${items.length} 筆五星）
      </div>`;

    items.forEach((r, i) => {
      const isDup = r.gachaId && existing.has(r.gachaId);
      html += `
        <label class="import-item ${isDup ? 'dup' : ''}">
          <input type="checkbox" class="imp-cb" data-pool="${pool}" data-idx="${i}"
                 ${isDup ? '' : 'checked'} />
          <span class="imp-name">⭐ ${esc(r.name)}</span>
          ${r.isOff ? '<span class="imp-off-tag">歪</span>' : ''}
          <span class="imp-pity">${r.pullCount} 抽</span>
          <span class="imp-date">${esc(r.timestamp || '')}</span>
          ${isDup ? '<span class="imp-dup-tag">已匯入過</span>' : ''}
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

  openConfirm({
    title: '確認匯入',
    message:
      `將匯入 <strong>${total}</strong> 筆五星紀錄。<br>` +
      `匯入紀錄會以 <strong>📥</strong> 標記，置於最上方並依時間排序。<br>` +
      `<span style="color:var(--muted)">已存在的（gachaId 相同）會自動跳過。手動紀錄不會被修改。</span>`,
    onOk: () => {
      let added = 0;
      Object.keys(selected).forEach(pool => {
        added += mergeImportedRecords(pool, selected[pool]);
      });
      recomputeAllGuaranteed();
      persistData();

      importPreviewData = null;
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
function mergeImportedRecords(poolName, importedItems) {
  const pool = state.pools[poolName];
  const existingIds = new Set(pool.records.map(r => r.gachaId).filter(Boolean));

  // 過濾掉重複的
  const fresh = importedItems.filter(r => !r.gachaId || !existingIds.has(r.gachaId));
  if (!fresh.length) return 0;

  // 按 timestamp DESC 排序
  fresh.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // 既有紀錄 order 下移
  pool.records.forEach(r => { r.order = (r.order ?? 0) + fresh.length; });

  // 新紀錄掛到最上面 (#1..#N)
  fresh.forEach((r, i) => {
    pool.records.push({
      id:        newId(),
      name:      r.name,
      pullCount: r.pullCount,
      isOff:     !!r.isOff,
      upBanner:  null,
      timestamp: r.timestamp || new Date().toISOString(),
      gachaId:   r.gachaId,
      source:    'import',
      order:     i + 1,
    });
  });

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
