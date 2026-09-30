/**
 * 本棚かんり ↔ Google スプレッドシート連携用 Apps Script
 *
 * スプレッドシートの「拡張機能 → Apps Script」にこのファイルの中身を貼り付け、
 * TOKEN を自分だけの合言葉に変えてから「ウェブアプリ」としてデプロイしてください。
 * 手順の詳細は README の「スプレッドシート連携」を参照。
 */

// アプリの設定画面に入れる合言葉。推測されにくい文字列に必ず変更すること
const TOKEN = 'ここを好きな合言葉に変更';

const SHEET_NAME = '本棚';
const COLUMNS = [
  ['id', 'ID'],
  ['isbn', 'ISBN'],
  ['title', 'タイトル'],
  ['author', '著者'],
  ['publisher', '出版社'],
  ['pubdate', '出版日'],
  ['location', '場所'],
  ['status', '状態'],
  ['memo', 'メモ'],
  ['addedAt', '追加日時'],
  ['cover', '表紙URL'],
];
const KEYS = COLUMNS.map((c) => c[0]);
const STATUS_TO_LABEL = { unread: '未読', reading: '読書中', read: '読了', lent: '貸出中' };
const LABEL_TO_STATUS = Object.fromEntries(Object.entries(STATUS_TO_LABEL).map(([k, v]) => [v, k]));

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad request' });
  }
  if (TOKEN === 'ここを好きな合言葉に変更' || req.token !== TOKEN) {
    return json({ ok: false, error: 'unauthorized' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet();
    applyOps(sheet, req.ops || []);
    return json({ ok: true, books: readBooks(sheet) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map((c) => c[1])]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // ISBN が数値や指数表記に化けないよう全体を書式なしテキストにする
    sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).setNumberFormat('@');
  }
  return sheet;
}

function bookToRow(book) {
  return KEYS.map((k) => {
    const v = k === 'status' ? STATUS_TO_LABEL[book.status] || STATUS_TO_LABEL.unread : book[k];
    return v == null ? '' : String(v);
  });
}

function applyOps(sheet, ops) {
  for (const o of ops) {
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues() : [];
    if (o.op === 'delete') {
      const i = rows.findIndex((r) => r[0] === o.id);
      if (i >= 0) sheet.deleteRow(i + 2);
    } else if (o.op === 'upsert' && o.book && o.book.isbn) {
      const i = rows.findIndex((r) => r[0] === o.book.id);
      const row = bookToRow(o.book);
      if (i >= 0) {
        sheet.getRange(i + 2, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      } else if (rows.some((r) => r[1].replace(/[^0-9Xx]/g, '') === o.book.isbn)) {
        // 別の端末で登録済みの本。スプレッドシート側を正として追加しない
      } else {
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      }
    }
  }
}

function readBooks(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const range = sheet.getRange(2, 1, last - 1, COLUMNS.length);
  const values = range.getDisplayValues();
  const books = [];
  let filled = false;
  values.forEach((r, idx) => {
    const isbn = r[1].replace(/[^0-9Xx]/g, '');
    if (!isbn) return;
    // スプレッドシートに直接書き足した行には ID と追加日時を補う
    if (!r[0]) {
      r[0] = Utilities.getUuid();
      filled = true;
    }
    if (!r[9]) {
      r[9] = new Date().toISOString();
      filled = true;
    }
    const book = {};
    KEYS.forEach((k, j) => (book[k] = r[j]));
    book.isbn = isbn;
    book.status = LABEL_TO_STATUS[r[7]] || 'unread';
    book.title = book.title || '(タイトル不明) ' + isbn;
    books.push(book);
    values[idx] = r;
  });
  if (filled) range.setNumberFormat('@').setValues(values);
  return books;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
