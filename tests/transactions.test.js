'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

const rr = extra => Object.assign({
  TransactionNo: 'RR-7', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-7' }]
}, extra || {});

test('createTransaction uses a provided TransactionID', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', rr({ TransactionID: 'server-issued-1' }));
  assert.equal(res.transactionId, 'server-issued-1');
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER')[1][0], 'server-issued-1');
  assert.equal(app.rows('mc', 'TRANSACTION_DETAILS')[1][0], 'server-issued-1');
});

test('createTransaction still mints a TransactionID when none is given', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', rr());
  assert.match(res.transactionId, /^uuid-\d+$/);
});

test('_writeTransaction writes without taking the script lock', () => {
  const app = loadApp(makeData());
  const ss = app.fn('_mcSS')();
  const res = app.fn('_writeTransaction')(ss, rr({ TransactionID: 'tx-9' }));
  assert.equal(res.success, true);
  assert.equal(res.transactionId, 'tx-9');
  assert.equal(app.lock.waits, 0);
});
