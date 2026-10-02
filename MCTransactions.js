// MCTransactions.js - Shared transaction writer and receiving-report compatibility wrapper.
// Apps Script server files share one global scope; no imports are required.

/**
 * createTransaction(tx) — writes to the canonical 5-sheet schema.
 * tx: {
 *   TransactionNo,               // manual, required for RR/IB-OUT/IB-IN/SALE — must be unique
 *   TransactionType,             // RR | IB-OUT | IB-IN | SALE
 *   SourceLocation | Source,     // branch, or 'SUPPLIER' (RR)
 *   DestinationLocation | Destination, // branch, or 'CUSTOMER' (SALE)
 *   TransactionDate?, CreatedBy?, Status?, Remarks?, LinkedTransactionNo?,
 *   Details: [{ MCID, EngineNo, ChassisNo, Model, ModelCode, Color }]
 * }
 * Returns { success, transactionNo, transactionId } or { success:false, message }.
 */
function createTransaction(tx) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = _mcSS();

    // Ensure the canonical sheets exist with canonical headers.
    _ensureSheetWithHeaders(ss, 'TRANSACTION_HEADER',  MC_SCHEMA.TRANSACTION_HEADER);
    _ensureSheetWithHeaders(ss, 'TRANSACTION_DETAILS', MC_SCHEMA.TRANSACTION_DETAILS);
    _ensureSheetWithHeaders(ss, 'MC_MOVEMENTS',        MC_SCHEMA.MC_MOVEMENTS);

    const type = (tx.TransactionType || '').toString().trim();
    if (!type) return { success: false, message: 'TransactionType is required.' };

    const source = (tx.SourceLocation || tx.Source || '').toString().trim();
    const dest   = (tx.DestinationLocation || tx.Destination || '').toString().trim();
    const txDate = _normalizeDate(tx.TransactionDate) || _mcToday();
    const createdBy = tx.CreatedBy || Session.getActiveUser().getEmail() || 'System';
    const status = tx.Status || (type === 'IB-OUT' ? 'Pending' : 'Completed');

    // Manual, unique TransactionNo — required and validated.
    const transactionNo = (tx.TransactionNo || '').toString().trim();
    if (!transactionNo) return { success: false, message: 'Transaction No is required.' };
    // An IB-IN intentionally shares its linked IB-OUT's number (invoice-style),
    // so it is allowed to reuse that existing number. Everything else must be unique.
    const isLinkedIBIn = (type === 'IB-IN' && (tx.LinkedTransactionNo || '').toString().trim());
    if (!isLinkedIBIn && _transactionNoExists(ss, transactionNo)) {
      return { success: false, message: 'Transaction No "' + transactionNo + '" already exists. Enter a unique number.' };
    }

    const details = Array.isArray(tx.Details) ? tx.Details : [];
    if (!details.length) return { success: false, message: 'At least one motorcycle is required.' };

    const transactionId = _uuid();

    // Header
    _appendRow(ss, 'TRANSACTION_HEADER', [
      transactionId, transactionNo, type, source, dest, txDate,
      createdBy, status, tx.Remarks || '', tx.LinkedTransactionNo || ''
    ]);

    // Movement from/to depends on type. For RR the source IS the supplier
    // (falls back to the literal 'SUPPLIER' when none was chosen).
    const fromLoc = (type === 'RR')   ? (source || 'SUPPLIER') : source;
    const toLoc   = (type === 'SALE') ? 'CUSTOMER' : dest;

    details.forEach(item => {
      const mcid = (item.MCID || '').toString().trim();

      _appendRow(ss, 'TRANSACTION_DETAILS', [
        transactionId, transactionNo, mcid,
        item.EngineNo || '', item.ChassisNo || '', item.Model || '', item.ModelCode || ''
      ]);

      _appendRow(ss, 'MC_MOVEMENTS', [
        _uuid(), mcid, transactionNo, type, fromLoc, toLoc, txDate, createdBy, tx.Remarks || ''
      ]);

      // Current-state transition in MC_MASTER
      const rec = {
        MCID: mcid,
        EngineNo: item.EngineNo || '',
        ChassisNo: item.ChassisNo || '',
        Model: item.Model || '',
        ModelCode: item.ModelCode || '',
        Color: item.Color || ''
      };
      if (type === 'RR') {
        rec.CurrentBranch = dest;
        rec.CurrentStatus = 'Available';
        rec.OriginalRR = transactionNo;   // written once by _upsertMCMaster
        rec.DateReceived = txDate;
      } else if (type === 'IB-OUT') {
        rec.CurrentBranch = source;       // still at source until received
        rec.CurrentStatus = 'In Transit';
      } else if (type === 'IB-IN') {
        rec.CurrentBranch = dest;
        rec.CurrentStatus = 'Available';
      } else if (type === 'SALE') {
        rec.CurrentBranch = source;
        rec.CurrentStatus = 'Sold';
      }
      _upsertMCMaster(ss, rec);
    });

    return { success: true, transactionNo, transactionId };
  } catch (error) {
    console.error('createTransaction error:', error.toString());
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * recordRR(header, details) — thin wrapper kept for the existing Index.html call.
 * Routes a Receiving Report through createTransaction() on the new schema.
 * No longer writes the retired Mc_Delivery / Mc_Inventory sheets.
 */
function recordRR(header, details) {
  const tx = Object.assign({}, header, { TransactionType: 'RR', Details: details });
  return createTransaction(tx);
}
