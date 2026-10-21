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
const FILE_TITLE = '安麗日記資料';

// 欄位順序跟 GAS 版的 PERSON_COLUMNS 一模一樣。
// 現在只是先讀名單，但先把順序定對，之後要接真資料才不用重來。
const COLUMNS = [
  '系統編號', '安麗編號', '姓名', '電話', '身分', '狀態',
  '推薦人姓名', '推薦人系統編號', '加入日期', '地址', '備註',
  '建立時間', '更新時間', '層級', '個人分類', '緯度', '經度', '定位狀態'
];

const STORE_KEY = 'amway-diary-spreadsheet-id';

let accessToken = '';
let spreadsheetId = localStorage.getItem(STORE_KEY) || '';
let tokenClient = null;

const $ = id => document.getElementById(id);

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
  say('正在建立試算表...');
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: FILE_TITLE },
      sheets: [{ properties: { title: SHEET_NAME } }]
    })
  });

  spreadsheetId = created.spreadsheetId;
  localStorage.setItem(STORE_KEY, spreadsheetId);

  // 先寫標題列。欄位順序就是之後真正要用的那一套。
  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(SHEET_NAME)}!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [COLUMNS] }) }
  );

  await showSheet();
  await loadPeople();
  say('建好了。這張試算表在你自己的雲端硬碟裡。');
}

async function showSheet() {
  $('sheetState').textContent = '資料表：' + FILE_TITLE;
  const link = $('sheetLink');
  link.href = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
  link.hidden = false;
  $('createBtn').hidden = true;
  $('reloadBtn').hidden = false;
  $('addBtn').hidden = false;
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

/* ---------- 加一筆（確認寫得進去） ---------- */

async function addSample() {
  const name = prompt('姓名？');
  if (!name || !name.trim()) return;

  say('正在寫入...');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const row = new Array(COLUMNS.length).fill('');
  row[0] = 'P' + String(Date.now()).slice(-6);   // 暫時的編號，之後要換成跟 GAS 版一樣的流水號
  row[2] = name.trim();
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
$('reloadBtn').addEventListener('click', guard(loadPeople));
$('addBtn').addEventListener('click', guard(addSample));
