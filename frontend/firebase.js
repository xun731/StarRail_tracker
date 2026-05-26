'use strict';

/**
 * Firebase 整合模組
 *
 * ══════════════════════════════════════════════════════════
 *  Firebase 完整設定 checklist（5 步全做完才會跨裝置同步）
 * ══════════════════════════════════════════════════════════
 *
 *  [ ] 1. 建立專案：https://console.firebase.google.com → 新增專案
 *
 *  [ ] 2. 啟用 Google 登入：
 *         左側 → Authentication → Sign-in method → Google → 啟用 → 儲存
 *
 *  [ ] 3. 加入授權網域（部署後必要！）：
 *         Authentication → Settings → Authorized domains → Add domain
 *         加入：starrail-tracker.netlify.app（或你部署後的網域）
 *
 *  [ ] 4. 建立 Firestore 資料庫：
 *         左側 → Firestore Database → 建立資料庫
 *         地區建議：asia-east1（台灣 / 香港延遲最低）
 *         模式：可先選「測試模式」但 ⚠ **30 天會到期，到期後寫入會被拒絕**
 *
 *  [ ] 5. 部署安全規則（**最容易漏的一步**）：
 *         Firestore Database → 規則 標籤
 *         把專案根目錄的 firestore.rules 內容貼進去 → 發佈
 *         （沒做這步：30 天後所有寫入都會 silent fail，資料只在本機）
 *
 *  [ ] 6. 複製設定值：
 *         專案設定（齒輪）→ 一般 → 你的應用程式
 *         點「</> 網頁應用程式」→ 複製 firebaseConfig 物件
 *         填到下方 FIREBASE_CONFIG
 *
 *  完成後重新整理頁面，登入 → 新增一筆紀錄 → 去 Firebase Console
 *  的 Firestore Database 看 users/{uid} 應該會有 pools 欄位。
 *
 *  ── 診斷指令（瀏覽器 DevTools Console 直接打）─────────────────
 *    hsrDebug.testWrite()    強制寫一筆測試資料到雲端
 *    hsrDebug.testRead()     讀目前雲端內容
 *    hsrDebug.forceUpload()  把目前的 state 立刻同步上去
 *    hsrDebug.user()         確認登入身分
 * ══════════════════════════════════════════════════════════
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOtr1ovFkK-8kvI3fn0EPggV1t6u_QH0A",
  authDomain: "xun-starrail-tracker.firebaseapp.com",
  projectId: "xun-starrail-tracker",
  storageBucket: "xun-starrail-tracker.firebasestorage.app",
  messagingSenderId: "341026060866",
  appId: "1:341026060866:web:e62032c0e5de1289440bdb",
  measurementId: "G-JH6LT5KEBL"
};

// ── 判斷是否已設定 ────────────────────────────────────────────────────────────
const FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';

let auth = null;
let db   = null;

function initFirebase() {
  if (!FIREBASE_CONFIGURED) return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db   = firebase.firestore();
  } catch (e) {
    console.error('Firebase 初始化失敗：', e);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function onAuthChange(callback) {
  if (!auth) { callback(null); return; }
  auth.onAuthStateChanged(callback);
}

async function signInWithGoogle() {
  if (!auth) {
    throw { code: 'no-firebase', message: 'Firebase 未設定，無法登入' };
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    const map = {
      'auth/unauthorized-domain':
        `此網域未授權登入。請到 Firebase Console → Authentication → Settings → Authorized domains 加入「${location.hostname}」`,
      'auth/popup-blocked':       '瀏覽器擋住登入彈窗，請允許後再試',
      'auth/popup-closed-by-user':'已取消登入',
      'auth/cancelled-popup-request': '已取消登入（前一個彈窗未關閉）',
      'auth/network-request-failed': '網路問題，無法連到 Firebase',
      'auth/operation-not-allowed':  '此專案尚未啟用 Google 登入。請到 Firebase Console → Authentication → Sign-in method 啟用 Google',
    };
    throw {
      code: e?.code || 'unknown',
      message: map[e?.code] || (e?.message || '登入失敗'),
      raw: e,
    };
  }
}

async function signOut() {
  if (!auth) return;
  await auth.signOut();
}

// ── Firestore ─────────────────────────────────────────────────────────────────
/**
 * 把 Firebase 原生錯誤轉成使用者可讀的中文訊息。
 */
function classifyFirebaseError(e) {
  const code = e?.code || '';
  const map = {
    'permission-denied':  '權限不足（請檢查 Firestore 安全規則）',
    'unauthenticated':    '未登入或登入逾時，請重新登入',
    'unavailable':        '網路連線中斷或 Firebase 服務暫時無法存取',
    'resource-exhausted': '已達免費額度，請稍後再試或升級方案',
    'failed-precondition':'資料庫前置條件未滿足',
    'deadline-exceeded':  '雲端回應逾時',
    'cancelled':          '請求被取消',
    'internal':           'Firebase 內部錯誤',
  };
  return {
    code,
    message: map[code] || (e?.message || '未知錯誤'),
    raw: e,
  };
}

async function loadFromCloud(uid) {
  if (!db) return null;
  try {
    const doc = await db.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    const cls = classifyFirebaseError(e);
    console.error('[loadFromCloud]', cls.code, cls.message, e);
    throw cls;
  }
}

async function saveToCloud(uid, data) {
  if (!db) return;
  try {
    await db.collection('users').doc(uid).set(data);
  } catch (e) {
    const cls = classifyFirebaseError(e);
    console.error('[saveToCloud]', cls.code, cls.message, e);
    throw cls;
  }
}

// ── localStorage 備援 ─────────────────────────────────────────────────────────
const LS_KEY = 'hsr_tracker_data';

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || null;
  } catch { return null; }
}

function saveLocal(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}
