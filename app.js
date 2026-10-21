// 安麗日記：瀏覽器直連 Google 試算表的最小可行版。
//
// 架構跟 rd545-health 一樣，完全沒有後端：
//   Google Identity Services 拿 token → 直接打 Sheets API → 資料存在使用者自己的雲端硬碟
//
// 只要 drive.file 權限：這個 App 只碰得到「它自己建的」檔案，
// 碰不到使用者雲端硬碟裡的其他東西。這也是外部使用者比較好過
// Google 審查的原因，不要為了方便換成範圍更大的權限。

'use strict';

// ⚠ 這裡要填你自己的 OAuth Client ID（Web application 類型）。
// Client ID 是公開資訊，不是祕密，寫在前端是正常的。
const CLIENT_ID = '806333112280-hm6cdm0fmmhftn7bpnh86nkpkckv9bli.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SHEET_NAME = '人員總表';

// 欄位順序跟 GAS 版的 PERSON_COLUMNS 一模一樣。
// 現在只是先讀名單，但先把順序定對，之後要接真資料才不用重來。
const COLUMNS = [
  '系統編號', '安麗編號', '姓名', '電話', '身分', '狀態',
  '推薦人姓名', '推薦人系統編號', '加入日期', '地址', '備註',
  '建立時間', '更新時間', '層級', '個人分類', '緯度', '經度', '定位狀態'
];

// 分頁名稱與欄位順序完全沿用正式安麗日記。欄位只能加在最後，
// 不可插進中間，否則既有程式用欄位位置讀資料時會整排錯位。
const SHEET_SCHEMAS = [
  ['人員總表', COLUMNS],
  ['行程', ['行程編號', '日期', '時段', '要做什麼', '對象系統編號', '對象姓名', '建立時間', '更新時間', '備註', '完成狀態']],
  ['活動特惠表', ['活動編號', '類型', '名稱', '開始日期', '結束日期', '說明', '建立時間', '更新時間']],
  ['每日叮嚀卡', ['日期', '叮嚀卡內容', '更新時間']],
  ['邀約紀錄表', ['邀約編號', '活動編號', '活動名稱', '人員系統編號', '姓名', '結果', '備註', '建立時間', '更新時間']],
  ['人員關係表', ['關係編號', '人員A系統編號', '人員A姓名', '人員B系統編號', '人員B姓名', '關係類型', '備註', '建立時間', '更新時間']],
  ['客戶背景表', ['人員系統編號', '姓名', '家庭背景', '工作 / 經濟狀況', '健康 / 生活狀況', '關係 / 人脈狀況', '需求與痛點', '重要提醒', '建立時間', '更新時間']],
  ['跟進紀錄表', ['紀錄編號', '人員系統編號', '姓名', '跟進日期', '跟進方式', '跟進內容', '結果狀態', '下次跟進日期', '下次跟進時間', 'Google日曆事件ID', '建立時間', '更新時間', '下回要做什麼', '下回要做狀態']],
  ['長客訂購紀錄', ['姓名', '推薦人', '產品', '期數', '扣款日', '建立日期']],
  ['長客產品價格表', ['產品名稱', '單價', '類別']],
  ['客戶名單', ['代數', '直銷商編號', '姓名', '推薦人', '匯入狀態', '系統訊息', '匯入時間']],
  ['系統設定表', ['設定編號', '設定類型', '名稱', '啟用', '排序', '建立時間', '更新時間']],
  ['淨水器圖片表', ['圖片編號', '淨水器編號', '擁有人姓名', '地址', '檔案名稱', 'Drive檔案ID', '圖片連結', '檔案類型', '建立時間']],
  ['淨水器紀錄表', ['淨水器編號', '擁有人系統編號', '擁有人姓名', '產品型號', '地址', '本次更換日期', '下次更換日期', '狀態', '備註', '建立時間', '更新時間', '緯度', '經度', '定位狀態']]
];

const DEFAULT_SETTINGS = {
  '身分': ['未加入', '直銷商', '生活會員'],
  '狀態': ['觀望中', '經營中', '暫停', '流失', '協作中', '可協助', '暫停協助'],
  '分類': ['陌建', '重點跟進', '家人', '教室朋友'],
  '淨水器產品': ['eSpring', 'eSpring Pro'],
  '關係類型': ['朋友', '家人', '客戶介紹', '合作夥伴', '同事', '其他', '教室夥伴', '協助者', '共同活動', '介紹協助']
};

const STORE_KEY = 'amway-diary-spreadsheet-id';

let accessToken = '';
let spreadsheetId = localStorage.getItem(STORE_KEY) || '';
let tokenClient = null;
let isRenaming = false;

const $ = id => document.getElementById(id);

function diaryTitle(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (name.endsWith('安麗日記')) return name;
  return name + '的安麗日記';
}

function setAppTitle(title) {
  const text = title || '安麗日記';
  $('appTitle').textContent = text;
  document.title = text;
}

function say(text, isError) {
  const box = $('status');
  box.textContent = text || '';
  box.className = 'status' + (isError ? ' error' : '');
}

// Sheets API 的共用呼叫。把錯誤訊息原樣帶出來——
// 只說「失敗」的話，出事時完全不知道是權限、額度還是打錯網址。
async function api(url, options) {
  const response = await fetch(url, Object.assign({}, options, {
    headers: Object.assign({
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }, (options || {}).headers)
  }));

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }

  if (!response.ok) {
    const detail = (data && data.error && data.error.message) || text || response.status;
    throw new Error(detail);
  }
  return data;
}

/* ---------- 登入 ---------- */

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: response => {
      if (response.error) {
        say('登入沒有完成：' + response.error, true);
        return;
      }
      accessToken = response.access_token;
      $('startCard').hidden = true;
      $('sheetCard').hidden = false;
      $('who').textContent = '已登入，資料存在你自己的雲端硬碟';
      say('');

      // 之前建過就直接接回去，不要每次都建一張新的
      if (spreadsheetId) showSheet().then(loadPeople).catch(err => say(err.message, true));
    }
  });
}

function signIn() {
  if (CLIENT_ID.startsWith('請填入')) {
    say('還沒設定 CLIENT_ID。請看 README 的第 1 步。', true);
    return;
  }
  if (!tokenClient) initTokenClient();
  tokenClient.requestAccessToken();
}

/* ---------- 試算表 ---------- */

async function createSheet() {
  const title = diaryTitle($('diaryName').value);
  if (!title) {
    say('請先輸入這是誰的安麗日記。', true);
    $('diaryName').focus();
    return;
  }

  say('正在建立完整安麗日記...');
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: title },
      sheets: SHEET_SCHEMAS.map((schema, index) => ({
        properties: {
          title: schema[0],
          index: index,
          gridProperties: { frozenRowCount: 1, rowCount: 1000, columnCount: 26 }
        }
      }))
    })
  });

  spreadsheetId = created.spreadsheetId;
  localStorage.setItem(STORE_KEY, spreadsheetId);

  localStorage.setItem(STORE_KEY + '-title', title);

  const createdAt = new Date().toISOString();
  let settingIndex = 1;
  const settingRows = Object.entries(DEFAULT_SETTINGS).flatMap(([type, names]) =>
    names.map(name => {
      const row = [
        `S${String(settingIndex).padStart(4, '0')}`,
        type,
        name,
        '是',
        settingIndex,
        createdAt,
        createdAt
      ];
      settingIndex += 1;
      return row;
    })
  );

  // 一次寫入 14 個分頁的標題列與必要預設選項。
  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          ...SHEET_SCHEMAS.map(schema => ({
            range: `'${schema[0].replace(/'/g, "''")}'!A1`,
            majorDimension: 'ROWS',
            values: [schema[1]]
          })),
          {
            range: "'系統設定表'!A2",
            majorDimension: 'ROWS',
            values: settingRows
          }
        ]
      })
    }
  );

  await showSheet(title);
  await loadPeople();
  say('建好了：14 個分頁與欄位都已建立在你自己的雲端硬碟。');
}

async function showSheet(title) {
  const savedTitle = title || localStorage.getItem(STORE_KEY + '-title') || '安麗日記';
  setAppTitle(savedTitle);
  $('sheetState').textContent = '資料表：' + savedTitle;
  const link = $('sheetLink');
  link.href = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
  link.hidden = false;
  $('createBtn').hidden = true;
  $('nameField').hidden = true;
  $('renameBtn').hidden = false;
  $('reloadBtn').hidden = false;
  $('addBtn').hidden = false;
}

async function renameDiary() {
  if (!isRenaming) {
    const currentTitle = localStorage.getItem(STORE_KEY + '-title') || '';
    $('diaryName').value = currentTitle.replace(/的?安麗日記$/, '');
    $('nameField').hidden = false;
    $('renameBtn').textContent = '儲存日記名稱';
    isRenaming = true;
    $('diaryName').focus();
    say('輸入姓名或稱呼後，按「儲存日記名稱」。');
    return;
  }

  const title = diaryTitle($('diaryName').value);
  if (!title) {
    say('請輸入這是誰的安麗日記。', true);
    return;
  }
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ updateSpreadsheetProperties: {
      properties: { title: title }, fields: 'title'
    } }] })
  });
  localStorage.setItem(STORE_KEY + '-title', title);
  setAppTitle(title);
  $('sheetState').textContent = '資料表：' + title;
  $('nameField').hidden = true;
  $('renameBtn').textContent = '修改日記名稱';
  isRenaming = false;
  say('日記名稱已更新。');
}

/* ---------- 讀名單 ---------- */

async function loadPeople() {
  say('正在讀取...');
  const range = `${SHEET_NAME}!A1:R`;
  const data = await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}`
  );

  const rows = (data && data.values) || [];
  const people = rows.slice(1).filter(row => (row[2] || '').trim());

  render(people);
  say(people.length ? `讀到 ${people.length} 筆` : '目前還沒有人員資料');
}

function render(people) {
  const box = $('listBox');

  if (!people.length) {
    box.innerHTML = '<div class="card empty">還沒有資料。按「加一筆測試資料」試試看。</div>';
    return;
  }

  box.innerHTML = people.map(row => {
    const name = row[2] || '未命名';
    const amway = (row[1] || '').trim() || '未加入';
    const identity = row[4] || '未分類';
    const categories = (row[14] || '').split(',').map(s => s.trim()).filter(Boolean);

    return '<article class="person">' +
        '<div class="person-name">' + escapeHtml(name) + '</div>' +
        '<div class="person-meta">' + escapeHtml(amway) + '｜' + escapeHtml(identity) + '</div>' +
        (categories.length
          ? '<div class="tags">' + categories.map(t =>
              '<span class="tag">' + escapeHtml(t) + '</span>').join('') + '</div>'
          : '') +
      '</article>';
  }).join('');
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function askPersonName() {
  const dialog = $('personDialog');
  const form = $('personForm');
  const input = $('personName');
  const error = $('personNameError');

  input.value = '';
  error.hidden = true;
  dialog.showModal();
  requestAnimationFrame(() => input.focus());

  return new Promise(resolve => {
    const finish = value => {
      form.removeEventListener('submit', submit);
      dialog.removeEventListener('cancel', cancel);
      $('personCancelBtn').removeEventListener('click', cancel);
      $('personCloseBtn').removeEventListener('click', cancel);
      dialog.removeEventListener('click', backdrop);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const submit = event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        error.hidden = false;
        input.focus();
        return;
      }
      finish(name);
    };
    const cancel = event => {
      event.preventDefault();
      finish('');
    };
    const backdrop = event => {
      if (event.target === dialog) finish('');
    };

    form.addEventListener('submit', submit);
    dialog.addEventListener('cancel', cancel);
    $('personCancelBtn').addEventListener('click', cancel);
    $('personCloseBtn').addEventListener('click', cancel);
    dialog.addEventListener('click', backdrop);
  });
}

/* ---------- 加一筆（確認寫得進去） ---------- */

async function addSample() {
  const name = await askPersonName();
  if (!name) return;

  say('正在寫入...');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const row = new Array(COLUMNS.length).fill('');
  row[0] = 'P' + String(Date.now()).slice(-6);   // 暫時的編號，之後要換成跟 GAS 版一樣的流水號
  row[2] = name;
  row[4] = '未加入';
  row[11] = now;
  row[12] = now;

  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(SHEET_NAME)}!A1:append?valueInputOption=RAW`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );

  await loadPeople();
}

/* ---------- 接線 ---------- */

function guard(fn) {
  return () => fn().catch(error => say(error.message || String(error), true));
}

$('signInBtn').addEventListener('click', signIn);
$('createBtn').addEventListener('click', guard(createSheet));
$('renameBtn').addEventListener('click', guard(renameDiary));
$('reloadBtn').addEventListener('click', guard(loadPeople));
$('addBtn').addEventListener('click', guard(addSample));

setAppTitle(localStorage.getItem(STORE_KEY + '-title'));
