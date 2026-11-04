const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function backend() {
  const data = { Products: [['SKU', 'Name', 'Total', 'Rak A', 'Rak B']], Log: [['Time', 'SKU', 'Name', 'Rack', 'Mode', 'Change', 'Qty after', 'User']] };
  let held = false;
  const sheets = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, {
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map(r => r.length)),
    getMaxRows: () => 1000,
    insertColumnBefore: col => rows.forEach(r => { if (r.length >= col) r.splice(col - 1, 0, ''); }),
    getRange: (row, col, height = 1, width = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      getValue: () => rows[row - 1]?.[col - 1],
      setValue: value => { (rows[row - 1] ||= [])[col - 1] = value; },
      setValues: values => values.forEach((v, i) => v.forEach((x, j) => { (rows[row - 1 + i] ||= [])[col - 1 + j] = x; })),
      setFormulas: values => values.forEach((v, i) => v.forEach((x, j) => { (rows[row - 1 + i] ||= [])[col - 1 + j] = x; })),
      setBackground: () => {},
    }),
    appendRow: values => {
      assert.equal(held, true, 'Writes must hold the shared script lock');
      rows.push(Array.from(values, value => typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value));
    },
  }]));
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => ({ getSheetByName: name => sheets[name] }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(held, false); held = true; }, releaseLock: () => { held = false; } }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../Code.gs'), 'utf8'), context);
  return { data, call: (name, ...args) => context[name](...args), locked: () => held };
}

test('unknown products carry an explicit notFound response', () => {
  const b = backend();
  assert.equal(b.call('lookup_', '00123').notFound, true);
});

test('creates literal barcode/name, stock, and one attributed IN log; undo keeps product', () => {
  const b = backend();
  const res = b.call('createProduct_', 'Budi', '00123', '=Sample', 'IN', 5, 'Rak A');
  assert.equal(res.ok, true);
  assert.deepEqual(b.data.Products[1], ['00123', '=Sample', '=SUM(D2:E2)', 5, 0]);
  assert.deepEqual(b.data.Log[1].slice(1), ['00123', '=Sample', 'Rak A', 'IN', 5, 5, 'Budi']);
  assert.equal(b.locked(), false);
  assert.equal(b.call('lookup_', '00123').total, 5);
  assert.equal(b.call('undoLast_', 'Budi').qty, 0);
  assert.equal(b.data.Products.length, 2);
});

test('duplicate or repeated creation never increments stock or adds another row/log', () => {
  const b = backend();
  b.call('createProduct_', 'Budi', '00123', 'First', 'IN', 5, 'Rak A');
  const duplicate = b.call('createProduct_', 'Other staff', '00123', 'Different', 'IN', 9, 'Rak A');
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.name, 'First');
  assert.equal(duplicate.total, 5);
  assert.equal(b.data.Products.length, 2);
  assert.equal(b.data.Log.length, 2);
  assert.equal(b.locked(), false);
});

test('rejects OUT, empty barcodes, long names, decimals, and invalid quantities without writes', () => {
  for (const [sku, name, mode, amount] of [
    ['001', 'Product', 'OUT', 1], ['', 'Product', 'IN', 1],
    ['001', 'Product', 'IN', 0], ['001', 'Product', 'IN', 1.5], ['001', 'Product', 'IN', 10000],
    ['001', 'x'.repeat(201), 'IN', 1],
  ]) {
    const b = backend();
    assert.equal(b.call('createProduct_', 'Budi', sku, name, mode, amount, 'Rak A').ok, false);
    assert.equal(b.data.Products.length, 1);
    assert.equal(b.data.Log.length, 1);
  }
});

test('empty product names stay blank in creation, scan, and undo logs', () => {
  for (const name of [undefined, '', '   ']) {
    const b = backend();
    const res = b.call('createProduct_', 'Budi', '00123', name, 'IN', 2, 'Rak A');
    assert.equal(res.ok, true);
    assert.equal(res.name, '');
    assert.deepEqual(b.data.Products[1], ['00123', '', '=SUM(D2:E2)', 2, 0]);
    assert.equal(b.data.Log[1][2], '');
    b.call('scan_', 'Budi', '00123', 'IN', 3, 'Rak A');
    assert.equal(b.data.Log[2][2], '');
    b.call('undoLast_', 'Budi');
    assert.equal(b.data.Log[3][2], '');
    assert.equal(b.data.Products[1][1], '');
  }
});

test('log names are fixed snapshots and undo retains the original transaction name', () => {
  const b = backend();
  b.call('createProduct_', 'Budi', '00123', 'Original', 'IN', 2, 'Rak A');
  b.data.Products[1][1] = 'Renamed';
  assert.equal(b.data.Log[1][2], 'Original');
  b.call('scan_', 'Budi', '00123', 'IN', 1, 'Rak A');
  assert.equal(b.data.Log[2][2], 'Renamed');
  b.data.Products[1][1] = 'Renamed again';
  b.call('undoLast_', 'Budi');
  assert.equal(b.data.Log[3][2], 'Renamed');
  assert.equal(b.data.Log[1][2], 'Original');
});

test('stock is tracked per rack; OUT checks only the chosen rack; undo restores that rack', () => {
  const b = backend();
  b.call('createProduct_', 'Budi', '00123', 'Bag', 'IN', 5, 'Rak A');
  assert.equal(b.call('scan_', 'Budi', '00123', 'IN', 3, 'Rak B').qty, 3);
  assert.deepEqual({ ...b.call('lookup_', '00123').racks }, { 'Rak A': 5, 'Rak B': 3 });
  assert.equal(b.call('lookup_', '00123').total, 8);
  const tooMany = b.call('scan_', 'Budi', '00123', 'OUT', 4, 'Rak B');
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /Rak B/);
  const out = b.call('scan_', 'Budi', '00123', 'OUT', 2, 'Rak B');
  assert.deepEqual([out.qty, out.total, out.rack], [1, 6, 'Rak B']);
  assert.deepEqual(b.data.Log.at(-1).slice(1), ['00123', 'Bag', 'Rak B', 'OUT', -2, 1, 'Budi']);
  const undo = b.call('undoLast_', 'Budi');
  assert.deepEqual([undo.rack, undo.qty, undo.total], ['Rak B', 3, 8]);
  assert.deepEqual({ ...b.call('lookup_', '00123').racks }, { 'Rak A': 5, 'Rak B': 3 });
  assert.equal(b.locked(), false);
});

test('scans and new products without a valid rack are rejected without writes', () => {
  const b = backend();
  for (const rack of [undefined, '', 'Rak Z']) {
    assert.equal(b.call('createProduct_', 'Budi', '00123', 'Bag', 'IN', 5, rack).ok, false);
  }
  b.call('createProduct_', 'Budi', '00123', 'Bag', 'IN', 5, 'Rak A');
  for (const rack of [undefined, 'Rak Z']) {
    assert.equal(b.call('scan_', 'Budi', '00123', 'IN', 1, rack).ok, false);
  }
  assert.equal(b.data.Log.length, 2);
  assert.equal(b.locked(), false);
});

test('racks stop at the first blank header, so a notes column after a gap is not a rack', () => {
  const b = backend();
  b.data.Products[0].push('', 'Catatan');
  b.call('createProduct_', 'Budi', '00123', 'Bag', 'IN', 5, 'Rak A');
  assert.deepEqual(b.data.Products[1], ['00123', 'Bag', '=SUM(D2:E2)', 5, 0]);
  assert.deepEqual(Object.keys(b.call('lookup_', '00123').racks), ['Rak A', 'Rak B']);
  assert.equal(b.call('scan_', 'Budi', '00123', 'IN', 1, 'Catatan').ok, false);
});

test('Tambah rak adds a column after the last rack, zero-fills, widens Total, and refuses duplicates', () => {
  const b = backend();
  b.data.Products[0].push('', 'Catatan');
  b.call('createProduct_', 'Budi', '00123', 'Bag', 'IN', 5, 'Rak A');
  b.data.Products[1].push('', 'fragile');
  assert.equal(b.call('addRack_', 'rak b').ok, false);
  assert.equal(b.call('addRack_', '  ').ok, false);
  const res = b.call('addRack_', 'Rak C');
  assert.equal(res.ok, true);
  assert.deepEqual(b.data.Products[0], ['SKU', 'Name', 'Total', 'Rak A', 'Rak B', 'Rak C', '', 'Catatan']);
  assert.deepEqual(b.data.Products[1], ['00123', 'Bag', '=SUM(D2:F2)', 5, 0, 0, '', 'fragile']);
  assert.equal(b.call('scan_', 'Budi', '00123', 'IN', 2, 'Rak C').qty, 2);
  assert.equal(b.locked(), false);
});
