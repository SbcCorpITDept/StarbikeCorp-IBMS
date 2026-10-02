'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, SALES_HEADERS } = require('./fixtures');

test('setupSalesSchema creates SALES, backfills UnitType and adds CIR headers only', () => {
  const app = loadApp(makeData({
    withUnitType: false, withSalesSheet: false,
    units: [{ mcid: 'MC-1', engineNo: 'E1' }, { mcid: 'MC-2', engineNo: 'E2' }],
    customers: [{ cid: 'CID-1' }]
  }));
  // A stray row without an MCID must not receive a UnitType.
  app.book('mc').getSheetByName('MC_MASTER').appendRow(['', '', '', '', '', '', '', '', '', '', '']);

  const report = app.run('setupSalesSchema');

  assert.deepEqual(app.rows('mc', 'SALES'), [SALES_HEADERS]);
  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master[0][11], 'UnitType');
  assert.equal(master[1][11], 'Brand-New');
  assert.equal(master[2][11], 'Brand-New');
  assert.equal(master[3][11] || '', '');

  const cir = app.rows('main', 'CIR_Database');
  assert.deepEqual(cir[0].slice(-3), ['SaleTransactionID', 'SaleSINo', 'SaleMCID']);
  assert.equal(cir[1].length, 9, 'no values are written under the new CIR headers');
  assert.match(report, /CREATED  SALES/);
});

test('setupSalesSchema is safe to re-run and keeps existing UnitType values', () => {
  const app = loadApp(makeData({
    units: [{ mcid: 'MC-1', engineNo: 'E1', unitType: 'Repo' }, { mcid: 'MC-2', engineNo: 'E2' }],
    customers: [{ cid: 'CID-1' }]
  }));
  app.run('setupSalesSchema');
  app.run('setupSalesSchema');

  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master[0].filter(h => h === 'UnitType').length, 1);
  assert.equal(master[1][11], 'Repo');
  assert.equal(master[2][11], 'Brand-New');
  assert.equal(app.rows('mc', 'SALES').length, 1);
  assert.equal(app.rows('main', 'CIR_Database')[0].filter(h => h === 'SaleSINo').length, 1);
});
