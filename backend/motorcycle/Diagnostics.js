// Diagnostics.js - Existing sheet diagnostics and manual lifecycle test/cleanup functions.
// Apps Script server files share one global scope; no imports are required.

function getMCSheetInfo() {
  try {
    const ss = SpreadsheetApp.openById('18yDG_RlaTWhx_ZkWiCxy8en5dryfrDC9crn1tU4_tW8');
    const parent = ss.getSheetByName('Mc_Delivery');
    const child = ss.getSheetByName('Mc_Inventory');
    const res = { parent: null, child: null };
    if (parent) {
      const d = parent.getDataRange().getDisplayValues();
      res.parent = { headers: d[0] || [], firstRows: d.slice(1, 6) };
    }
    if (child) {
      const d = child.getDataRange().getDisplayValues();
      res.child = { headers: d[0] || [], firstRows: d.slice(1, 6) };
    }
    return res;
  } catch (e) {
    console.error('getMCSheetInfo error', e.toString());
    return { error: e.toString() };
  }
}



// Quick self-test for Phase 2 (Run ▸ testPhase2, then check Logs).
function testPhase2() {
  Logger.log('Branches: ' + JSON.stringify(getBranches()));
  Logger.log('Inventory (ALL): ' + _readMCMaster('ALL').length + ' units');
  Logger.log('RR list (ALL): ' + JSON.stringify(getRRList('ALL')));
  Logger.log('Dashboard (ALL): ' + JSON.stringify(getInventoryDashboardStats('ALL')));
}

// ── Reversible end-to-end write test ────────────────────────────────────────
// Run ▸ testPhase2Write to exercise the full lifecycle on ONE dummy unit, then
// read back the result. All test rows use TEST- / ZZ-TEST identifiers so
// cleanupPhase2Test() can remove them afterward. Run cleanup when done.
const _TEST_MCID = 'TEST-MC-0001';
const _TEST_BR_A = 'ZZ-TEST-A';
const _TEST_BR_B = 'ZZ-TEST-B';

function testPhase2Write() {
  const log = [];
  const unit = { MCID: _TEST_MCID, EngineNo: 'TESTENG1', ChassisNo: 'TESTCHS1', Model: 'TESTMODEL', ModelCode: 'TM-01', Color: 'Red' };

  // 1) Receiving Report → unit Available at Branch A, OriginalRR set
  let r = createTransaction({ TransactionNo: 'TEST-RR-001', TransactionType: 'RR', Source: 'SUPPLIER', Destination: _TEST_BR_A, CreatedBy: 'tester', Details: [unit] });
  log.push('RR: ' + JSON.stringify(r));

  // 2) Duplicate No must be REJECTED
  let dup = createTransaction({ TransactionNo: 'TEST-RR-001', TransactionType: 'RR', Source: 'SUPPLIER', Destination: _TEST_BR_A, CreatedBy: 'tester', Details: [unit] });
  log.push('Duplicate guard (expect success:false): ' + JSON.stringify(dup));

  // 3) IB-OUT A→B → unit In Transit, transfer Pending
  r = createIBOut({ TransactionNo: 'TEST-IB-OUT-001', Source: _TEST_BR_A, Destination: _TEST_BR_B, CreatedBy: 'tester', Units: [{ MCID: _TEST_MCID }] });
  log.push('IB-OUT: ' + JSON.stringify(r));
  log.push('Pending queue @B: ' + JSON.stringify(getPendingTransfers(_TEST_BR_B)));

  // 4) Confirm receipt → creates IB-IN, unit Available at B, IB-OUT Completed
  // The IB-IN number must match the IB-OUT number (invoice-style).
  r = confirmIBIn({ IBOutNo: 'TEST-IB-OUT-001', IBInNo: 'TEST-IB-OUT-001', CreatedBy: 'tester' });
  log.push('Confirm IB-IN: ' + JSON.stringify(r));

  // 5) Legacy createSale is retired — must be REJECTED (Unit Release replaces it)
  r = createSale({ TransactionNo: 'TEST-SALE-001', CustomerName: 'Test Customer', Source: _TEST_BR_B, CreatedBy: 'tester', Units: [{ MCID: _TEST_MCID }] });
  log.push('Legacy SALE (expect success:false): ' + JSON.stringify(r));

  // 6) Read back current state + full timeline
  const profile = getUnitProfile(_TEST_MCID);
  log.push('FINAL unit: ' + JSON.stringify(profile.unit));
  log.push('TIMELINE (' + profile.timeline.length + ' moves): ' +
    JSON.stringify(profile.timeline.map(m => m.TransactionNo + ' ' + m.FromLocation + '→' + m.ToLocation)));

  const out = log.join('\n');
  Logger.log('testPhase2Write() results:\n' + out +
    '\n\nExpected: unit ends Available at ' + _TEST_BR_B + ', 3 moves (RR→IB-OUT→IB-IN), duplicate and legacy sale rejected.' +
    '\nRun cleanupPhase2Test() to remove all TEST rows.');
  return out;
}

// Deletes every row created by testPhase2Write() from all 4 data sheets.
function cleanupPhase2Test() {
  const ss = _mcSS();
  const testNos = ['TEST-RR-001', 'TEST-IB-OUT-001', 'TEST-IB-IN-001', 'TEST-SALE-001'];
  const removed = {
    TRANSACTION_HEADER:  _purgeTestRows(ss, 'TRANSACTION_HEADER',  'TransactionNo', testNos),
    TRANSACTION_DETAILS: _purgeTestRows(ss, 'TRANSACTION_DETAILS', 'TransactionNo', testNos),
    MC_MOVEMENTS:        _purgeTestRows(ss, 'MC_MOVEMENTS',        'TransactionNo', testNos),
    MC_MASTER:           _purgeTestRows(ss, 'MC_MASTER',           'MCID', [_TEST_MCID])
  };
  const report = 'cleanupPhase2Test() removed rows: ' + JSON.stringify(removed);
  Logger.log(report);
  return report;
}

// Deletes rows whose `header` column equals one of `values` (bottom-up so row
// indices stay valid). Returns the number of rows removed. Test cleanup only.
function _purgeTestRows(ss, sheetName, header, values) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const col = _headerMap(sheet)[header];
  if (col === undefined) return 0;
  const cells = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
  let count = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (values.indexOf((cells[i][0] || '').toString().trim()) !== -1) {
      sheet.deleteRow(i + 2);
      count++;
    }
  }
  return count;
}


// ── Unit Release end-to-end test (real sheets) ──────────────────────────────
// 1. Run setupSalesSchema() first.
// 2. Set _UR_TEST_CID to an Approved Maker CID that has no Unit Release yet.
// 3. Run ▸ testUnitReleaseFlow and read the Logs — every line should be PASS.
// 4. Run ▸ cleanupUnitReleaseTest to remove the test rows.
// The CIR row is only read, never written.
const _UR_TEST_CID = '';   // ← set before running from the editor
const _UR_TEST_MCIDS = ['TEST-MC-UR-0001', 'TEST-MC-UR-0002'];
const _UR_TEST_SI = 'TEST-UR-001';

function testUnitReleaseFlow(cid) {
  cid = (cid || _UR_TEST_CID || '').toString().trim();
  if (!cid) throw new Error('Set _UR_TEST_CID to an Approved Maker CID first.');
  const customer = _readCIRCustomers().find(c => c.cid === cid);
  if (!customer) throw new Error('CID ' + cid + ' not found in ' + sheetNameCIR + '.');

  if (!customer.branch || customer.branch.toUpperCase() === 'ALL' ||
      !_isEligibleCustomer(customer, customer.branch) || _soldCIDSet()[customer.cid.toLowerCase()]) {
    throw new Error('Choose an approved Maker at a specific branch with no existing Unit Release.');
  }
  const cir = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetNameCIR);
  const cirBefore = JSON.stringify(cir.getDataRange().getValues());
  const ss = _mcSS();
  _UR_TEST_MCIDS.forEach((mcid, i) => _upsertMCMaster(ss, {
    MCID: mcid, EngineNo: 'TESTURENG' + (i + 1), ChassisNo: 'TESTURCHS' + (i + 1), Model: 'TESTMODEL',
    ModelCode: 'TM-01', Color: 'RED', CurrentBranch: customer.branch, CurrentStatus: 'Available', OriginalRR: 'TEST-UR-RR'
  }));

  const log = [];
  const expect = (label, res, wantSuccess) =>
    log.push((!!(res && res.success) === wantSuccess ? 'PASS ' : 'FAIL ') + label + ': ' + JSON.stringify(res));
  const base = {
    MCID: _UR_TEST_MCIDS[0], CID: cid, Scope: 'ALL', SaleDate: _mcToday(), AccountNo: 'TEST-ACCT-1',
    ATRNo: 'TEST-ATR-1', SINo: _UR_TEST_SI, RCINo: '', CreatedBy: 'tester'
  };
  const id = beginUnitRelease().transactionId;
  const withId = extra => Object.assign({}, base, { TransactionID: id }, extra || {});

  expect('Unissued Transaction ID rejected', createUnitRelease(Object.assign({}, base, { TransactionID: 'not-issued' })), false);
  expect('Missing ATR No. rejected', createUnitRelease(withId({ ATRNo: '' })), false);
  expect('MCID array rejected', createUnitRelease(withId({ MCID: [_UR_TEST_MCIDS[0]] })), false);
  expect('CID array rejected', createUnitRelease(withId({ CID: [cid] })), false);
  expect('Legacy createSale rejected', createSale({ TransactionNo: 'TEST-UR-LEGACY', Source: customer.branch, Units: [{ MCID: _UR_TEST_MCIDS[0] }] }), false);

  _setMasterCellForTest(ss, _UR_TEST_MCIDS[0], 'UnitType', 'Demo');
  expect('Unknown UnitType rejected', createUnitRelease(withId()), false);
  _setMasterCellForTest(ss, _UR_TEST_MCIDS[0], 'UnitType', 'Brand-New');

  expect('Release succeeds', createUnitRelease(withId()), true);
  const unit = _readMCMaster('ALL').find(u => u.mcid === _UR_TEST_MCIDS[0]);
  expect('Unit is Sold and kept in MC_MASTER', { success: !!unit && unit.currentStatus === 'Sold', unit: unit }, true);
  const sale = _readObjects(sheetNameSales).find(s => s.TransactionID === id);
  expect('SALES row stores CID + AID', { success: !!sale && sale.CID === cid && sale.AID === customer.aid, sale: sale }, true);

  const header = _readObjects('TRANSACTION_HEADER').filter(h => h.TransactionID === id);
  const detail = _readObjects('TRANSACTION_DETAILS').filter(d => d.TransactionID === id);
  const movement = _readObjects('MC_MOVEMENTS').filter(m => m.TransactionNo === _saleTransactionNo(_UR_TEST_SI));
  expect('SALE header is Completed at the customer branch', {
    success: header.length === 1 && header[0].TransactionType === 'SALE' &&
      header[0].Status === 'Completed' && header[0].SourceLocation === customer.branch
  }, true);
  expect('Exactly one transaction detail links the selected motorcycle', {
    success: detail.length === 1 && detail[0].MCID === _UR_TEST_MCIDS[0] && detail[0].EngineNo === 'TESTURENG1'
  }, true);
  expect('Exactly one SALE movement goes to CUSTOMER', {
    success: movement.length === 1 && movement[0].MCID === _UR_TEST_MCIDS[0] &&
      movement[0].TransactionType === 'SALE' && movement[0].FromLocation === customer.branch && movement[0].ToLocation === 'CUSTOMER'
  }, true);

  const id2 = beginUnitRelease().transactionId;
  expect('Second release for the same CID rejected', createUnitRelease(Object.assign({}, base, {
    TransactionID: id2, MCID: _UR_TEST_MCIDS[1], SINo: _UR_TEST_SI + '-B'
  })), false);

  const cirAfter = JSON.stringify(cir.getDataRange().getValues());
  expect('CIR row unchanged', { success: cirBefore === cirAfter }, true);

  const out = log.join('\n');
  Logger.log('testUnitReleaseFlow() results:\n' + out + '\n\nRun cleanupUnitReleaseTest() to remove the test rows.');
  return out;
}

// Removes every row created by testUnitReleaseFlow().
function cleanupUnitReleaseTest() {
  const ss = _mcSS();
  const sis = [_UR_TEST_SI, _UR_TEST_SI + '-B'];
  const txnNos = sis.map(_saleTransactionNo).concat(['TEST-UR-LEGACY']);
  const removed = {
    TRANSACTION_HEADER:  _purgeTestRows(ss, 'TRANSACTION_HEADER',  'TransactionNo', txnNos),
    TRANSACTION_DETAILS: _purgeTestRows(ss, 'TRANSACTION_DETAILS', 'TransactionNo', txnNos),
    MC_MOVEMENTS:        _purgeTestRows(ss, 'MC_MOVEMENTS',        'TransactionNo', txnNos),
    SALES:               _purgeTestRows(ss, sheetNameSales,        'SINo', sis),
    MC_MASTER:           _purgeTestRows(ss, 'MC_MASTER',           'MCID', _UR_TEST_MCIDS)
  };
  const report = 'cleanupUnitReleaseTest() removed rows: ' + JSON.stringify(removed);
  Logger.log(report);
  return report;
}

// Sets one MC_MASTER cell for a test unit. Throws if the unit or column is missing.
function _setMasterCellForTest(ss, mcid, header, value) {
  const sheet = ss.getSheetByName('MC_MASTER');
  const row = _findMasterRowIndex(ss, mcid);
  const col = _headerMap(sheet)[header];
  if (row === -1 || col === undefined) {
    throw new Error('Cannot set ' + header + ' for ' + mcid + ' — run setupSalesSchema() first.');
  }
  sheet.getRange(row, col + 1).setValue(value);
}
