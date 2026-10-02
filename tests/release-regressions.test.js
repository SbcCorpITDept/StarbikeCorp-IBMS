'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B, SALES_HEADERS } = require('./fixtures');

function fixture(options) {
  const app = loadApp(makeData(Object.assign({
    units: [{ mcid: 'MC-1', engineNo: 'ENG1', branch: BRANCH_A }],
    customers: [{ cid: 'CID-1', branch: BRANCH_A }]
  }, options)));
  const payload = {
    TransactionID: app.run('beginUnitRelease').transactionId, MCID: 'MC-1', CID: 'CID-1',
    Scope: BRANCH_A, SaleDate: '2026-10-02', AccountNo: 'ACC-1', ATRNo: 'ATR-1', SINo: 'SI-1'
  };
  return { app, payload };
}
const snapshot = app => ['MC_MASTER', 'TRANSACTION_HEADER', 'TRANSACTION_DETAILS', 'MC_MOVEMENTS', 'SALES']
  .map(name => app.rows('mc', name));

test('a blank inventory status cannot be released as Available', () => {
  const { app, payload } = fixture();
  app.book('mc').getSheetByName('MC_MASTER').getRange(2, 8).setValue('');
  const before = snapshot(app);
  assert.equal(app.run('createUnitRelease', payload).success, false);
  assert.deepEqual(snapshot(app), before);
});

test('release writes only status and timestamp in the existing master row', () => {
  const { app, payload } = fixture();
  const master = app.book('mc').getSheetByName('MC_MASTER');
  master.getRange(2, 7).setValue(' ' + BRANCH_A + ' ');
  const writes = [];
  const originalSet = master._set.bind(master);
  master._set = (r, c, v) => { writes.push(c); originalSet(r, c, v); };
  assert.equal(app.run('createUnitRelease', payload).success, true);
  assert.deepEqual(writes.sort((a, b) => a - b), [8, 11]);
  assert.equal(app.rows('mc', 'MC_MASTER')[1][6], ' ' + BRANCH_A + ' ');
});

test('first release initializes an existing but empty SALES sheet', () => {
  const { app, payload } = fixture();
  app.book('mc').getSheetByName('SALES').rows = [];
  assert.equal(app.run('createUnitRelease', payload).success, true);
  assert.deepEqual(app.rows('mc', 'SALES')[0], SALES_HEADERS);
  assert.equal(app.rows('mc', 'SALES')[1][2], 'CID-1');
});

test('schema setup writes only blank UnitType cells', () => {
  const { app } = fixture({ units: [
    { mcid: 'MC-1', engineNo: 'ENG1' },
    { mcid: 'MC-2', engineNo: 'ENG2', unitType: 'Repo' }
  ] });
  const master = app.book('mc').getSheetByName('MC_MASTER');
  const writes = [];
  const originalSet = master._set.bind(master);
  master._set = (r, c, v) => { writes.push([r, c]); originalSet(r, c, v); };
  app.run('setupSalesSchema');
  assert.deepEqual(writes, [[2, 12]]);
});

test('every rejected release leaves all sheets and its issuance token unchanged', () => {
  const changes = [
    { MCID: ['MC-1'] }, { CID: ['CID-1'] }, { MCID: 'missing' }, { CID: 'missing' },
    { Scope: '' }, { Scope: BRANCH_B }, { SaleDate: 'not-a-date' },
    { AccountNo: '' }, { ATRNo: '' }, { SINo: '' }, { TransactionID: 'unissued' }
  ];
  for (const change of changes) {
    const { app, payload } = fixture({ withSalesSheet: false });
    const before = snapshot(app);
    assert.equal(app.run('createUnitRelease', Object.assign({}, payload, change)).success, false);
    assert.deepEqual(snapshot(app), before);
    assert.equal(app.cache.has('UR_TXN_' + payload.TransactionID), true);
    assert.equal(app.lock.waits, app.lock.releases);
  }
});

test('a partial sheet failure releases the lock and rejects replay of the transaction', () => {
  const { app, payload } = fixture();
  const details = app.book('mc').getSheetByName('TRANSACTION_DETAILS');
  details.appendRow = () => { throw new Error('Simulated sheet outage'); };
  const failed = app.run('createUnitRelease', payload);
  assert.equal(failed.success, false);
  assert.match(failed.message, /Simulated sheet outage/);
  assert.equal(app.lock.waits, app.lock.releases);
  assert.match(app.run('createUnitRelease', payload).message, /form has expired/);
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 2);
});

test('transfer receipt and cancellation keep their existing state transitions', () => {
  const app = loadApp(makeData({ units: [{ mcid: 'MC-1', engineNo: 'ENG1' }] }));
  assert.equal(app.run('createIBOut', { TransactionNo: 'IB-1', Source: BRANCH_A, Destination: BRANCH_B, Units: [{ MCID: 'MC-1' }] }).success, true);
  assert.equal(app.rows('mc', 'MC_MASTER')[1][7], 'In Transit');
  assert.equal(app.run('confirmIBIn', { IBOutNo: 'IB-1', IBInNo: 'wrong' }).success, false);
  assert.equal(app.run('confirmIBIn', { IBOutNo: 'IB-1', IBInNo: 'IB-1' }).success, true);
  assert.deepEqual(app.rows('mc', 'MC_MASTER')[1].slice(6, 8), [BRANCH_B, 'Available']);
  assert.equal(app.run('cancelIBOut', { IBOutNo: 'IB-1' }).success, false);
  assert.equal(app.run('createIBOut', { TransactionNo: 'IB-2', Source: BRANCH_B, Destination: BRANCH_A, Units: [{ MCID: 'MC-1' }] }).success, true);
  assert.equal(app.run('cancelIBOut', { IBOutNo: 'IB-2', Reason: 'Test cancellation' }).success, true);
  assert.deepEqual(app.rows('mc', 'MC_MASTER')[1].slice(6, 8), [BRANCH_B, 'Available']);
  assert.equal(app.rows('mc', 'MC_MOVEMENTS').at(-1)[3], 'IB-CANCEL');
  assert.equal(app.run('cancelIBOut', { IBOutNo: 'IB-2' }).success, false);
});

test('malformed SALES headers, wildcard branches and non-string IDs fail without writes', () => {
  for (const change of [{ MCID: 1 }, { CID: {} }, { MCID: 'MC-1,MC-2' }]) {
    const { app, payload } = fixture();
    const before = snapshot(app);
    assert.match(app.run('createUnitRelease', Object.assign({}, payload, change)).message, /exactly one/);
    assert.deepEqual(snapshot(app), before);
  }
  const badSchema = fixture();
  badSchema.app.book('mc').getSheetByName('SALES').getRange(1, 3).setValue('WrongCID');
  const before = snapshot(badSchema.app);
  assert.match(badSchema.app.run('createUnitRelease', badSchema.payload).message, /SALES headers/);
  assert.deepEqual(snapshot(badSchema.app), before);
  const allBranch = fixture({ units: [{ mcid: 'MC-1', engineNo: 'ENG1', branch: 'ALL' }] });
  assert.match(allBranch.app.run('createUnitRelease', allBranch.payload).message, /no Current Branch/);
});

test('ambiguous duplicate MCIDs cannot mark an arbitrary row Sold', () => {
  const { app, payload } = fixture({ units: [
    { mcid: 'MC-1', engineNo: 'ENG1' }, { mcid: 'mc-1', engineNo: 'ENG2' }
  ] });
  const before = snapshot(app);
  assert.match(app.run('createUnitRelease', payload).message, /Duplicate MCID/);
  assert.deepEqual(snapshot(app), before);
});

test('schema setup initializes an empty SALES sheet without creating duplicates', () => {
  const { app } = fixture();
  app.book('mc').getSheetByName('SALES').rows = [];
  app.run('setupSalesSchema');
  app.run('setupSalesSchema');
  assert.deepEqual(app.rows('mc', 'SALES'), [SALES_HEADERS]);
});

test('issuance lasts six hours and expiry rejects without any sheet writes', () => {
  const { app, payload } = fixture();
  assert.equal(app.cacheTTLs.get('UR_TXN_' + payload.TransactionID), 21600);
  app.advanceTime(21601);
  const before = snapshot(app);
  assert.match(app.run('createUnitRelease', payload).message, /form has expired/);
  assert.deepEqual(snapshot(app), before);
});

test('all release sheet writes occur while the same script lock is held', () => {
  const { app, payload } = fixture();
  for (const name of ['MC_MASTER', 'SALES', 'TRANSACTION_HEADER', 'TRANSACTION_DETAILS', 'MC_MOVEMENTS']) {
    const sheet = app.book('mc').getSheetByName(name);
    for (const method of ['_set', 'appendRow']) {
      const original = sheet[method].bind(sheet);
      sheet[method] = (...args) => { assert.equal(app.lock.held, true, name + '.' + method); return original(...args); };
    }
  }
  assert.equal(app.run('createUnitRelease', payload).success, true);
  assert.equal(app.lock.waits, 1);
  assert.equal(app.lock.held, false);
});
