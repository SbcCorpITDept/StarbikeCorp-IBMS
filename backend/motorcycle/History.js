// History.js - Per-unit movement history and filtered branch movement trail.
// Apps Script server files share one global scope; no imports are required.

function getMCHistory(mcid) {
  try {
    const ss = SpreadsheetApp.openById('18yDG_RlaTWhx_ZkWiCxy8en5dryfrDC9crn1tU4_tW8');
    const sheet = ss.getSheetByName('MC_MOVEMENTS');
    if (!sheet) return [];
    const data = sheet.getDataRange().getDisplayValues();
    if (data.length < 2) return [];
    const headers = data[0];
    const idx = {
      movementId: headers.indexOf('MovementID'),
      mcid: headers.indexOf('MCID'),
      transactionNo: headers.indexOf('TransactionNo'),
      transactionType: headers.indexOf('TransactionType'),
      fromLocation: headers.indexOf('FromLocation'),
      toLocation: headers.indexOf('ToLocation'),
      movementDate: headers.indexOf('MovementDate'),
      performedBy: headers.indexOf('PerformedBy'),
      remarks: headers.indexOf('Remarks')
    };

    const rows = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i][idx.mcid] || '').toString().trim() === mcid) {
        rows.push({
          MovementID: data[i][idx.movementId] || '',
          MCID: data[i][idx.mcid] || '',
          TransactionNo: data[i][idx.transactionNo] || '',
          TransactionType: data[i][idx.transactionType] || '',
          FromLocation: data[i][idx.fromLocation] || '',
          ToLocation: data[i][idx.toLocation] || '',
          MovementDate: data[i][idx.movementDate] || '',
          PerformedBy: data[i][idx.performedBy] || '',
          Remarks: data[i][idx.remarks] || ''
        });
      }
    }
    return rows;
  } catch (error) {
    console.error('getMCHistory error:', error.toString());
    return [];
  }
}

/**
 * Debug helper: returns headers and a few sample rows (display values)
 * for Mc_Delivery and Mc_Inventory so the client can inspect mismatches.
 */

// The branch that "owns" a movement (so each branch only sees its own leg):
//   IB-OUT / SALE   → the source (From) branch acted
//   RR / IB-IN / IB-CANCEL / other → the destination (To) branch acted
function _movementOwner(type, fromLoc, toLoc) {
  const t = (type || '').toString().toUpperCase();
  return (t === 'IB-OUT' || t === 'SALE') ? fromLoc : toLoc;
}

// ── Movement History (filterable audit trail) ───────────────────────────────
// filters: { mcid?, engineNo?, transactionNo?, dateFrom?, dateTo?, branch? }
// branch scoping: a branch sees only the movements it OWNS (its own leg) — the
// sender sees its IB-OUT/SALE, the receiver sees its RR/IB-IN. This mirrors the
// Transfers table so a transfer isn't shown twice. Pass 'ALL' (or blank) for the
// global audit view.
function getMovementHistory(filters) {
  filters = filters || {};
  const masterByMcid = {};
  _readMCMaster('ALL').forEach(u => { masterByMcid[u.mcid] = u; });

  const from = filters.dateFrom ? _parseSheetDate(filters.dateFrom) : null;
  const to   = filters.dateTo   ? _parseSheetDate(filters.dateTo)   : null;
  const fMcid = (filters.mcid || '').toString().trim().toLowerCase();
  const fEng  = (filters.engineNo || '').toString().trim().toLowerCase();
  const fTxn  = (filters.transactionNo || '').toString().trim().toLowerCase();
  const fBranch = (filters.branch || '').toString().trim();

  const out = [];
  _readObjects('MC_MOVEMENTS').forEach(r => {
    const mcid = (r.MCID || '').toString().trim();
    const eng  = masterByMcid[mcid] ? masterByMcid[mcid].engineNo : '';
    if (fMcid && mcid.toLowerCase().indexOf(fMcid) === -1) return;
    if (fEng  && (eng || '').toLowerCase().indexOf(fEng) === -1) return;
    if (fTxn  && (r.TransactionNo || '').toLowerCase().indexOf(fTxn) === -1) return;
    // branch scope: include only the movements this branch owns (its own leg)
    if (!_matchesBranch(_movementOwner(r.TransactionType, r.FromLocation, r.ToLocation), fBranch)) return;
    const d = _parseSheetDate(r.MovementDate);
    if (from && d && d < from) return;
    if (to   && d && d > to)   return;
    out.push({
      date: r.MovementDate, mcid: mcid, engineNo: eng,
      transactionNo: r.TransactionNo, transactionType: r.TransactionType,
      from: r.FromLocation, to: r.ToLocation, user: r.PerformedBy, remarks: r.Remarks
    });
  });
  // Newest first by APPEND ORDER (append-only = true chronology), not typed date. [Adjustment #3]
  return out.reverse();
}
