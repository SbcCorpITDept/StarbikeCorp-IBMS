'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B } = require('./fixtures');

test('available units carry a normalized unitType and the raw cell text', () => {
  const app = loadApp(makeData({ units: [
    { mcid: 'MC-1', engineNo: 'E1', unitType: '' },
    { mcid: 'MC-2', engineNo: 'E2', unitType: 'repossessed' },
    { mcid: 'MC-3', engineNo: 'E3', unitType: 'Demo' }
  ] }));
  const units = app.run('getAvailableUnits', BRANCH_A);
  assert.deepEqual(units.map(u => [u.mcid, u.unitType, u.unitTypeRaw]),
    [['MC-1', 'Brand-New', ''], ['MC-2', 'Repo', 'repossessed'], ['MC-3', 'Invalid', 'Demo']]);
});

test('units read as Brand-New when MC_MASTER has no UnitType column yet', () => {
  const app = loadApp(makeData({ withUnitType: false, units: [{ mcid: 'MC-1', engineNo: 'E1' }] }));
  const [u] = app.run('getAvailableUnits', BRANCH_A);
  assert.equal(u.unitType, 'Brand-New');
  assert.equal(u.unitTypeRaw, '');
});

const customers = [
  { cid: 'CID-1', aid: 'AID-777', name: 'SANTOS, ANA', contact: '0917-1', address: 'NAGA' },
  { cid: 'CID-2', applicant: 'Co-Maker', name: 'CO MAKER, ONE' },
  { cid: 'CID-3', status: 'For Approval', name: 'PENDING, ONE' },
  { cid: 'CID-4', branch: BRANCH_B, name: 'OTHER BRANCH, ONE' },
  { cid: 'CID-5', status: ' APPROVED ', applicant: 'MAKER', name: 'ABAD, BEN' },
  { cid: 'CID-6', name: 'ALREADY SOLD, ONE' },
  { cid: 'CID-7', applicant: 'co_maker', name: 'CO MAKER, TWO' },
  { cid: '', name: 'NO CID, ONE' }
];

test('getSaleCustomers applies branch, Approved, Maker and not-sold rules', () => {
  const app = loadApp(makeData({ customers, sales: [{ transactionId: 'old-1', cid: 'cid-6', siNo: 'SI-OLD' }] }));
  const rows = app.run('getSaleCustomers', BRANCH_A);
  assert.deepEqual(rows.map(c => c.cid), ['CID-5', 'CID-1']);   // sorted by name
  assert.deepEqual(rows[1], { cid: 'CID-1', aid: 'AID-777', name: 'SANTOS, ANA', contact: '0917-1', address: 'NAGA' });
});

test('getSaleCustomers matches the branch case-insensitively', () => {
  const app = loadApp(makeData({ customers }));
  assert.deepEqual(app.run('getSaleCustomers', BRANCH_A.toUpperCase()).map(c => c.cid).sort(), ['CID-1', 'CID-5', 'CID-6']);
});

test('getSaleCustomers returns nothing without a specific branch', () => {
  const app = loadApp(makeData({ customers }));
  assert.deepEqual(app.run('getSaleCustomers', 'ALL'), []);
  assert.deepEqual(app.run('getSaleCustomers', ''), []);
  assert.deepEqual(app.run('getSaleCustomers'), []);
});

test('getSaleCustomers works when SALES sheet is missing', () => {
  const app = loadApp(makeData({ customers, withSalesSheet: false }));
  assert.deepEqual(app.run('getSaleCustomers', BRANCH_A).map(c => c.cid).sort(), ['CID-1', 'CID-5', 'CID-6']);
});
