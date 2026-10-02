// MCSales.js - Motorcycle unit releases and sale transactions.
// Apps Script server files share one global scope; no imports are required.

// ── Sales (Unit Releases) ───────────────────────────────────────────────────

function getSales(branch) {
  const details = _readObjects('TRANSACTION_DETAILS');
  // Count by TransactionID (unique per leg) — an IB-OUT and its IB-IN share the
  // same TransactionNo, so counting by number would double-count the units.
  const countById = {};
  details.forEach(d => { countById[d.TransactionID] = (countById[d.TransactionID] || 0) + 1; });
  return _readObjects('TRANSACTION_HEADER')
    .filter(h => h.TransactionType === 'SALE' && _matchesBranch(h.SourceLocation, branch))
    .map(h => ({
      transactionNo: h.TransactionNo, date: h.TransactionDate,
      customer: h.DestinationLocation, branch: h.SourceLocation,
      units: countById[h.TransactionID] || 0, status: h.Status,
      remarks: h.Remarks, createdBy: h.CreatedBy
    }))
    .sort((a, b) => _cmpDateDesc(a.date, b.date));
}

// Create a SALE (units → Sold). Customer name is stored in DestinationLocation;
// the movement To is always 'CUSTOMER'.
// payload: { TransactionNo, CustomerName, Source, Date, Remarks, CreatedBy, Units:[{MCID,...}] }
function createSale(payload) {
  const units = Array.isArray(payload.Units) ? payload.Units : [];
  if (!units.length) return { success: false, message: 'Select at least one unit to sell.' };
  return createTransaction({
    TransactionNo: payload.TransactionNo,
    TransactionType: 'SALE',
    Source: payload.Source,
    Destination: payload.CustomerName || 'CUSTOMER',
    TransactionDate: payload.Date,
    Remarks: payload.Remarks,
    CreatedBy: payload.CreatedBy,
    Status: 'Completed',
    Details: units
  });
}
