'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

test('testUnitReleaseFlow passes on fake sheets and cleanup removes its rows', () => {
  const app = loadApp(makeData({ customers: [{ cid: 'CID-1', aid: 'AID-1', branch: BRANCH_A }] }));
  const cirBefore = app.rows('main', 'CIR_Database');

  const out = app.run('testUnitReleaseFlow', 'CID-1');
  assert.doesNotMatch(out, /FAIL/);
  assert.equal((out.match(/^PASS /gm) || []).length, 14);

  const report = app.run('cleanupUnitReleaseTest');
  assert.match(report, /removed rows/);
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'TRANSACTION_DETAILS').length, 1);
  assert.equal(app.rows('mc', 'MC_MOVEMENTS').length, 1);
  assert.equal(app.rows('mc', 'SALES').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER').length, 1);
  assert.deepEqual(app.rows('main', 'CIR_Database'), cirBefore);
});

test('testUnitReleaseFlow explains a missing CID', () => {
  const app = loadApp(makeData());
  assert.throws(() => app.fn('testUnitReleaseFlow')(''), /Set _UR_TEST_CID/);
  assert.throws(() => app.fn('testUnitReleaseFlow')('CID-404'), /not found/);
});

test('cleanupPhase2Test still removes the Phase 2 test rows', () => {
  const app = loadApp(makeData());
  app.run('testPhase2Write');
  app.run('cleanupPhase2Test');
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER').length, 1);
});

test('editor diagnostic refuses an ineligible customer before creating test rows', () => {
  const app = loadApp(makeData({ customers: [{ cid: 'CID-1', applicant: 'Co-Maker' }] }));
  assert.throws(() => app.fn('testUnitReleaseFlow')('CID-1'), /approved Maker/);
  assert.equal(app.rows('mc', 'MC_MASTER').length, 1);
});
