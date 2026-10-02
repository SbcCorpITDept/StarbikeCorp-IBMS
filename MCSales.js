// MCSales.js - Motorcycle unit releases and sale transactions.
// Apps Script server files share one global scope; no imports are required.

// ── Sales (Unit Releases) ───────────────────────────────────────────────────

// One row per SALE (1 sale = 1 unit), joined with its SALES row and single
// TRANSACTION_DETAILS row. Sales made before Unit Release have no SALES row,
// so their Account No. / SI No. / Unit Type are blank.
function getSales(branch) {
  const salesById = Object.create(null);
  _readObjects(sheetNameSales).forEach(s => { if (s.TransactionID) salesById[s.TransactionID] = s; });
  const detailById = Object.create(null);
  _readObjects('TRANSACTION_DETAILS').forEach(d => { if (!detailById[d.TransactionID]) detailById[d.TransactionID] = d; });
  return _readObjects('TRANSACTION_HEADER')
    .filter(h => h.TransactionType === 'SALE' && _matchesBranch(h.SourceLocation, branch))
    .map(h => {
      const s = salesById[h.TransactionID] || {};
      const d = detailById[h.TransactionID] || {};
      return {
        transactionNo: h.TransactionNo, transactionId: h.TransactionID, date: h.TransactionDate,
        customer: h.DestinationLocation, accountNo: s.AccountNo || '', siNo: s.SINo || '',
        engineNo: d.EngineNo || '', unitType: s.UnitType || '', branch: h.SourceLocation, status: h.Status
      };
    })
    .sort((a, b) => _cmpDateDesc(a.date, b.date));
}

// Retired: sales go through createUnitRelease() so its checks cannot be bypassed.
function createSale(payload) {
  return { success: false, message: SALE_DISABLED_MSG };
}

// ── Unit Release: customers ─────────────────────────────────────────────────

// CIR_Database rows as customer records. `aid` is the raw ToWhom value (the
// Applicant_Database AID), never the resolved maker name.
function _readCIRCustomers() {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetNameCIR);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getDisplayValues();
  const h = {};
  data[0].forEach((name, i) => { h[(name || '').toString().trim()] = i; });
  const cell = (row, name) => (h[name] === undefined ? '' : (row[h[name]] || '').toString().trim());
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cid = cell(row, 'CID');
    if (!cid) continue;
    out.push({
      cid: cid,
      aid: cell(row, 'ToWhom'),
      applicant: cell(row, 'Applicant'),
      status: cell(row, 'Status / Condition:'),
      branch: cell(row, 'Store Branch:'),
      name: cell(row, 'ApplicantName'),
      contact: cell(row, 'ACellNo.'),
      address: cell(row, 'Pres Address')
    });
  }
  return out;
}

// CIDs that already have a Unit Release → their SALES row (keys lowercased).
function _soldCIDSet() {
  const sold = Object.create(null);
  _readObjects(sheetNameSales).forEach(s => {
    const cid = (s.CID || '').toString().trim().toLowerCase();
    if (cid) sold[cid] = s;
  });
  return sold;
}

// Approved Maker CIR at exactly this branch. `branch` must be a real branch —
// _matchesBranch treats blank/'ALL' as "everything".
function _isEligibleCustomer(c, branch) {
  return _matchesBranch(c.branch, branch) && _isApprovedStatus(c.status) && _isMakerApplicant(c.applicant);
}

// Customers the branch can release a unit to: approved Makers with no sale yet.
function getSaleCustomers(branch) {
  branch = (branch || '').toString().trim();
  if (!branch || branch.toUpperCase() === 'ALL') return [];
  const sold = _soldCIDSet();
  return _readCIRCustomers()
    .filter(c => _isEligibleCustomer(c, branch) && !sold[c.cid.toLowerCase()])
    .map(c => ({ cid: c.cid, aid: c.aid, name: c.name, contact: c.contact, address: c.address }))
    .sort((a, b) => a.name.localeCompare(b.name));
}


// ── Unit Release: create ────────────────────────────────────────────────────
// Business rule: 1 Sale = 1 Customer = 1 Motorcycle Unit.

const UNIT_RELEASE_TTL_SECONDS = 21600;   // 6 h — CacheService maximum
const UNIT_RELEASE_EXPIRED_MSG = 'This release form has expired. Please start a new Unit Release.';
const UNIT_RELEASE_ONE_EACH_MSG = 'A Unit Release must contain exactly one motorcycle and one customer.';
const SALE_DISABLED_MSG = 'Create Sale is no longer supported. Use Unit Release.';

function _unitReleaseCacheKey(transactionId) { return 'UR_TXN_' + transactionId; }

// Issues the Transaction ID shown on the release form. createUnitRelease()
// only accepts IDs issued here and not yet used.
function beginUnitRelease() {
  const transactionId = _uuid();
  CacheService.getScriptCache().put(_unitReleaseCacheKey(transactionId), '1', UNIT_RELEASE_TTL_SECONDS);
  return { transactionId: transactionId };
}

/**
 * createUnitRelease(payload) — validates and records one Unit Release.
 * payload: { TransactionID, MCID, CID, Scope, SaleDate, AccountNo, ATRNo, SINo, RCINo, CreatedBy }
 * Branch, customer and unit details are read on the server; anything else in
 * the payload is ignored. All checks run before the first write, and the whole
 * operation holds one script lock.
 * Returns { success, transactionId, transactionNo } or { success:false, message }.
 */
function createUnitRelease(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = _mcSS();
    const checked = _validateUnitRelease(ss, payload || {});
    if (!checked.success) return checked;
    const r = checked.release;

    _ensureSalesSheet(ss);
    const res = _writeTransaction(ss, {
      TransactionID: r.transactionId,
      TransactionNo: r.transactionNo,
      TransactionType: 'SALE',
      Source: r.branch,
      Destination: r.customer.name || 'CUSTOMER',
      TransactionDate: r.saleDate,
      CreatedBy: r.createdBy,
      Status: 'Completed',
      Details: [{
        MCID: r.unit.mcid, EngineNo: r.unit.engineNo, ChassisNo: r.unit.chassisNo,
        Model: r.unit.model, ModelCode: r.unit.modelCode, Color: r.unit.color
      }]
    });
    if (!res.success) return res;

    _appendRow(ss, sheetNameSales, [
      r.transactionId, r.accountNo, r.customer.cid, r.customer.aid, r.customer.name,
      r.customer.contact, r.customer.address, r.unitType, r.atrNo, r.siNo, r.rciNo
    ]);
    CacheService.getScriptCache().remove(_unitReleaseCacheKey(r.transactionId));
    return { success: true, transactionId: r.transactionId, transactionNo: r.transactionNo };
  } catch (error) {
    console.error('createUnitRelease error:', error.toString());
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Every Unit Release check. Returns { success:false, message } on the first
// failure, or { success:true, release } with the server-side values to write.
function _validateUnitRelease(ss, p) {
  const fail = message => ({ success: false, message: message });
  const text = v => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : '';

  if ([p.MCID, p.CID].some(v => v != null && (typeof v !== 'string' || /[,;\r\n]/.test(v)))) {
    return fail(UNIT_RELEASE_ONE_EACH_MSG);
  }

  const transactionId = text(p.TransactionID);
  if (!transactionId ||
      CacheService.getScriptCache().get(_unitReleaseCacheKey(transactionId)) === null ||
      _transactionIdExists(ss, transactionId)) {
    return fail(UNIT_RELEASE_EXPIRED_MSG);
  }

  const mcid = text(p.MCID);
  const cid = text(p.CID);
  if (!mcid) return fail('Motorcycle is required.');
  if (!cid) return fail('Customer is required.');

  // Unit — authoritative values come from MC_MASTER.
  const unit = _readSaleUnit(ss, mcid);
  if (!unit) return fail('Unit ' + mcid + ' was not found in MC_MASTER.');
  if (_normalizeToken(unit.currentStatus) !== 'available') {
    return fail('Unit ' + unit.engineNo + ' is no longer Available (status: ' + unit.currentStatus + ').');
  }
  if (unit.unitType === 'Invalid') {
    return fail('Unit ' + unit.engineNo + ' has an unrecognized Unit Type "' + unit.unitTypeRaw +
      '". Set it to Brand-New or Repo in MC_MASTER.');
  }
  const branch = (unit.currentBranch || '').toString().trim();
  if (!branch || branch.toUpperCase() === 'ALL') return fail('Unit ' + unit.engineNo + ' has no Current Branch in MC_MASTER.');

  // Scope — restricted users may only release units at their own branch.
  const scope = text(p.Scope);
  if (!scope) return fail('Your account has no branch scope. Please sign in again.');
  if (scope.toUpperCase() !== 'ALL' && !_matchesBranch(branch, scope)) {
    return fail('This unit does not belong to your branch.');
  }

  // Customer — must follow the unit's branch; CID is the duplicate-sale key.
  const customer = _readCIRCustomers().find(c => c.cid.toLowerCase() === cid.toLowerCase());
  if (!customer || !_isEligibleCustomer(customer, branch)) {
    return fail('Customer ' + cid + ' is not an approved Maker at ' + branch + '.');
  }
  const schemaError = _salesSchemaError(ss);
  if (schemaError) return fail(schemaError);
  const prior = _soldCIDSet()[customer.cid.toLowerCase()];
  if (prior) {
    return fail('Customer ' + customer.cid + ' already has a Unit Release (' + _saleTransactionNo(prior.SINo) + ').');
  }

  // User-entered fields.
  const saleDate = _normalizeDate(text(p.SaleDate));
  if (!saleDate) return fail('Date of Sale is required.');
  const accountNo = text(p.AccountNo);
  if (!accountNo) return fail('Account No. is required.');

  const docs = { ATRNo: text(p.ATRNo), SINo: text(p.SINo), RCINo: text(p.RCINo) };
  const labels = { ATRNo: 'ATR No.', SINo: 'SI No.', RCINo: 'RCI No.' };
  const required = _requiredSaleDocs(unit.unitType);
  for (let i = 0; i < required.length; i++) {
    if (!docs[required[i]]) return fail(labels[required[i]] + ' is required.');
  }
  Object.keys(docs).forEach(f => { if (required.indexOf(f) === -1) docs[f] = ''; });

  const transactionNo = _saleTransactionNo(docs.SINo);
  if (_transactionNoExists(ss, transactionNo)) {
    return fail('SI No. ' + docs.SINo + ' is already used by ' + transactionNo + '.');
  }

  return {
    success: true,
    release: {
      transactionId: transactionId,
      transactionNo: transactionNo,
      branch: branch,
      unit: unit,
      unitType: unit.unitType,
      customer: customer,
      saleDate: saleDate,
      accountNo: accountNo,
      atrNo: docs.ATRNo,
      siNo: docs.SINo,
      rciNo: docs.RCINo,
      createdBy: text(p.CreatedBy) || Session.getActiveUser().getEmail() || 'System'
    }
  };
}

// Read authoritative status without the legacy inventory reader's blank-status
// fallback. SALE must only change CurrentStatus and LastUpdated in this row.
function _readSaleUnit(ss, mcid) {
  const sheet = ss.getSheetByName('MC_MASTER');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headers = _headerMap(sheet);
  ['MCID', 'CurrentBranch', 'CurrentStatus', 'LastUpdated'].forEach(h => {
    if (headers[h] === undefined) throw new Error('MC_MASTER is missing ' + h + '. Run setupDatabase() and check the schema.');
  });
  const rows = sheet.getDataRange().getDisplayValues().slice(1);
  const cell = (r, h) => headers[h] === undefined ? '' : r[headers[h]];
  const matches = rows.filter(r => cell(r, 'MCID').trim().toLowerCase() === mcid.toLowerCase());
  if (matches.length > 1) throw new Error('Duplicate MCID ' + mcid + ' in MC_MASTER. Correct it before releasing.');
  if (!matches.length) return null;
  const r = matches[0];
  const raw = cell(r, 'UnitType');
  return {
    mcid: cell(r, 'MCID').trim(), engineNo: cell(r, 'EngineNo'), chassisNo: cell(r, 'ChassisNo'),
    model: cell(r, 'Model'), modelCode: cell(r, 'ModelCode'), color: cell(r, 'Color'),
    currentBranch: cell(r, 'CurrentBranch'), currentStatus: cell(r, 'CurrentStatus'),
    unitType: _normalizeUnitType(raw), unitTypeRaw: raw
  };
}

function _markReleasedUnitSold(ss, mcid) {
  const sheet = ss.getSheetByName('MC_MASTER');
  const row = _findMasterRowIndex(ss, mcid);
  const headers = _headerMap(sheet);
  if (row < 2 || headers.CurrentStatus === undefined || headers.LastUpdated === undefined) {
    throw new Error('Cannot mark unit Sold: MC_MASTER row or status columns are missing.');
  }
  sheet.getRange(row, headers.CurrentStatus + 1).setValue('Sold');
  sheet.getRange(row, headers.LastUpdated + 1).setValue(_mcNow());
}

// Reject incompatible SALES layouts before writing into positional columns.
function _salesSchemaError(ss) {
  const sheet = ss.getSheetByName(sheetNameSales);
  if (!sheet || sheet.getLastRow() === 0) return '';
  const headers = _headerMap(sheet);
  return MC_SCHEMA.SALES.some((h, i) => headers[h] !== i)
    ? 'SALES headers do not match the Unit Release schema. Correct the headers before releasing.' : '';
}

function _ensureSalesSheet(ss) {
  const error = _salesSchemaError(ss);
  if (error) throw new Error(error);
  const sheet = ss.getSheetByName(sheetNameSales) || ss.insertSheet(sheetNameSales);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MC_SCHEMA.SALES.length).setValues([MC_SCHEMA.SALES]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, MC_SCHEMA.SALES.length).setFontWeight('bold');
  }
  return sheet;
}
