'use strict';

const STORAGE_KEY = 'bookkanri.books.v1';
const $ = (sel) => document.querySelector(sel);

const STATUS_LABELS = { unread: '未読', reading: '読書中', read: '読了', lent: '貸出中' };

// ---------- 保存 ----------

function loadBooks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveBooks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

let books = loadBooks();

function findByIsbn(isbn) {
  return books.find((b) => b.isbn === isbn);
}

// ---------- ISBN ----------

function isValidIsbn13(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isbn10to13(s) {
  const body = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

/** 入力を ISBN-13 に正規化。無効なら null */
function normalizeIsbn(input) {
  const s = String(input).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0 ? isbn10to13(s) : null;
  }
  return isValidIsbn13(s) ? s : null;
}

// ---------- 書誌情報の取得 ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function lookupOpenBD(isbn) {
  const data = await fetchJson(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
  const s = data?.[0]?.summary;
  if (!s || !s.title) return null;
  return {
    title: [s.title, s.volume].filter(Boolean).join(' '),
    author: (s.author || '').replace(/／[^\s,]*/g, '').trim(),
    publisher: s.publisher || '',
    pubdate: s.pubdate || '',
    cover: s.cover || '',
  };
}

async function lookupGoogleBooks(isbn) {
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = data?.items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(' '),
    author: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    pubdate: v.publishedDate || '',
    cover: (v.imageLinks?.thumbnail || '').replace(/^http:/, 'https:'),
  };
}

/** 国内の本は openBD、見つからなければ Google Books */
async function lookupBook(isbn) {
  for (const fn of [lookupOpenBD, lookupGoogleBooks]) {
    try {
      const info = await fn(isbn);
      if (info) return info;
    } catch (e) {
      console.warn(fn.name, e);
    }
  }
  return null;
}

// ---------- 登録 ----------

async function addByIsbn(isbn) {
  const existing = findByIsbn(isbn);
  if (existing) return { book: existing, duplicate: true };
  const info = await lookupBook(isbn);
  const book = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    isbn,
    title: info?.title || `(タイトル不明) ${isbn}`,
    author: info?.author || '',
    publisher: info?.publisher || '',
    pubdate: info?.pubdate || '',
    cover: info?.cover || '',
    location: lastLocation(),
    status: 'unread',
    memo: '',
    addedAt: new Date().toISOString(),
  };
  books.push(book);
  saveBooks();
  render();
  return { book, duplicate: false, notFound: !info };
}

/** 連続登録しやすいよう、直前に登録した本の場所を引き継ぐ */
function lastLocation() {
  const last = [...books].sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0];
  return last?.location || '';
}

// ---------- 一覧表示 ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function coverHtml(book) {
  return book.cover
    ? `<img src="${escapeHtml(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="noimg">📕</div>';
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const loc = $('#filter-location').value;
  const sort = $('#sort').value;

  let list = books.filter((b) => {
    if (loc && b.location !== loc) return false;
    if (!q) return true;
    return [b.title, b.author, b.publisher, b.isbn, b.memo, b.location]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  const collator = new Intl.Collator('ja');
  const sorters = {
    'added-desc': (a, b) => b.addedAt.localeCompare(a.addedAt),
    'added-asc': (a, b) => a.addedAt.localeCompare(b.addedAt),
    title: (a, b) => collator.compare(a.title, b.title),
    author: (a, b) => collator.compare(a.author || '', b.author || '') || collator.compare(a.title, b.title),
  };
  list.sort(sorters[sort]);

  $('#book-list').innerHTML = list.map((b) => `
    <li class="book" data-id="${b.id}">
      ${coverHtml(b)}
      <div>
        <div class="title">${escapeHtml(b.title)}</div>
        <div class="meta">${escapeHtml([b.author, b.publisher].filter(Boolean).join(' / '))}</div>
        <div>
          ${b.location ? `<span class="tag">📍${escapeHtml(b.location)}</span>` : ''}
          ${b.status && b.status !== 'unread' ? `<span class="tag">${STATUS_LABELS[b.status]}</span>` : ''}
        </div>
      </div>
    </li>`).join('');

  $('#count').textContent = list.length === books.length ? `${books.length}冊` : `${list.length} / ${books.length}冊`;
  $('#empty').hidden = books.length > 0;
  renderLocations();
}

function renderLocations() {
  const locs = [...new Set(books.map((b) => b.location).filter(Boolean))].sort(new Intl.Collator('ja').compare);
  const sel = $('#filter-location');
  const current = sel.value;
  sel.innerHTML = '<option value="">すべての場所</option>' +
    locs.map((l) => `<option>${escapeHtml(l)}</option>`).join('');
  sel.value = locs.includes(current) ? current : '';
  $('#locations').innerHTML = locs.map((l) => `<option value="${escapeHtml(l)}">`).join('');
}

// ---------- 詳細・編集 ----------

let editingId = null;

function openDetail(id) {
  const b = books.find((x) => x.id === id);
  if (!b) return;
  editingId = id;
  $('#d-cover').src = b.cover || 'icon.svg';
  $('#d-title').value = b.title;
  $('#d-author').value = b.author;
  $('#d-publisher').value = b.publisher;
  $('#d-isbn').textContent = `ISBN ${b.isbn}${b.pubdate ? ' ・ ' + b.pubdate : ''}`;
  $('#d-location').value = b.location;
  $('#d-status').value = b.status || 'unread';
  $('#d-memo').value = b.memo;
  $('#detail').returnValue = '';
  $('#detail').showModal();
}

$('#detail').addEventListener('close', () => {
  const action = $('#detail').returnValue;
  const b = books.find((x) => x.id === editingId);
  if (!b) return;
  if (action === 'save') {
    Object.assign(b, {
      title: $('#d-title').value.trim() || b.title,
      author: $('#d-author').value.trim(),
      publisher: $('#d-publisher').value.trim(),
      location: $('#d-location').value.trim(),
      status: $('#d-status').value,
      memo: $('#d-memo').value,
    });
    saveBooks();
    render();
  } else if (action === 'delete') {
    if (confirm(`「${b.title}」を削除しますか？`)) {
      books = books.filter((x) => x.id !== b.id);
      saveBooks();
      render();
      toast('削除しました');
    }
  }
  editingId = null;
});

$('#book-list').addEventListener('click', (e) => {
  const li = e.target.closest('.book');
  if (li) openDetail(li.dataset.id);
});

// ---------- スキャナ ----------

let stream = null;
let zxingControls = null;
let detectTimer = null;
let lastCode = '';
let lastCodeAt = 0;
let busy = false;

function scanMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

async function startScanner() {
  $('#scan-result').innerHTML = '';
  $('#scanner').showModal();
  const video = $('#video');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    showScanMessage('カメラを起動できませんでした。ブラウザのカメラ許可を確認してください（https でのアクセスが必要です）。');
    return;
  }

  // Android Chrome などネイティブ対応ブラウザは BarcodeDetector を使う（速い）
  if ('BarcodeDetector' in window) {
    const formats = await BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('ean_13')) {
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['ean_13'] });
      const tick = async () => {
        if (!stream) return;
        try {
          const codes = await detector.detect(video);
          for (const c of codes) onCode(c.rawValue);
        } catch { /* フレーム未準備など */ }
        detectTimer = setTimeout(tick, 150);
      };
      tick();
      return;
    }
  }

  // iPhone Safari などは ZXing で読み取る
  await loadScript('lib/zxing-browser.min.js');
  const reader = new ZXingBrowser.BrowserMultiFormatOneDReader();
  zxingControls = await reader.decodeFromStream(stream, video, (result) => {
    if (result) onCode(result.getText());
  });
}

function stopScanner() {
  clearTimeout(detectTimer);
  zxingControls?.stop();
  zxingControls = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('#video').srcObject = null;
}

function loadScript(src) {
  if (window.ZXingBrowser) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function onCode(raw) {
  // 本の下段バーコード（192...）は価格コードなので無視し、978/979 のみ扱う
  const isbn = normalizeIsbn(raw);
  if (!isbn) return;
  const now = Date.now();
  if (busy || (isbn === lastCode && now - lastCodeAt < 3000)) return;
  lastCode = isbn;
  lastCodeAt = now;
  busy = true;
  navigator.vibrate?.(60);

  try {
    if (scanMode() === 'check') {
      const b = findByIsbn(isbn);
      if (b) {
        showScanCard(b, 'dup', `⚠️ 持ってます！${b.location ? '（📍' + b.location + '）' : ''}`);
      } else {
        showScanMessage('🔎 検索中…');
        const info = await lookupBook(isbn);
        showScanCard({ isbn, ...(info || { title: isbn }) }, 'ok', '✅ まだ持っていません');
      }
    } else {
      showScanMessage('🔎 検索中…');
      const { book, duplicate, notFound } = await addByIsbn(isbn);
      if (duplicate) {
        showScanCard(book, 'dup', '⚠️ 登録済みです');
      } else {
        showScanCard(book, 'ok', notFound ? '✅ 登録しました（書誌情報が見つからないので後で編集してください）' : '✅ 登録しました');
      }
    }
  } finally {
    busy = false;
  }
}

function showScanMessage(msg) {
  $('#scan-result').innerHTML = `<div class="scan-card"><div class="noimg">📷</div><div>${escapeHtml(msg)}</div></div>`;
}

function showScanCard(book, cls, status) {
  $('#scan-result').innerHTML = `
    <div class="scan-card ${cls}">
      ${coverHtml(book)}
      <div>
        <div class="status">${escapeHtml(status)}</div>
        <div class="title">${escapeHtml(book.title)}</div>
        <div class="meta">${escapeHtml(book.author || '')}</div>
      </div>
    </div>`;
}

$('#btn-scan').addEventListener('click', startScanner);
$('#btn-close-scan').addEventListener('click', () => $('#scanner').close());
$('#scanner').addEventListener('close', stopScanner);

// ---------- 手入力 ----------

$('#btn-manual').addEventListener('click', () => {
  $('#manual-isbn').value = '';
  $('#manual').returnValue = '';
  $('#manual').showModal();
});

$('#manual').addEventListener('close', async () => {
  if ($('#manual').returnValue !== 'ok') return;
  const isbn = normalizeIsbn($('#manual-isbn').value);
  if (!isbn) {
    toast('ISBNが正しくありません');
    return;
  }
  toast('検索中…');
  const { book, duplicate } = await addByIsbn(isbn);
  toast(duplicate ? `登録済み：${book.title}` : `登録しました：${book.title}`);
});

// ---------- 書き出し・読み込み ----------

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

$('#btn-menu').addEventListener('click', () => $('#menu').showModal());

$('#btn-export-json').addEventListener('click', () => {
  download(`books-${today()}.json`, JSON.stringify(books, null, 2), 'application/json');
});

$('#btn-export-csv').addEventListener('click', () => {
  const cols = ['isbn', 'title', 'author', 'publisher', 'pubdate', 'location', 'status', 'memo', 'addedAt'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...books.map((b) => cols.map((c) => cell(c === 'status' ? STATUS_LABELS[b.status] : b[c])).join(','))].join('\r\n');
  // Excel で文字化けしないよう BOM を付ける
  download(`books-${today()}.csv`, '﻿' + csv, 'text/csv');
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error('not array');
    let added = 0;
    for (const b of incoming) {
      if (!b?.isbn || findByIsbn(b.isbn)) continue;
      books.push({ status: 'unread', memo: '', location: '', addedAt: new Date().toISOString(), ...b, id: b.id || String(Date.now()) + Math.random() });
      added++;
    }
    saveBooks();
    render();
    $('#menu').close();
    toast(`${added}冊を読み込みました（重複はスキップ）`);
  } catch {
    toast('読み込みに失敗しました');
  }
});

// ---------- その他 ----------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

$('#search').addEventListener('input', render);
$('#sort').addEventListener('change', render);
$('#filter-location').addEventListener('change', render);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
