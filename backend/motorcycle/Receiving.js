// Receiving.js - Receiving-report creation, duplicate-unit checks, lists, and details.
// Apps Script server files share one global scope; no imports are required.

/**
 * createReceivingReport(payload) — Receiving Report entry point for the UI.
 * Brand-new units have no MCID yet, so we mint a UUID MCID per unit here,
 * then route through createTransaction() (which sets OriginalRR/DateReceived,
 * status Available, and the SUPPLIER → branch movement).
 * payload: {
 *   RRNo,            // manual, unique (validated by createTransaction)
 *   Branch,          // destination branch (receives the units)
 *   Date, Remarks, CreatedBy,
 *   Units: [{ EngineNo, ChassisNo, Model, ModelCode, Color }]
 * }
 * Returns { success, transactionNo, mcids } or { success:false, message }.
 */
// Returns a list of conflict messages if any unit's engine/chassis already exists
// in MC_MASTER or is repeated within the same batch. Empty array = all clear.
function _findDuplicateUnits(units) {
  const norm = v => (v || '').toString().trim().toUpperCase();
  const existEng = {}, existChs = {};
  _readObjects('MC_MASTER').forEach(m => {
    const e = norm(m.EngineNo); if (e) existEng[e] = true;
    const c = norm(m.ChassisNo); if (c) existChs[c] = true;
  });
  const seenEng = {}, seenChs = {};
  const conflicts = [];
  units.forEach(u => {
    const e = norm(u.EngineNo), c = norm(u.ChassisNo);
    if (e) {
      if (existEng[e]) conflicts.push('Engine ' + u.EngineNo + ' already exists in inventory');
      else if (seenEng[e]) conflicts.push('Engine ' + u.EngineNo + ' is entered twice in this RR');
      else seenEng[e] = true;
    }
    if (c) {
      if (existChs[c]) conflicts.push('Chassis ' + u.ChassisNo + ' already exists in inventory');
      else if (seenChs[c]) conflicts.push('Chassis ' + u.ChassisNo + ' is entered twice in this RR');
      else seenChs[c] = true;
    }
  });
  return conflicts;
}

function createReceivingReport(payload) {
  payload = payload || {};
  const units = Array.isArray(payload.Units) ? payload.Units : [];
  if (!(payload.RRNo || '').toString().trim()) return { success: false, message: 'RR No is required.' };
  if (!(payload.Branch || '').toString().trim()) return { success: false, message: 'Receiving branch is required.' };
  if (!units.length) return { success: false, message: 'Add at least one motorcycle.' };

  // ── Duplicate engine/chassis guard [safeguard] ──
  // A motorcycle can only be received once. Block if an engine or chassis number
  // already exists in inventory, or is repeated within this same RR submission.
  const dupCheck = _findDuplicateUnits(units);
  if (dupCheck.length) {
    return { success: false, message: 'Cannot receive — already-existing or repeated unit(s):\n• ' + dupCheck.join('\n• ') };
  }

  const mcids = [];
  const details = units.map(u => {
    const mcid = (u.MCID || '').toString().trim() || _uuid();
    mcids.push(mcid);
    return {
      MCID: mcid,
      EngineNo: u.EngineNo || '',
      ChassisNo: u.ChassisNo || '',
      Model: u.Model || '',
      ModelCode: u.ModelCode || '',
      Color: u.Color || ''
    };
  });

  const res = createTransaction({
    TransactionNo: payload.RRNo,
    TransactionType: 'RR',
    Source: (payload.Supplier || '').toString().trim() || 'SUPPLIER',  // supplier becomes the movement's From
    Destination: payload.Branch,
    TransactionDate: payload.Date,
    Remarks: payload.Remarks,
    CreatedBy: payload.CreatedBy,
    Status: 'Completed',
    Details: details
  });
  if (res.success) res.mcids = mcids;
  return res;
}


// ── Receiving Reports ──────────────────────────────────────────────────────

// RR list for the branch. [{transactionNo, date, branch, units, status, ...}]
function getRRList(branch) {
  const details = _readObjects('TRANSACTION_DETAILS');
  // Count by TransactionID (unique per leg) — an IB-OUT and its IB-IN share the
  // same TransactionNo, so counting by number would double-count the units.
  const countById = {};
  details.forEach(d => { countById[d.TransactionID] = (countById[d.TransactionID] || 0) + 1; });
  return _readObjects('TRANSACTION_HEADER')
    .filter(h => h.TransactionType === 'RR' && _matchesBranch(h.DestinationLocation, branch))
    .map(h => ({
      transactionNo: h.TransactionNo,
      date: h.TransactionDate,
      branch: h.DestinationLocation,
      units: countById[h.TransactionID] || 0,
      status: h.Status,
      createdBy: h.CreatedBy,
      remarks: h.Remarks
    }))
    .sort((a, b) => _cmpDateDesc(a.date, b.date));
}

// One RR: header + the motorcycles included (enriched with current status).
function getRRDetails(transactionNo) {
  const header = _readObjects('TRANSACTION_HEADER')
    .find(h => h.TransactionNo === transactionNo && h.TransactionType === 'RR') || null;
  const masterByMcid = {};
  _readMCMaster('ALL').forEach(u => { masterByMcid[u.mcid] = u; });
  const units = _readObjects('TRANSACTION_DETAILS')
    .filter(d => d.TransactionNo === transactionNo)
    .map(d => ({
      mcid: d.MCID, engineNo: d.EngineNo, chassisNo: d.ChassisNo,
      model: d.Model, modelCode: d.ModelCode,
      status: masterByMcid[d.MCID] ? masterByMcid[d.MCID].currentStatus : '',
      currentBranch: masterByMcid[d.MCID] ? masterByMcid[d.MCID].currentBranch : ''
    }));
  return { header, units };
}
