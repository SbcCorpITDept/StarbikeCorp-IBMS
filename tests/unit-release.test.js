'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B, SALES_HEADERS } = require('./fixtures');

const EXPIRED = 'This release form has expired. Please start a new Unit Release.';
const ONE_EACH = 'A Unit Release must contain exactly one motorcycle and one customer.';

function setup(extra) {
  const app = loadApp(makeData(Object.assign({
    units: [
      { mcid: 'MC-1', engineNo: 'ENG1', branch: BRANCH_A, unitType: '' },
      { mcid: 'MC-2', engineNo: 'ENG2', branch: BRANCH_A, unitType: 'Repo' },
      { mcid: 'MC-3', engineNo: 'ENG3', branch: BRANCH_B, unitType: 'Brand-New' },
      { mcid: 'MC-4', engineNo: 'ENG4', branch: BRANCH_A, unitType: 'Demo' },
      { mcid: 'MC-5', engineNo: 'ENG5', branch: BRANCH_A, status: 'Sold' },
      { mcid: 'MC-6', engineNo: 'ENG6', branch: '' }
    ],
    customers: [
      { cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', contact: '09170000001', address: 'NAGA CITY', branch: BRANCH_A },
      { cid: 'CID-2', aid: 'AID-2', name: 'SANTOS, ANA', branch: BRANCH_A },
      { cid: 'CID-3', aid: 'AID-3', name: 'REYES, MARK', branch: BRANCH_B },
      { cid: 'CID-4', applicant: 'Co-Maker', name: 'CO, MAKER', branch: BRANCH_A }
    ]
  }, extra || {})));
  const id = app.run('beginUnitRelease').transactionId;
  const payload = {
    TransactionID: id, MCID: 'MC-1', CID: 'CID-1', Scope: BRANCH_A, SaleDate: '2026-10-02',
    AccountNo: 'ACC-1', ATRNo: 'ATR-1', SINo: 'SI-1', RCINo: '', CreatedBy: 'clerk@sbc.test'
  };
  return { app, id, payload, with: over => Object.assign({}, payload, over) };
}

test('beginUnitRelease issues a cached Transaction ID', () => {
  const { app, id } = setup();
  assert.match(id, /^uuid-\d+$/);
  assert.equal(app.cache.get('UR_TXN_' + id), '1');
});

test('a Brand-New release writes header, detail, movement, SALES and marks the unit Sold', () => {
  const { app, id, payload } = setup();
  const cirBefore = app.rows('main', 'CIR_Database');
  const masterRowsBefore = app.rows('mc', 'MC_MASTER').length;

  const res = app.run('createUnitRelease', payload);
  assert.deepEqual(res, { success: true, transactionId: id, transactionNo: 'SALE-SI-1' });

  assert.deepEqual(app.rows('mc', 'TRANSACTION_HEADER')[1],
    [id, 'SALE-SI-1', 'SALE', BRANCH_A, 'DELA CRUZ, JUAN', '10/02/2026', 'clerk@sbc.test', 'Completed', '', '']);
  assert.deepEqual(app.rows('mc', 'TRANSACTION_DETAILS')[1], [id, 'SALE-SI-1', 'MC-1', 'ENG1', 'CH-ENG1', 'XRM125', 'XRM-01']);
  const move = app.rows('mc', 'MC_MOVEMENTS')[1];
  assert.deepEqual([move[1], move[2], move[3], move[4], move[5]], ['MC-1', 'SALE-SI-1', 'SALE', BRANCH_A, 'CUSTOMER']);

  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master.length, masterRowsBefore, 'unit is not deleted');
  assert.deepEqual([master[1][0], master[1][6], master[1][7]], ['MC-1', BRANCH_A, 'Sold']);

  assert.deepEqual(app.rows('mc', 'SALES')[1],
    [id, 'ACC-1', 'CID-1', 'AID-1', 'DELA CRUZ, JUAN', '09170000001', 'NAGA CITY', 'Brand-New', 'ATR-1', 'SI-1', '']);
  assert.equal(app.cache.has('UR_TXN_' + id), false, 'Transaction ID is consumed');
  assert.deepEqual(app.rows('main', 'CIR_Database'), cirBefore, 'CIR_Database is never written');
  assert.equal(app.lock.waits, 1);
  assert.equal(app.lock.releases, 1);
});

test('a Repo release requires RCI No. and stores ATR No. blank', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', RCINo: '' })).message, 'RCI No. is required.');
  const ok = s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', RCINo: 'RCI-9', ATRNo: 'IGNORED' }));
  assert.equal(ok.success, true);
  const sale = s.app.rows('mc', 'SALES')[1];
  assert.deepEqual([sale[7], sale[8], sale[9], sale[10]], ['Repo', '', 'SI-1', 'RCI-9']);
});

test('a Brand-New release requires ATR No. and stores RCI No. blank', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ ATRNo: '  ' })).message, 'ATR No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ RCINo: 'IGNORED' })).success, true);
  assert.equal(s.app.rows('mc', 'SALES')[1][10], '');
});

test('required sale fields are enforced', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ SINo: '' })).message, 'SI No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ AccountNo: ' ' })).message, 'Account No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ SaleDate: '' })).message, 'Date of Sale is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ SaleDate: 'not-a-date' })).message, 'Date of Sale is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: '' })).message, 'Motorcycle is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: '' })).message, 'Customer is required.');
  assert.equal(s.app.rows('mc', 'TRANSACTION_HEADER').length, 1, 'nothing written');
});

test('an unissued or already-used Transaction ID is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ TransactionID: 'made-up' })).message, EXPIRED);
  assert.equal(s.app.run('createUnitRelease', s.with({ TransactionID: '' })).message, EXPIRED);
  s.app.book('mc').getSheetByName('TRANSACTION_HEADER').appendRow([s.id, 'X-1', 'RR', '', BRANCH_A, '', '', 'Completed', '', '']);
  assert.equal(s.app.run('createUnitRelease', s.payload).message, EXPIRED);
});

test('second submit with the same Transaction ID is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', CID: 'CID-2', RCINo: 'R', SINo: 'SI-2' })).message, EXPIRED);
  assert.equal(s.app.rows('mc', 'SALES').length, 2);
});

test('rejects arrays for MCID or CID', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: ['MC-1'] })).message, ONE_EACH);
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: ['MC-1', 'MC-2'] })).message, ONE_EACH);
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: ['CID-1'] })).message, ONE_EACH);
});

test('rejects a unit that is not Available, unknown, or of an unrecognized type', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-5' })).message, 'Unit ENG5 is no longer Available (status: Sold).');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-404' })).message, 'Unit MC-404 was not found in MC_MASTER.');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-4' })).message,
    'Unit ENG4 has an unrecognized Unit Type "Demo". Set it to Brand-New or Repo in MC_MASTER.');
});

test('rejects a unit with no Current Branch', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({ MCID: 'MC-6', Scope: 'ALL' }));
  assert.equal(res.message, 'Unit ENG6 has no Current Branch in MC_MASTER.');
});

test('branch scope: restricted users only release their own units; ALL may release any', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: BRANCH_B })).message, 'This unit does not belong to your branch.');
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: '' })).message, 'Your account has no branch scope. Please sign in again.');
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: BRANCH_A.toLowerCase() })).success, true);

  const t = setup();
  assert.equal(t.app.run('createUnitRelease', t.with({ Scope: 'ALL' })).success, true);
});

test('customer must be an approved Maker at the unit branch', () => {
  const s = setup();
  // ALL user: Branch A unit + Branch B customer is not allowed.
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: 'ALL', CID: 'CID-3' })).message,
    'Customer CID-3 is not an approved Maker at ' + BRANCH_A + '.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: 'CID-4' })).message,
    'Customer CID-4 is not an approved Maker at ' + BRANCH_A + '.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: 'CID-404' })).message,
    'Customer CID-404 is not an approved Maker at ' + BRANCH_A + '.');
});

test('a customer who already has a unit is rejected (CID is the duplicate key)', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const id2 = s.app.run('beginUnitRelease').transactionId;
  const res = s.app.run('createUnitRelease', s.with({ TransactionID: id2, MCID: 'MC-2', RCINo: 'R', SINo: 'SI-2', CID: 'cid-1' }));
  assert.equal(res.message, 'Customer CID-1 already has a Unit Release (SALE-SI-1).');
});

test('a duplicate SI number is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const id2 = s.app.run('beginUnitRelease').transactionId;
  const res = s.app.run('createUnitRelease', s.with({ TransactionID: id2, MCID: 'MC-2', CID: 'CID-2', RCINo: 'R', SINo: 'si-1' }));
  assert.equal(res.message, 'SI No. si-1 is already used by SALE-si-1.');
});

test('trims and case-folds MCID and CID from the browser', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({ MCID: ' mc-1 ', CID: ' cid-1 ' }));
  assert.equal(res.success, true);
  assert.equal(s.app.rows('mc', 'SALES')[1][2], 'CID-1');
});

test('browser-supplied branch, customer and unit details are ignored', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({
    Branch: BRANCH_B, Source: BRANCH_B, CustomerName: 'HACKER', ContactNo: '000', EngineNo: 'FAKE', UnitType: 'Repo'
  }));
  assert.equal(res.success, true);
  const header = s.app.rows('mc', 'TRANSACTION_HEADER')[1];
  assert.deepEqual([header[3], header[4]], [BRANCH_A, 'DELA CRUZ, JUAN']);
  const sale = s.app.rows('mc', 'SALES')[1];
  assert.deepEqual([sale[5], sale[7]], ['09170000001', 'Brand-New']);
});

test('CreatedBy falls back to System when blank', () => {
  const s = setup();
  s.app.run('createUnitRelease', s.with({ CreatedBy: '' }));
  assert.equal(s.app.rows('mc', 'TRANSACTION_HEADER')[1][6], 'System');
});

test('the first release creates the SALES sheet when SALES sheet is missing', () => {
  const s = setup({ withSalesSheet: false });
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const sales = s.app.rows('mc', 'SALES');
  assert.deepEqual(sales[0], SALES_HEADERS);
  assert.equal(sales[1][0], s.id);
});
