// Transfers.js - Transfer lists, creation, receipt confirmation, and cancellation.
// Apps Script server files share one global scope; no imports are required.

// ── Interbranch Transfers ───────────────────────────────────────────────────

// IB-OUT + IB-IN transactions touching this branch (as source or destination).
function getTransfers(branch) {
  const details = _readObjects('TRANSACTION_DETAILS');
  // Count by TransactionID (unique per leg) — an IB-OUT and its IB-IN share the
  // same TransactionNo, so counting by number would double-count the units.
  const countById = {};
  details.forEach(d => { countById[d.TransactionID] = (countById[d.TransactionID] || 0) + 1; });
  // Each branch sees only its OWN leg: the sender sees the IB-OUT (source match),
  // the receiver sees the IB-IN (destination match). ('ALL' = admin sees both.)
  return _readObjects('TRANSACTION_HEADER')
    .filter(h => {
      if (h.TransactionType === 'IB-OUT') return _matchesBranch(h.SourceLocation, branch);
      if (h.TransactionType === 'IB-IN')  return _matchesBranch(h.DestinationLocation, branch);
      return false;
    })
    .map(h => ({
      transactionNo: h.TransactionNo, type: h.TransactionType, date: h.TransactionDate,
      from: h.SourceLocation, to: h.DestinationLocation, units: countById[h.TransactionID] || 0,
      status: h.Status, linked: h.LinkedTransactionNo, createdBy: h.CreatedBy, remarks: h.Remarks
    }))
    .sort((a, b) => _cmpDateDesc(a.date, b.date));
}

// Pending IB-OUTs INBOUND to this branch — the receiving queue.
function getPendingTransfers(branch) {
  return getTransfers('ALL')
    .filter(t => t.type === 'IB-OUT' && (t.status || '').toLowerCase() === 'pending' &&
      _matchesBranch(t.to, branch));
}

// One IB-OUT's header + its units (engine numbers etc.) for the receive-review modal.
// Deduped by MCID so it's safe even if the shared IB-IN details later exist.
function getTransferDetails(transactionNo) {
  const header = _readObjects('TRANSACTION_HEADER')
    .find(h => h.TransactionNo === transactionNo && h.TransactionType === 'IB-OUT') || null;
  const seen = {};
  const units = [];
  _readObjects('TRANSACTION_DETAILS')
    .filter(d => d.TransactionNo === transactionNo)
    .forEach(d => {
      const id = (d.MCID || '').toString().trim();
      if (id && seen[id]) return;
      if (id) seen[id] = true;
      units.push({ mcid: d.MCID, engineNo: d.EngineNo, chassisNo: d.ChassisNo, model: d.Model, modelCode: d.ModelCode });
    });
  return {
    header: header ? {
      transactionNo: header.TransactionNo, from: header.SourceLocation, to: header.DestinationLocation,
      date: header.TransactionDate, status: header.Status
    } : null,
    units: units
  };
}

// Create an IB-OUT (units → In Transit, header Status = Pending).
// payload: { TransactionNo, Source, Destination, Date, Remarks, CreatedBy, Units:[{MCID,...}] }
function createIBOut(payload) {
  const units = Array.isArray(payload.Units) ? payload.Units : [];
  if (!units.length) return { success: false, message: 'Select at least one unit to transfer.' };
  return createTransaction({
    TransactionNo: payload.TransactionNo,
    TransactionType: 'IB-OUT',
    Source: payload.Source,
    Destination: payload.Destination,
    TransactionDate: payload.Date,
    Remarks: payload.Remarks,
    CreatedBy: payload.CreatedBy,
    Status: 'Pending',
    Details: units
  });
}

// Confirm receipt of a pending IB-OUT → creates the IB-IN and marks the
// original IB-OUT Completed. The IB-OUT is never modified except its Status.
// The IB-IN shares the IB-OUT's number (invoice-style): the receiving branch
// types it and it MUST match the IB-OUT number, otherwise it is rejected.
// payload: { IBOutNo, IBInNo, CreatedBy, TransactionDate?, Remarks? }
function confirmIBIn(payload) {
  const ibOutNo = (payload.IBOutNo || '').toString().trim();
  const ibInNo  = (payload.IBInNo  || '').toString().trim();
  if (!ibOutNo) return { success: false, message: 'Source IB-OUT number is missing.' };
  if (!ibInNo)  return { success: false, message: 'Enter the IB-IN number to confirm receipt.' };

  // Verify the typed number matches the IB-OUT (shared reference, like an invoice no).
  if (ibInNo.toLowerCase() !== ibOutNo.toLowerCase()) {
    return { success: false, message: 'The IB-IN number must match the IB-OUT number (' + ibOutNo + '). You entered "' + ibInNo + '".' };
  }

  const outHeader = _readObjects('TRANSACTION_HEADER')
    .find(h => h.TransactionNo === ibOutNo && h.TransactionType === 'IB-OUT');
  if (!outHeader) return { success: false, message: 'IB-OUT ' + ibOutNo + ' not found.' };
  if ((outHeader.Status || '').toLowerCase() !== 'pending') {
    return { success: false, message: 'IB-OUT ' + ibOutNo + ' is not pending (status: ' + outHeader.Status + ').' };
  }

  const units = _readObjects('TRANSACTION_DETAILS')
    .filter(d => d.TransactionNo === ibOutNo)
    .map(d => ({ MCID: d.MCID, EngineNo: d.EngineNo, ChassisNo: d.ChassisNo, Model: d.Model, ModelCode: d.ModelCode }));
  if (!units.length) return { success: false, message: 'IB-OUT ' + ibOutNo + ' has no units.' };

  const res = createTransaction({
    TransactionNo: ibOutNo,                 // shared number — same as the IB-OUT
    TransactionType: 'IB-IN',
    Source: outHeader.SourceLocation,
    Destination: outHeader.DestinationLocation,
    TransactionDate: payload.TransactionDate || _mcToday(),
    Remarks: payload.Remarks || ('Received against ' + ibOutNo),
    CreatedBy: payload.CreatedBy,
    Status: 'Completed',
    LinkedTransactionNo: ibOutNo,
    Details: units
  });
  if (!res.success) return res;

  _setTransactionStatus(_mcSS(), ibOutNo, 'Completed', 'IB-OUT');  // type-qualified: only the IB-OUT leg
  return { success: true, transactionNo: ibOutNo, linked: ibOutNo };
}

// Cancel a PENDING IB-OUT (mistaken transfer recovery). Reverts each unit to
// Available at the source branch and records an IB-CANCEL movement (append-only,
// nothing deleted). The IB-OUT header is marked Cancelled. Only pending transfers
// can be cancelled — once received (IB-IN done) it's locked.
// payload: { IBOutNo, CreatedBy, Reason? }
function cancelIBOut(payload) {
  const ibOutNo = (payload.IBOutNo || '').toString().trim();
  if (!ibOutNo) return { success: false, message: 'IB-OUT number is missing.' };

  const ss = _mcSS();
  const outHeader = _readObjects('TRANSACTION_HEADER')
    .find(h => h.TransactionNo === ibOutNo && h.TransactionType === 'IB-OUT');
  if (!outHeader) return { success: false, message: 'IB-OUT ' + ibOutNo + ' not found.' };
  if ((outHeader.Status || '').toLowerCase() !== 'pending') {
    return { success: false, message: 'Only a pending transfer can be cancelled. ' + ibOutNo + ' is ' + outHeader.Status + '.' };
  }

  const source = outHeader.SourceLocation;
  const dest = outHeader.DestinationLocation;
  const seen = {};
  const units = _readObjects('TRANSACTION_DETAILS')
    .filter(d => d.TransactionNo === ibOutNo)
    .filter(d => { const id = (d.MCID || '').toString().trim(); if (!id || seen[id]) return false; seen[id] = true; return true; });
  if (!units.length) return { success: false, message: 'IB-OUT ' + ibOutNo + ' has no units.' };

  const createdBy = payload.CreatedBy || Session.getActiveUser().getEmail() || 'System';
  const reason = (payload.Reason || '').toString().trim();
  const remark = reason ? ('Cancelled: ' + reason) : 'Transfer cancelled';
  const now = _mcToday();

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    units.forEach(d => {
      const mcid = (d.MCID || '').toString().trim();
      // Audit: reversal movement (dest → source), then revert current state.
      _appendRow(ss, 'MC_MOVEMENTS', [_uuid(), mcid, ibOutNo, 'IB-CANCEL', dest, source, now, createdBy, remark]);
      _upsertMCMaster(ss, { MCID: mcid, CurrentBranch: source, CurrentStatus: 'Available' });
    });
    _setTransactionStatus(ss, ibOutNo, 'Cancelled', 'IB-OUT');
    return { success: true, transactionNo: ibOutNo, units: units.length };
  } catch (e) {
    console.error('cancelIBOut error:', e.toString());
    return { success: false, message: e.toString() };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
