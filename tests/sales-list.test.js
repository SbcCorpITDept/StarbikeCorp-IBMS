'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B } = require('./fixtures');

const DISABLED = 'Create Sale is no longer supported. Use Unit Release.';

function withOneRelease() {
  const app = loadApp(makeData({
    units: [{ mcid: 'MC-1', engineNo: 'ENG1', branch: BRANCH_A }],
    customers: [{ cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', branch: BRANCH_A }],
    headers: [['uuid-old', 'LEGACY-1', 'SALE', BRANCH_A, 'OLD BUYER', '09/15/2026', 'x', 'Completed', '', '']],
    details: [['uuid-old', 'LEGACY-1', 'MC-9', 'ENG9', 'CH9', 'M', 'MC']]
  }));
  const id = app.run('beginUnitRelease').transactionId;
  const res = app.run('createUnitRelease', {
    TransactionID: id, MCID: 'MC-1', CID: 'CID-1', Scope: BRANCH_A, SaleDate: '2026-10-02',
    AccountNo: 'ACC-1', ATRNo: 'ATR-1', SINo: 'SI-1', CreatedBy: 'clerk'
  });
  assert.equal(res.success, true);
  return { app, id };
}

test('getSales joins SALES and the single detail row, newest first', () => {
  const { app, id } = withOneRelease();
  assert.deepEqual(app.run('getSales', BRANCH_A), [
    { transactionNo: 'SALE-SI-1', transactionId: id, date: '10/02/2026', customer: 'DELA CRUZ, JUAN',
      accountNo: 'ACC-1', siNo: 'SI-1', engineNo: 'ENG1', unitType: 'Brand-New', branch: BRANCH_A, status: 'Completed' },
    { transactionNo: 'LEGACY-1', transactionId: 'uuid-old', date: '09/15/2026', customer: 'OLD BUYER',
      accountNo: '', siNo: '', engineNo: 'ENG9', unitType: '', branch: BRANCH_A, status: 'Completed' }
  ]);
});

test('getSales is branch-scoped', () => {
  const { app } = withOneRelease();
  assert.deepEqual(app.run('getSales', BRANCH_B), []);
  assert.equal(app.run('getSales', 'ALL').length, 2);
});

test('legacy createSale is disabled and writes nothing', () => {
  const app = loadApp(makeData({ units: [{ mcid: 'MC-1', engineNo: 'ENG1' }] }));
  const res = app.run('createSale', { TransactionNo: 'S-1', Source: BRANCH_A, Units: [{ MCID: 'MC-1' }] });
  assert.deepEqual(res, { success: false, message: DISABLED });
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER')[1][7], 'Available');
});

test('createTransaction refuses SALE but still accepts RR', () => {
  const app = loadApp(makeData({ units: [{ mcid: 'MC-1', engineNo: 'ENG1' }] }));
  const sale = app.run('createTransaction', { TransactionNo: 'S-2', TransactionType: ' sale ', Source: BRANCH_A, Details: [{ MCID: 'MC-1' }] });
  assert.deepEqual(sale, { success: false, message: DISABLED });
  assert.equal(app.rows('mc', 'MC_MASTER')[1][7], 'Available');
  assert.equal(app.run('createTransaction', { TransactionNo: 'RR-2', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-2' }] }).success, true);
});

test('testPhase2Write: legacy sale is rejected and the unit ends Available at branch B', () => {
  const app = loadApp(makeData());
  const out = app.run('testPhase2Write');
  assert.match(out, /Confirm IB-IN: \{"success":true/);
  assert.match(out, /Legacy SALE \(expect success:false\): \{"success":false/);
  const unit = app.run('getUnitProfile', 'TEST-MC-0001').unit;
  assert.deepEqual([unit.currentStatus, unit.currentBranch], ['Available', 'ZZ-TEST-B']);
});
