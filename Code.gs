const PRODUCTS = 'Products';
const LOG = 'Log';
const USERS = 'Users';
const CONFIG = 'Config';
// Products columns: SKU, Name, Total, then one stock column per rack (header = rack name).
const FIRST_RACK_COL = 4;
const EDITABLE = '#eef7ea';

// Run once from the editor to create the tabs and headers. Safe to run again.
function setup() {
  const ss = SpreadsheetApp.getActive();
  let p = ss.getSheetByName(PRODUCTS);
  const first = ss.getSheets()[0];
  if (!p && first.getRange('A1').getValue() === 'SKU') p = first.setName(PRODUCTS);
  if (!p) p = ss.insertSheet(PRODUCTS);
  if (p.getLastRow() === 0) p.appendRow(['SKU', 'Name', 'Total', 'Rak A', 'Rak B', 'Rak C']);

  const l = sheet_(LOG);
  if (l.getLastRow() === 0) l.appendRow(['Time', 'SKU', 'Name', 'Rack', 'Mode', 'Change', 'Qty after', 'User']);

  const u = sheet_(USERS);
  if (u.getLastRow() === 0) u.appendRow(['Name', 'Key', 'Active', 'Setup link']);

  const c = sheet_(CONFIG);
  if (c.getLastRow() === 0) {
    c.appendRow(['Scanner URL', 'https://YOUR-GITHUB-USERNAME.github.io/stock-scanner/']);
    c.appendRow(['Note', 'After changing the URL, run Stock Scanner > Generate keys & links']);
  }
  [p, l, u].forEach(s => s.setFrozenRows(1));

  // Green marks what people may edit by hand: product names, rack stock, user names, Active, the URL.
  p.getRange(1, 2, p.getMaxRows(), 1).setBackground(EDITABLE);
  const rackCount = racks_(p).length;
  if (rackCount) p.getRange(1, FIRST_RACK_COL, p.getMaxRows(), rackCount).setBackground(EDITABLE);
  u.getRange(1, 1, u.getMaxRows(), 1).setBackground(EDITABLE);
  u.getRange(1, 3, u.getMaxRows(), 1).setBackground(EDITABLE);
  c.getRange(1, 2).setBackground(EDITABLE);
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock Scanner')
    .addItem('Generate keys & links', 'generateKeys')
    .addItem('Tambah rak', 'addRack')
    .addToUi();
}

// Rack names from the Products header, left to right, up to the first blank header.
// Anything after a blank column (notes, etc.) is not a rack.
function racks_(p) {
  const width = p.getLastColumn() - FIRST_RACK_COL + 1;
  if (width < 1) return [];
  const names = [];
  for (const h of p.getRange(1, FIRST_RACK_COL, 1, width).getValues()[0]) {
    if (String(h).trim() === '') break;
    names.push(String(h).trim());
  }
  return names;
}

function colLetter_(col) {
  let s = '';
  for (; col > 0; col = Math.floor((col - 1) / 26)) s = String.fromCharCode(65 + (col - 1) % 26) + s;
  return s;
}

// Total adds up exactly the rack columns, so numbers in a notes column never count.
function totalFormula_(row, rackCount) {
  if (!rackCount) return 0;
  return '=SUM(' + colLetter_(FIRST_RACK_COL) + row + ':' + colLetter_(FIRST_RACK_COL + rackCount - 1) + row + ')';
}

// Menu: Stock Scanner > Tambah rak.
function addRack() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Tambah rak', 'Nama rak baru (contoh: Rak D):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const out = addRack_(res.getResponseText());
  ui.alert(out.ok ? 'Rak ditambahkan' : 'Rak tidak ditambahkan', out.message, ui.ButtonSet.OK);
}

// Adds a rack column after the last rack (pushing anything after it right), fills existing products
// with 0, colors it as editable, and widens every Total formula to include it.
function addRack_(name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, message: 'Nama rak wajib diisi.' };
  if (name.length > 30) return { ok: false, message: 'Nama rak maksimal 30 karakter.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = sheet_(PRODUCTS);
    const names = racks_(p);
    if (names.some(r => r.toLowerCase() === name.toLowerCase())) return { ok: false, message: name + ' sudah ada.' };
    const col = FIRST_RACK_COL + names.length;
    if (col <= p.getLastColumn()) p.insertColumnBefore(col);
    p.getRange(1, col).setValue(name);
    p.getRange(1, col, p.getMaxRows(), 1).setBackground(EDITABLE);
    const last = p.getLastRow();
    if (last > 1) {
      p.getRange(2, col, last - 1, 1).setValues(Array.from({ length: last - 1 }, () => [0]));
      p.getRange(2, 3, last - 1, 1).setFormulas(Array.from({ length: last - 1 }, (_, i) => [totalFormula_(i + 2, names.length + 1)]));
    }
    return { ok: true, message: name + ' siap dipakai. Buka ulang halaman scanner supaya rak baru muncul.' };
  } finally {
    lock.releaseLock();
  }
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
    case 'whoami': return json_({ ok: true, user, racks: racks_(sheet_(PRODUCTS)) });
    case 'lookup': return json_(lookup_(req.sku));
    case 'create': return json_(createProduct_(user, req.sku, req.name, req.mode, req.amount, req.rack));
    case 'scan': return json_(scan_(user, req.sku, req.mode, req.amount, req.rack));
    case 'undo': return json_(undoLast_(user));
    case 'products': return json_({ ok: true, items: getProducts_() });
    default: return json_({ ok: false, message: 'Aksi tidak dikenal' });
  }
}

// Reads a product without changing anything, so the page can ask for the quantity first.
// racks maps each rack name to its stock; total is their sum.
function lookup_(sku) {
  sku = String(sku || '').trim();
  const p = sheet_(PRODUCTS);
  const row = findRow_(p, sku);
  if (row < 0) return { ok: false, notFound: true, sku, message: 'SKU tidak dikenal: ' + sku };
  return Object.assign({ ok: true }, product_(p, row));
}

function product_(p, row) {
  const names = racks_(p);
  const [sku, name] = p.getRange(row, 1, 1, 2).getValues()[0];
  const qty = names.length ? p.getRange(row, FIRST_RACK_COL, 1, names.length).getValues()[0] : [];
  const racks = {};
  names.forEach((r, i) => { racks[r] = Number(qty[i]) || 0; });
  return { sku: String(sku), name, racks, total: names.reduce((t, r) => t + racks[r], 0) };
}

// Column of a rack in Products, or -1 if it isn't one.
function rackCol_(p, rack) {
  const i = racks_(p).indexOf(String(rack || '').trim());
  return i < 0 ? -1 : FIRST_RACK_COL + i;
}

// Creates a product and its first stock-in under the same lock used by scans.
// A repeated request returns the existing product without adding stock again.
function createProduct_(user, sku, name, mode, amount, rack) {
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
    const col = rackCol_(p, rack);
    if (col < 0) return { ok: false, message: 'Pilih rak dulu' };
    const row = findRow_(p, sku);
    if (row >= 0) {
      return Object.assign({ ok: false, exists: true, message: 'Produk sudah ada. Periksa stok sebelum menambah lagi.' }, product_(p, row));
    }
    const newRow = p.getLastRow() + 1;
    const names = racks_(p);
    const values = ["'" + sku, name ? "'" + name : '', totalFormula_(newRow, names.length)];
    names.forEach((_, i) => values.push(FIRST_RACK_COL + i === col ? amount : 0));
    // Leading apostrophes keep barcode zeros and names as literal sheet text.
    p.appendRow(values);
    rack = names[col - FIRST_RACK_COL];
    sheet_(LOG).appendRow([new Date(), "'" + sku, name ? "'" + name : '', rack, 'IN', amount, amount, user]);
    return { ok: true, sku, name, rack, qty: amount, total: amount, change: amount };
  } finally {
    lock.releaseLock();
  }
}

// mode: 'IN' or 'OUT'. Returns { ok, sku, name, rack, qty (in that rack), total, change, message }.
function scan_(user, sku, mode, amount, rack) {
  sku = String(sku || '').trim();
  amount = Math.max(1, parseInt(amount, 10) || 1);
  if (!sku) return { ok: false, message: 'Scan kosong' };
  if (mode !== 'IN' && mode !== 'OUT') return { ok: false, message: 'Mode tidak valid' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = sheet_(PRODUCTS);
    const col = rackCol_(p, rack);
    if (col < 0) return { ok: false, message: 'Pilih rak dulu' };
    const row = findRow_(p, sku);
    if (row < 0) return { ok: false, sku, message: 'SKU tidak dikenal: ' + sku };

    const before = product_(p, row);
    rack = racks_(p)[col - FIRST_RACK_COL];
    const qty = before.racks[rack];
    const change = mode === 'IN' ? amount : -amount;
    const newQty = qty + change;
    if (newQty < 0) return { ok: false, sku, name: before.name, qty, message: 'Stok ' + rack + ' tidak cukup (sisa ' + qty + ')' };

    p.getRange(row, col).setValue(newQty);
    const name = before.name;
    sheet_(LOG).appendRow([new Date(), "'" + sku, name ? "'" + name : '', rack, mode, change, newQty, user]);
    return { ok: true, sku, name, rack, qty: newQty, total: before.total + change, change };
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
    const rows = l.getRange(2, 1, last - 1, 8).getValues();
    let i = rows.length - 1;
    while (i >= 0 && rows[i][7] !== user) i--;
    if (i < 0) return { ok: false, message: 'Tidak ada yang bisa dibatalkan' };
    const [, sku, name, rack, mode, change] = rows[i];
    if (String(mode).startsWith('UNDO')) return { ok: false, message: 'Scan terakhir Anda sudah dibatalkan' };

    const p = sheet_(PRODUCTS);
    const row = findRow_(p, String(sku));
    if (row < 0) return { ok: false, message: 'SKU sudah tidak ada' };
    const col = rackCol_(p, rack);
    if (col < 0) return { ok: false, message: 'Rak untuk scan ini tidak ditemukan' };
    const before = product_(p, row);
    const newQty = before.racks[rack] - change;
    p.getRange(row, col).setValue(newQty);
    l.appendRow([new Date(), "'" + sku, name ? "'" + name : '', rack, 'UNDO ' + mode, -change, newQty, user]);
    return { ok: true, sku: String(sku), name, rack, qty: newQty, total: before.total - change, change: -change };
  } finally {
    lock.releaseLock();
  }
}

function getProducts_() {
  const p = sheet_(PRODUCTS);
  const items = [];
  for (let row = 2; row <= p.getLastRow(); row++) {
    const item = product_(p, row);
    if (item.sku !== '') items.push(item);
  }
  return items;
}
