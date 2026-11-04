const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function backend() {
  const data = { Products: [['SKU', 'Name', 'Qty']], Log: [['Time', 'SKU', 'Name', 'Mode', 'Change', 'Qty after', 'User']] };
  let held = false;
  const sheets = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, {
    getLastRow: () => rows.length,
    getRange: (row, col, height = 1, width = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      getValue: () => rows[row - 1]?.[col - 1],
      setValue: value => { rows[row - 1][col - 1] = value; },
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
  const res = b.call('createProduct_', 'Budi', '00123', '=Sample', 'IN', 5);
  assert.equal(res.ok, true);
  assert.deepEqual(b.data.Products[1], ['00123', '=Sample', 5]);
  assert.deepEqual(b.data.Log[1].slice(1), ['00123', '=Sample', 'IN', 5, 5, 'Budi']);
  assert.equal(b.locked(), false);
  assert.equal(b.call('lookup_', '00123').qty, 5);
  assert.equal(b.call('undoLast_', 'Budi').qty, 0);
  assert.equal(b.data.Products.length, 2);
});

test('duplicate or repeated creation never increments stock or adds another row/log', () => {
  const b = backend();
  b.call('createProduct_', 'Budi', '00123', 'First', 'IN', 5);
  const duplicate = b.call('createProduct_', 'Other staff', '00123', 'Different', 'IN', 9);
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.name, 'First');
  assert.equal(duplicate.qty, 5);
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
    assert.equal(b.call('createProduct_', 'Budi', sku, name, mode, amount).ok, false);
    assert.equal(b.data.Products.length, 1);
    assert.equal(b.data.Log.length, 1);
  }
});

test('empty product names stay blank in creation, scan, and undo logs', () => {
  for (const name of [undefined, '', '   ']) {
    const b = backend();
    const res = b.call('createProduct_', 'Budi', '00123', name, 'IN', 2);
    assert.equal(res.ok, true);
    assert.equal(res.name, '');
    assert.deepEqual(b.data.Products[1], ['00123', '', 2]);
    assert.equal(b.data.Log[1][2], '');
    b.call('scan_', 'Budi', '00123', 'IN', 3);
    assert.equal(b.data.Log[2][2], '');
    b.call('undoLast_', 'Budi');
    assert.equal(b.data.Log[3][2], '');
    assert.equal(b.data.Products[1][1], '');
  }
});

test('log names are fixed snapshots and undo retains the original transaction name', () => {
  const b = backend();
  b.call('createProduct_', 'Budi', '00123', 'Original', 'IN', 2);
  b.data.Products[1][1] = 'Renamed';
  assert.equal(b.data.Log[1][2], 'Original');
  b.call('scan_', 'Budi', '00123', 'IN', 1);
  assert.equal(b.data.Log[2][2], 'Renamed');
  b.data.Products[1][1] = 'Renamed again';
  b.call('undoLast_', 'Budi');
  assert.equal(b.data.Log[3][2], 'Renamed');
  assert.equal(b.data.Log[1][2], 'Original');
});
