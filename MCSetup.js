// MCSetup.js - Manual motorcycle database setup and schema verification.
// Apps Script server files share one global scope; no imports are required.

// =====================================================================
// ===============  MC INVENTORY SYSTEM — PHASE 1: DATA LAYER  ==========
// =====================================================================
// Run setupDatabase() ONCE from the Apps Script editor (Run ▸ setupDatabase).
// It is idempotent and non-destructive:
//   • Creates any of the 5 sheets that don't exist, with exact headers.
//   • Leaves existing sheets and their data untouched (only reports header
//     mismatches in the log — it never deletes or overwrites your rows).
//   • Seeds BRANCHES only if that sheet is empty.
// Target spreadsheet = the same file getMCInventory()/createTransaction() use.
// =====================================================================


/**
 * PHASE 1 entry point. Run once. Safe to re-run.
 * Creates the 5 MC-system sheets (if missing) with the canonical headers,
 * and seeds BRANCHES when that sheet is empty. Never deletes data.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.openById(MC_INVENTORY_SPREADSHEET_ID);
  const log = [];

  Object.keys(MC_SCHEMA).forEach(function (name) {
    const headers = MC_SCHEMA[name];
    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      log.push('CREATED  ' + name + '  (' + headers.length + ' cols)');
      return;
    }

    // Sheet exists — verify headers, do NOT touch data.
    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return (h || '').toString().trim(); });

    if (sheet.getLastRow() === 0) {
      // Sheet exists but is completely empty → write headers.
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      log.push('HEADERS  ' + name + '  (was empty, headers written)');
      return;
    }

    const mismatch = headers.filter(function (h, i) { return existing[i] !== h; });
    if (mismatch.length) {
      log.push('WARN     ' + name + '  header mismatch — expected [' +
        headers.join(', ') + '] but found [' + existing.slice(0, headers.length).join(', ') +
        ']. Left untouched; fix headers manually.');
    } else {
      log.push('OK       ' + name + '  (already correct)');
    }
  });

  // ── Seed BRANCHES only when empty ──
  const branches = ss.getSheetByName('BRANCHES');
  if (branches && branches.getLastRow() <= 1 && MC_BRANCH_SEED.length) {
    branches.getRange(2, 1, MC_BRANCH_SEED.length, MC_SCHEMA.BRANCHES.length)
      .setValues(MC_BRANCH_SEED);
    log.push('SEEDED   BRANCHES  (' + MC_BRANCH_SEED.length + ' rows)');
  } else if (branches && branches.getLastRow() > 1) {
    log.push('SKIP     BRANCHES seed (already has data)');
  } else if (MC_BRANCH_SEED.length === 0) {
    log.push('SKIP     BRANCHES seed (MC_BRANCH_SEED is empty — fill it or add rows by hand)');
  }

  // ── Seed SUPPLIERS only when empty ──
  const suppliers = ss.getSheetByName('SUPPLIERS');
  if (suppliers && suppliers.getLastRow() <= 1 && MC_SUPPLIER_SEED.length) {
    suppliers.getRange(2, 1, MC_SUPPLIER_SEED.length, MC_SCHEMA.SUPPLIERS.length)
      .setValues(MC_SUPPLIER_SEED);
    log.push('SEEDED   SUPPLIERS  (' + MC_SUPPLIER_SEED.length + ' rows)');
  } else if (suppliers && suppliers.getLastRow() > 1) {
    log.push('SKIP     SUPPLIERS seed (already has data)');
  }

  const report = log.join('\n');
  Logger.log('setupDatabase() complete:\n' + report);
  return report;
}

// =====================================================================
// ===============  MC INVENTORY SYSTEM — PHASE 2: BACKEND  =============
// =====================================================================
// Read/query + write functions the UI (Phase 4) will call via
// google.script.run. All reads are display-value based; all writes go
// through createTransaction() so history stays consistent.
// =====================================================================
