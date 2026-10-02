'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, SALES_HEADERS } = require('./fixtures');

const app = loadApp(makeData());

test('Config declares the SALES schema, UnitType column and CIR link headers', () => {
  assert.equal(app.get('sheetNameSales'), 'SALES');
  assert.deepEqual(app.get('MC_SCHEMA.SALES'), SALES_HEADERS);
  assert.equal(app.get('MC_SCHEMA.MC_MASTER[MC_SCHEMA.MC_MASTER.length - 1]'), 'UnitType');
  assert.equal(app.get('SALE_CIR_WRITEBACK'), false);
  assert.deepEqual(app.get('CIR_SALE_LINK_HEADERS'), ['SaleTransactionID', 'SaleSINo', 'SaleMCID']);
});

test('_normalizeUnitType accepts only known values', () => {
  const cases = {
    '': 'Brand-New', '   ': 'Brand-New', 'Brand-New': 'Brand-New', 'brand new': 'Brand-New',
    'BRAND-NEW': 'Brand-New', 'Brand  New': 'Brand-New',
    'repo': 'Repo', 'REPO': 'Repo', 'Repossessed': 'Repo', ' repossessed ': 'Repo',
    'Demo': 'Invalid', 'used': 'Invalid', 'brand_new': 'Invalid', 'Repo unit': 'Invalid'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(app.run('_normalizeUnitType', input), expected, JSON.stringify(input));
  }
  assert.equal(app.run('_normalizeUnitType', null), 'Brand-New');
  assert.equal(app.run('_normalizeUnitType', undefined), 'Brand-New');
});

test('_isApprovedStatus is case- and space-insensitive', () => {
  ['Approved', ' APPROVED ', 'approved'].forEach(v => assert.equal(app.run('_isApprovedStatus', v), true, v));
  ['For Approval', 'Disapproved', 'Rejected', ''].forEach(v => assert.equal(app.run('_isApprovedStatus', v), false, v));
});

test('_isMakerApplicant accepts Maker and excludes every Co-Maker spelling', () => {
  ['Maker', 'MAKER', ' maker '].forEach(v => assert.equal(app.run('_isMakerApplicant', v), true, v));
  ['Co-Maker', 'co_maker', 'CO MAKER', 'Comaker', ''].forEach(v => assert.equal(app.run('_isMakerApplicant', v), false, v));
});

test('_requiredSaleDocs depends on the unit type', () => {
  assert.deepEqual(app.run('_requiredSaleDocs', 'Brand-New'), ['ATRNo', 'SINo']);
  assert.deepEqual(app.run('_requiredSaleDocs', 'Repo'), ['RCINo', 'SINo']);
  assert.deepEqual(app.run('_requiredSaleDocs', 'Invalid'), []);
});

test('_saleTransactionNo prefixes the trimmed SI number', () => {
  assert.equal(app.run('_saleTransactionNo', ' SI-0001 '), 'SALE-SI-0001');
  assert.equal(app.run('_saleTransactionNo', 12345), 'SALE-12345');
});
