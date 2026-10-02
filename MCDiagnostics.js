// MCDiagnostics.js - Existing sheet diagnostics and manual lifecycle test/cleanup functions.
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
  r = confirmIBIn({ IBOutNo: 'TEST-IB-OUT-001', IBInNo: 'TEST-IB-IN-001', CreatedBy: 'tester' });
  log.push('Confirm IB-IN: ' + JSON.stringify(r));

  // 5) SALE at B → unit Sold
  r = createSale({ TransactionNo: 'TEST-SALE-001', CustomerName: 'Test Customer', Source: _TEST_BR_B, CreatedBy: 'tester', Units: [{ MCID: _TEST_MCID }] });
  log.push('SALE: ' + JSON.stringify(r));

  // 6) Read back current state + full timeline
  const profile = getUnitProfile(_TEST_MCID);
  log.push('FINAL unit: ' + JSON.stringify(profile.unit));
  log.push('TIMELINE (' + profile.timeline.length + ' moves): ' +
    JSON.stringify(profile.timeline.map(m => m.TransactionNo + ' ' + m.FromLocation + '→' + m.ToLocation)));

  const out = log.join('\n');
  Logger.log('testPhase2Write() results:\n' + out +
    '\n\nExpected: unit ends Sold at ' + _TEST_BR_B + ', 4 moves (RR→IB-OUT→IB-IN→SALE), duplicate rejected.' +
    '\nRun cleanupPhase2Test() to remove all TEST rows.');
  return out;
}

// Deletes every row created by testPhase2Write() from all 4 data sheets.
function cleanupPhase2Test() {
  const ss = _mcSS();
  const testNos = ['TEST-RR-001', 'TEST-IB-OUT-001', 'TEST-IB-IN-001', 'TEST-SALE-001'];
  const removed = {};

  function purge(sheetName, colHeader, matchValues) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) { removed[sheetName] = 0; return; }
    const map = _headerMap(sheet);
    const col = map[colHeader];
    if (col === undefined) { removed[sheetName] = 0; return; }
    const values = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
    let count = 0;
    // delete bottom-up so row indices stay valid
    for (let i = values.length - 1; i >= 0; i--) {
      if (matchValues.indexOf((values[i][0] || '').toString().trim()) !== -1) {
        sheet.deleteRow(i + 2);
        count++;
      }
    }
    removed[sheetName] = count;
  }

  purge('TRANSACTION_HEADER',  'TransactionNo', testNos);
  purge('TRANSACTION_DETAILS', 'TransactionNo', testNos);
  purge('MC_MOVEMENTS',        'TransactionNo', testNos);
  purge('MC_MASTER',           'MCID', [_TEST_MCID]);

  const report = 'cleanupPhase2Test() removed rows: ' + JSON.stringify(removed);
  Logger.log(report);
  return report;
}