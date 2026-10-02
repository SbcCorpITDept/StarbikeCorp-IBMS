// Database.js - Motorcycle sheet access, master updates, and transaction status helpers.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// MC INVENTORY MOVEMENTS / TRANSACTIONS
// Spreadsheet: MC_Inventory_Movement (same file used by getMCInventory)
// Sheets expected:
//   - MC_MASTER
//   - TRANSACTION_HEADER
//   - TRANSACTION_DETAILS
//   - MC_MOVEMENTS
// All writes are append-only for history; MC_MASTER is upserted to reflect current state.
// =============================================

function _ensureSheetWithHeaders(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existing = sheet.getDataRange().getValues();
    if (existing.length === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function _appendRow(ss, sheetName, row) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);
  sheet.appendRow(row);
}

function _findMasterRowIndex(ss, mcid) {
  const sheet = ss.getSheetByName('MC_MASTER');
  if (!sheet) return -1;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return -1;
  const headers = data[0];
  const mcidIdx = headers.indexOf('MCID');
  if (mcidIdx === -1) return -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][mcidIdx] || '').toString().trim() === mcid) return i + 1; // 1-based row
  }
  return -1;
}

function _upsertMCMaster(ss, record) {
  // record: { MCID, EngineNo, ChassisNo, Model, ModelCode, Color,
  //           CurrentBranch, CurrentStatus, OriginalRR?, DateReceived? }
  // MC_MASTER holds CURRENT STATE only. OriginalRR + DateReceived are written
  // once (on first insert) and never overwritten — they are historical anchors.
  const headers = MC_SCHEMA.MC_MASTER;
  _ensureSheetWithHeaders(ss, 'MC_MASTER', headers);

  const sheet = ss.getSheetByName('MC_MASTER');
  const rowIndex = _findMasterRowIndex(ss, (record.MCID || '').toString().trim());
  const now = _mcNow();

  if (rowIndex === -1) {
    _appendRow(ss, 'MC_MASTER', [
      record.MCID || '',
      record.EngineNo || '',
      record.ChassisNo || '',
      record.Model || '',
      record.ModelCode || '',
      record.Color || '',
      record.CurrentBranch || '',
      record.CurrentStatus || '',
      record.OriginalRR || '',
      record.DateReceived || now,
      now
    ]);
  } else {
    // Mutate ONLY current-state fields. Never touch MCID/OriginalRR/DateReceived.
    const headersRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const setCell = (h, v) => {
      const c = headersRow.indexOf(h) + 1;
      if (c > 0) sheet.getRange(rowIndex, c).setValue(v);
    };
    setCell('CurrentBranch', record.CurrentBranch || '');
    setCell('CurrentStatus', record.CurrentStatus || '');
    setCell('LastUpdated', now);
    // Backfill identity fields only when supplied (don't blank existing values).
    if (record.EngineNo)  setCell('EngineNo',  record.EngineNo);
    if (record.ChassisNo) setCell('ChassisNo', record.ChassisNo);
    if (record.Model)     setCell('Model',     record.Model);
    if (record.ModelCode) setCell('ModelCode', record.ModelCode);
    if (record.Color)     setCell('Color',     record.Color);
  }
}

// ── Shared helpers (Phase 2) ─────────────────────────────────────────────
function _mcSS()    { return SpreadsheetApp.openById(MC_INVENTORY_SPREADSHEET_ID); }
function _uuid()    { return Utilities.getUuid(); }
function _mcNow()   { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss'); }
function _mcToday() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy'); }
// Normalize any date input (Date, 'yyyy-mm-dd' from a picker, or 'MM/dd/yyyy')
// to a single canonical 'MM/dd/yyyy' string. Returns '' for blank/unparseable. [Adjustment #2]
function _normalizeDate(v) {
  const d = _parseSheetDate(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy') : '';
}

// header name → 0-based column index, for a sheet's row 1
function _headerMap(sheet) {
  const map = {};
  if (!sheet || sheet.getLastColumn() === 0) return map;
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  row.forEach((h, i) => { map[(h || '').toString().trim()] = i; });
  return map;
}

// 1-based column of `header` in row 1. Appends the header after the last column
// when it is missing. Never writes below row 1.
function _ensureHeaderColumn(sheet, header) {
  const map = _headerMap(sheet);
  if (map[header] !== undefined) return map[header] + 1;
  const col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(header);
  return col;
}

// True if a TransactionNo already exists in TRANSACTION_HEADER (uniqueness guard).
function _transactionNoExists(ss, transactionNo) {
  const sheet = ss.getSheetByName('TRANSACTION_HEADER');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const map = _headerMap(sheet);
  const col = map['TransactionNo'];
  if (col === undefined) return false;
  const values = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
  const target = (transactionNo || '').toString().trim().toLowerCase();
  return values.some(r => (r[0] || '').toString().trim().toLowerCase() === target);
}


// True if a TransactionID already exists in TRANSACTION_HEADER.
function _transactionIdExists(ss, transactionId) {
  const sheet = ss.getSheetByName('TRANSACTION_HEADER');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const col = _headerMap(sheet)['TransactionID'];
  if (col === undefined) return false;
  const target = (transactionId || '').toString().trim();
  return sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues()
    .some(r => (r[0] || '').toString().trim() === target);
}

// Read a whole sheet as an array of {Header: value} objects (display values).
function _readObjects(sheetName) {
  const sheet = _mcSS().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => (h || '').toString().trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const o = {};
    headers.forEach((h, idx) => { o[h] = data[i][idx]; });
    rows.push(o);
  }
  return rows;
}


// Update a transaction's Status by TransactionNo (optionally also matching type,
// needed now that an IB-OUT and its IB-IN can share one number). Returns true if found.
function _setTransactionStatus(ss, transactionNo, status, type) {
  const sheet = ss.getSheetByName('TRANSACTION_HEADER');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const map = _headerMap(sheet);
  const noCol = map['TransactionNo'], stCol = map['Status'], tyCol = map['TransactionType'];
  if (noCol === undefined || stCol === undefined) return false;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const target = (transactionNo || '').toString().trim();
  const wantType = (type || '').toString().trim();
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][noCol] || '').toString().trim() !== target) continue;
    if (wantType && tyCol !== undefined && (rows[i][tyCol] || '').toString().trim() !== wantType) continue;
    sheet.getRange(i + 2, stCol + 1).setValue(status);
    return true;
  }
  return false;
}
