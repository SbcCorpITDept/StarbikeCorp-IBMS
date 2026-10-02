'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

test('createTransaction RR writes header, details, movement and MC_MASTER', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', {
    TransactionNo: 'RR-100', TransactionType: 'RR', Source: 'HONDA', Destination: BRANCH_A,
    TransactionDate: '2026-10-01', CreatedBy: 'tester',
    Details: [{ MCID: 'MC-1', EngineNo: 'ENG1', ChassisNo: 'CHS1', Model: 'XRM125', ModelCode: 'X1', Color: 'RED' }]
  });
  assert.equal(res.success, true);
  assert.equal(res.transactionNo, 'RR-100');

  const header = app.rows('mc', 'TRANSACTION_HEADER');
  assert.deepEqual(header[1], [res.transactionId, 'RR-100', 'RR', 'HONDA', BRANCH_A, '10/01/2026', 'tester', 'Completed', '', '']);
  assert.deepEqual(app.rows('mc', 'TRANSACTION_DETAILS')[1], [res.transactionId, 'RR-100', 'MC-1', 'ENG1', 'CHS1', 'XRM125', 'X1']);

  const move = app.rows('mc', 'MC_MOVEMENTS')[1];
  assert.deepEqual([move[1], move[2], move[3], move[4], move[5]], ['MC-1', 'RR-100', 'RR', 'HONDA', BRANCH_A]);

  const master = app.rows('mc', 'MC_MASTER')[1];
  assert.deepEqual([master[0], master[6], master[7], master[8]], ['MC-1', BRANCH_A, 'Available', 'RR-100']);
  assert.equal(app.lock.waits, 1);
  assert.equal(app.lock.releases, 1);
});

test('createTransaction rejects a duplicate TransactionNo', () => {
  const app = loadApp(makeData());
  const tx = { TransactionNo: 'RR-1', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-1' }] };
  assert.equal(app.run('createTransaction', tx).success, true);
  const again = app.run('createTransaction', tx);
  assert.equal(again.success, false);
  assert.match(again.message, /already exists/);
});
