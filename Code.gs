const PRODUCTS = 'Products';
const LOG = 'Log';
const USERS = 'Users';
const CONFIG = 'Config';

// Run once from the editor to create the tabs and headers. Safe to run again.
function setup() {
  const ss = SpreadsheetApp.getActive();
  let p = ss.getSheetByName(PRODUCTS);
  const first = ss.getSheets()[0];
  if (!p && first.getRange('A1').getValue() === 'SKU') p = first.setName(PRODUCTS);
  if (!p) p = ss.insertSheet(PRODUCTS);
  if (p.getLastRow() === 0) p.appendRow(['SKU', 'Name', 'Qty']);

  const l = sheet_(LOG);
  if (l.getLastRow() === 0) l.appendRow(['Time', 'SKU', 'Name', 'Mode', 'Change', 'Qty after', 'User']);

  const u = sheet_(USERS);
  if (u.getLastRow() === 0) u.appendRow(['Name', 'Key', 'Active', 'Setup link']);

  const c = sheet_(CONFIG);
  if (c.getLastRow() === 0) {
    c.appendRow(['Scanner URL', 'https://YOUR-GITHUB-USERNAME.github.io/stock-scanner/']);
    c.appendRow(['Note', 'After changing the URL, run Stock Scanner > Generate keys & links']);
  }
  [p, l, u].forEach(s => s.setFrozenRows(1));
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock Scanner')
    .addItem('Generate keys & links', 'generateKeys')
    .addToUi();
}

// Fills in a key, Active = TRUE and a setup link for every user row that has a name but no key.
function generateKeys() {
  const u = sheet_(USERS);
  const last = u.getLastRow();
  if (last < 2) return;
  const rows = u.getRange(2, 1, last - 1, 3).getValues();
  rows.forEach((r, i) => {
    const row = i + 2;
    if (!r[0]) return;
    if (!r[1]) u.getRange(row, 2).setValue(Utilities.getUuid().replace(/-/g, ''));
    if (r[2] === '') u.getRange(row, 3).insertCheckboxes().check();
    u.getRange(row, 4).setFormula('=IF(B' + row + '="","",Config!$B$1&"#key="&B' + row + ')');
  });
}

// Returns the user's name for an active key, or null.
function userForKey_(key) {
  key = String(key || '').trim();
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const u = sheet_(USERS);
  if (u.getLastRow() < 2) return null;
  const rows = u.getRange(2, 1, u.getLastRow() - 1, 3).getValues();
  const hit = rows.find(r => String(r[1]).trim() === key);
  return hit && hit[2] === true ? String(hit[0]) : null;
}

function findRow_(sheet, sku) {
  const skus = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < skus.length; i++) {
    if (String(skus[i][0]).trim() === sku) return i + 2;
  }
  return -1;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, message: 'Stock Scanner API' });
}

// The scan page sends JSON as text/plain: { key, action, sku?, mode?, amount? }.
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, message: 'Permintaan tidak valid' }); }
  const user = userForKey_(req.key);
  if (!user) return json_({ ok: false, denied: true, message: 'Akses ditolak. Minta link login baru.' });
  switch (req.action) {
    case 'whoami': return json_({ ok: true, user });
    case 'lookup': return json_(lookup_(req.sku));
    case 'create': return json_(createProduct_(user, req.sku, req.name, req.mode, req.amount));
    case 'scan': return json_(scan_(user, req.sku, req.mode, req.amount));
    case 'undo': return json_(undoLast_(user));
    case 'products': return json_({ ok: true, items: getProducts_() });
    default: return json_({ ok: false, message: 'Aksi tidak dikenal' });
  }
}

// Reads a product without changing anything, so the page can ask for the quantity first.
function lookup_(sku) {
  sku = String(sku || '').trim();
  const p = sheet_(PRODUCTS);
  const row = findRow_(p, sku);
  if (row < 0) return { ok: false, notFound: true, sku, message: 'SKU tidak dikenal: ' + sku };
  const [, name, qty] = p.getRange(row, 1, 1, 3).getValues()[0];
  return { ok: true, sku, name, qty: Number(qty) || 0 };
}

// Creates a product and its first stock-in under the same lock used by scans.
// A repeated request returns the existing product without adding stock again.
function createProduct_(user, sku, name, mode, amount) {
  sku = String(sku || '').trim();
  name = String(name || '').trim();
  amount = Number(amount);
  if (mode !== 'IN') return { ok: false, message: 'Produk baru hanya bisa ditambah di Barang Masuk' };
  if (!sku || sku.length > 256) return { ok: false, message: 'Barcode wajib diisi (maksimal 256 karakter)' };
  if (name.length > 200) return { ok: false, message: 'Nama produk maksimal 200 karakter' };
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 9999) return { ok: false, message: 'Isi jumlah bulat antara 1 dan 9999' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = sheet_(PRODUCTS);
    const row = findRow_(p, sku);
    if (row >= 0) {
      const [, existingName, qty] = p.getRange(row, 1, 1, 3).getValues()[0];
      return { ok: false, exists: true, sku, name: existingName, qty: Number(qty) || 0,
        message: 'Produk sudah ada. Periksa stok sebelum menambah lagi.' };
    }
    // Leading apostrophes keep barcode zeros and names as literal sheet text.
    p.appendRow(["'" + sku, name ? "'" + name : '', amount]);
    sheet_(LOG).appendRow([new Date(), "'" + sku, name ? "'" + name : '', 'IN', amount, amount, user]);
    return { ok: true, sku, name, qty: amount, change: amount };
  } finally {
    lock.releaseLock();
  }
}

// mode: 'IN' or 'OUT'. Returns { ok, sku, name, qty, change, message }.
function scan_(user, sku, mode, amount) {
  sku = String(sku || '').trim();
  amount = Math.max(1, parseInt(amount, 10) || 1);
  if (!sku) return { ok: false, message: 'Scan kosong' };
  if (mode !== 'IN' && mode !== 'OUT') return { ok: false, message: 'Mode tidak valid' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = sheet_(PRODUCTS);
    const row = findRow_(p, sku);
    if (row < 0) return { ok: false, sku, message: 'SKU tidak dikenal: ' + sku };

    const [, name, qty] = p.getRange(row, 1, 1, 3).getValues()[0];
    const change = mode === 'IN' ? amount : -amount;
    const newQty = (Number(qty) || 0) + change;
    if (newQty < 0) return { ok: false, sku, name, qty, message: 'Stok tidak cukup (sisa ' + qty + ')' };

    p.getRange(row, 3).setValue(newQty);
    sheet_(LOG).appendRow([new Date(), "'" + sku, name ? "'" + name : '', mode, change, newQty, user]);
    return { ok: true, sku, name, qty: newQty, change };
  } finally {
    lock.releaseLock();
  }
}

// Reverts this user's most recent scan, if it hasn't been undone already.
function undoLast_(user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const l = sheet_(LOG);
    const last = l.getLastRow();
    if (last < 2) return { ok: false, message: 'Tidak ada yang bisa dibatalkan' };
    const rows = l.getRange(2, 1, last - 1, 7).getValues();
    let i = rows.length - 1;
    while (i >= 0 && rows[i][6] !== user) i--;
    if (i < 0) return { ok: false, message: 'Tidak ada yang bisa dibatalkan' };
    const [, sku, name, mode, change] = rows[i];
    if (String(mode).startsWith('UNDO')) return { ok: false, message: 'Scan terakhir Anda sudah dibatalkan' };

    const p = sheet_(PRODUCTS);
    const row = findRow_(p, String(sku));
    if (row < 0) return { ok: false, message: 'SKU sudah tidak ada' };
    const newQty = (Number(p.getRange(row, 3).getValue()) || 0) - change;
    p.getRange(row, 3).setValue(newQty);
    l.appendRow([new Date(), "'" + sku, name ? "'" + name : '', 'UNDO ' + mode, -change, newQty, user]);
    return { ok: true, sku, name, qty: newQty, change: -change };
  } finally {
    lock.releaseLock();
  }
}

function getProducts_() {
  const p = sheet_(PRODUCTS);
  if (p.getLastRow() < 2) return [];
  return p.getRange(2, 1, p.getLastRow() - 1, 3).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({ sku: String(r[0]), name: r[1], qty: r[2] }));
}
