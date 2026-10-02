// MCInventory.js - Current inventory, available units, profiles, and retained legacy reader.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// APPLICATION MENU
// =============================================



// =============================================
// MC INVENTORY — refactored to match CAS/CIR style
// Parent: Mc_Delivery
// Child:  Mc_Inventory (linked by MCID)
// Uses COLUMN_CONFIG + useDisplay so dates render as clean strings,
// and _matchesBranch() so the branch filter behaves like the others.
// =============================================
function getMCInventory(branch) {
  try {
    console.log('getMCInventory() called — branch:', branch);
    return _readMCMaster(branch);
  } catch (error) {
    console.error('getMCInventory() error:', error.toString());
    return [];
  }
}

/**
 * Reads MC_MASTER (current state) as the inventory source of truth and
 * enriches each unit with its most-recent MC_MOVEMENTS row. Branch-scoped
 * server-side via _matchesBranch (same helper the CAS/CIR readers use).
 */
function _readMCMaster(branch) {
  const ss = _mcSS();
  const master = ss.getSheetByName('MC_MASTER');
  if (!master || master.getLastRow() < 2) return [];

  const mData = master.getDataRange().getDisplayValues();
  const mh = {};
  mData[0].forEach((h, i) => { mh[(h || '').toString().trim()] = i; });

  // Build last-movement lookup (last row wins = most recent append).
  const lastMove = {};
  const mv = ss.getSheetByName('MC_MOVEMENTS');
  if (mv && mv.getLastRow() > 1) {
    const vData = mv.getDataRange().getDisplayValues();
    const vh = {};
    vData[0].forEach((h, i) => { vh[(h || '').toString().trim()] = i; });
    for (let i = 1; i < vData.length; i++) {
      const id = (vData[i][vh['MCID']] || '').toString().trim();
      if (!id) continue;
      lastMove[id] = {
        TransactionNo: vData[i][vh['TransactionNo']] || '',
        TransactionType: vData[i][vh['TransactionType']] || '',
        ToLocation: vData[i][vh['ToLocation']] || '',
        MovementDate: vData[i][vh['MovementDate']] || ''
      };
    }
  }

  const result = [];
  for (let i = 1; i < mData.length; i++) {
    const row = mData[i];
    const mcid = (row[mh['MCID']] || '').toString().trim();
    if (!mcid) continue;

    const currentBranch = row[mh['CurrentBranch']] || '';
    if (!_matchesBranch(currentBranch, branch)) continue;

    const rec = {
      mcid: mcid,
      engineNo: row[mh['EngineNo']] || '',
      chassisNo: row[mh['ChassisNo']] || '',
      model: row[mh['Model']] || '',
      modelCode: row[mh['ModelCode']] || '',
      color: row[mh['Color']] || '',
      currentBranch: currentBranch,
      currentStatus: row[mh['CurrentStatus']] || 'Available',
      originalRR: row[mh['OriginalRR']] || '',
      dateReceived: row[mh['DateReceived']] || '',
      lastUpdated: row[mh['LastUpdated']] || '',
      lastMove: lastMove[mcid] ? lastMove[mcid].TransactionNo : '',
      lastMoveDate: lastMove[mcid] ? lastMove[mcid].MovementDate : (row[mh['LastUpdated']] || ''),
      // legacy-compatible fields for the current MC page renderer
      storeBranch: currentBranch,
      rrNo: row[mh['OriginalRR']] || '',
      rrDate: row[mh['DateReceived']] || '',
      type: '',
      details: [{
        engineNo: row[mh['EngineNo']] || '',
        chassisNo: row[mh['ChassisNo']] || '',
        model: row[mh['Model']] || '',
        modelCode: row[mh['ModelCode']] || '',
        color: row[mh['Color']] || ''
      }]
    };
    result.push(rec);
  }

  console.log(`_readMCMaster(): returned ${result.length} records`);
  return result;
}

function _getMCInventory_LEGACY(branch) {
  try {
    console.log('getMCInventory() called — branch:', branch);

    const ss = SpreadsheetApp.openById('18yDG_RlaTWhx_ZkWiCxy8en5dryfrDC9crn1tU4_tW8');

    // ── PARENT SHEET ──────────────────────────────────────────────────────
    const parentSheet = ss.getSheetByName('Mc_Delivery');
    if (!parentSheet) throw new Error('Mc_Delivery sheet not found');

    const data        = parentSheet.getDataRange().getValues();
    const displayData = parentSheet.getDataRange().getDisplayValues();
    if (data.length < 2) return [];

    const headers = data[0];
      // ── COLUMN MAP (parent) ───────────────────────────────────────────────
      // useDisplay: true → read the formatted cell text (dates, etc.)
      const COLUMN_CONFIG = {
        mcid:        { header: 'MCID' },
        region:      { header: 'Region/Area' },
        storeBranch: { header: 'Store Branch' },          // ← BRANCH FILTER KEY
        branchName:  { header: 'Branch Name' },
        branchCode:  { header: 'Branch Code' },
        type:        { header: 'Type' },
        rrNo:        { header: 'RR No.' },
        rrDate:      { header: 'Date of RR', useDisplay: true }   // ← clean date string
      };

      // tolerant header finder (case-insensitive, trimmed, substring fallback)
      function _findHeaderIndex(headersArr, expected) {
        if (!headersArr || headersArr.length === 0) return -1;
        const expect = (expected || '').toString().trim().toLowerCase();
        for (let i = 0; i < headersArr.length; i++) {
          const h = (headersArr[i] || '').toString().trim().toLowerCase();
          if (h === expect) return i;
        }
        // fallback: contains
        for (let i = 0; i < headersArr.length; i++) {
          const h = (headersArr[i] || '').toString().trim().toLowerCase();
          if (expect && h.indexOf(expect) !== -1) return i;
        }
        // last resort: match by key words (useful for dates like 'RR Date')
        const parts = expect.split(/\s+/).filter(Boolean);
        if (parts.length) {
          for (let i = 0; i < headersArr.length; i++) {
            const h = (headersArr[i] || '').toString().trim().toLowerCase();
            let all = true;
            for (const p of parts) { if (!h.includes(p)) { all = false; break; } }
            if (all) return i;
          }
        }
        return -1;
      }

      const colIndex = {};
      Object.keys(COLUMN_CONFIG).forEach(key => {
        const expected = COLUMN_CONFIG[key].header || '';
        const idx = _findHeaderIndex(headers, expected);
        if (idx === -1) {
          console.warn(`getMCInventory: header not found for '${expected}'`);
        }
        colIndex[key] = idx;
      });

    // ── CHILD SHEET (details) ─────────────────────────────────────────────
    const childSheet        = ss.getSheetByName('Mc_Inventory');
    let   childData         = [];
    let   childDisplayData  = [];
    if (childSheet) {
      childData        = childSheet.getDataRange().getValues();
      childDisplayData = childSheet.getDataRange().getDisplayValues();
    }

    const childHeaders = childData.length > 0 ? childData[0] : [];
    // tolerant child header matching (common variants)
    function _findChild(headersArr, names) {
      for (const n of names) {
        const idx = _findHeaderIndex(headersArr, n);
        if (idx !== -1) return idx;
      }
      return -1;
    }
    const childCol = {
      mcid:      _findChild(childHeaders, ['MCID','MCID ']),
      engineNo:  _findChild(childHeaders, ['Engine No.','Engine No','EngineNo','Engine Number','Engine']),
      chassisNo: _findChild(childHeaders, ['Chassis No.','Chassis No','ChassisNo','Chassis Number','Chassis']),
      model:     _findChild(childHeaders, ['Model','Model ']),
      modelCode: _findChild(childHeaders, ['Model Code','ModelCode','Model Code ']),
      color:     _findChild(childHeaders, ['Color','Colour'])
    };

    const masterSheet = ss.getSheetByName('MC_MASTER');
    const masterMap = {};
    if (masterSheet) {
      const masterData = masterSheet.getDataRange().getDisplayValues();
      if (masterData.length > 1) {
        const masterHeaders = masterData[0];
        const masterCols = {
          mcid: masterHeaders.indexOf('MCID'),
          currentBranch: masterHeaders.indexOf('CurrentBranch'),
          currentStatus: masterHeaders.indexOf('CurrentStatus'),
          lastUpdated: masterHeaders.indexOf('LastUpdated')
        };
        for (let i = 1; i < masterData.length; i++) {
          const row = masterData[i];
          const mcid = (row[masterCols.mcid] || '').toString().trim();
          if (!mcid) continue;
          masterMap[mcid] = {
            currentBranch: row[masterCols.currentBranch] || '',
            currentStatus: row[masterCols.currentStatus] || '',
            lastUpdated: row[masterCols.lastUpdated] || ''
          };
        }
      }
    }

    const movementSheet = ss.getSheetByName('MC_MOVEMENTS');
    const lastMovementMap = {};
    if (movementSheet) {
      const movementData = movementSheet.getDataRange().getDisplayValues();
      if (movementData.length > 1) {
        const movementHeaders = movementData[0];
        const movementCols = {
          mcid: movementHeaders.indexOf('MCID'),
          transactionNo: movementHeaders.indexOf('TransactionNo'),
          transactionType: movementHeaders.indexOf('TransactionType'),
          toLocation: movementHeaders.indexOf('ToLocation'),
          movementDate: movementHeaders.indexOf('MovementDate')
        };
        for (let i = 1; i < movementData.length; i++) {
          const row = movementData[i];
          const mcid = (row[movementCols.mcid] || '').toString().trim();
          if (!mcid) continue;
          lastMovementMap[mcid] = {
            TransactionNo: row[movementCols.transactionNo] || '',
            TransactionType: row[movementCols.transactionType] || '',
            ToLocation: row[movementCols.toLocation] || '',
            MovementDate: row[movementCols.movementDate] || ''
          };
        }
      }
    }

    const storeBranchIdx = colIndex['storeBranch'];
    const result = [];

    for (let i = 1; i < data.length; i++) {
      const row        = data[i];
      const displayRow = displayData[i];

      const mcid = (row[colIndex['mcid']] || '').toString().trim();
      if (!mcid) continue;

      // ── BRANCH FILTER (server-side, same helper as CAS/CIR) ─────────────
      if (!_matchesBranch(storeBranchIdx >= 0 ? row[storeBranchIdx] : '', branch)) continue;

      // Build the record from the column map
      const mcRecord = {};
      Object.keys(COLUMN_CONFIG).forEach(key => {
        const cfg = COLUMN_CONFIG[key];
        const idx = colIndex[key];
        mcRecord[key] = (idx === -1)
          ? ''
          : (cfg.useDisplay ? displayRow[idx] : row[idx]) || '';
      });
      mcRecord.details = [];
      mcRecord.currentBranch = masterMap[mcid]?.currentBranch || mcRecord.storeBranch || '';
      mcRecord.currentStatus = masterMap[mcid]?.currentStatus || 'Available';
      mcRecord.lastMove = lastMovementMap[mcid]?.TransactionNo || '';
      mcRecord.lastMoveDate = lastMovementMap[mcid]?.MovementDate || '';

      // ── MATCH CHILD ROWS ─────────────────────────────────────────────────
      if (childSheet && childCol.mcid >= 0) {
        for (let j = 1; j < childData.length; j++) {
          if ((childData[j][childCol.mcid] || '').toString().trim() === mcid) {
            const cd = childDisplayData[j];   // display values for clean text
            const detail = {
              engineNo:  cd[childCol.engineNo]  || '',
              chassisNo: cd[childCol.chassisNo] || '',
              model:     cd[childCol.model]     || '',
              modelCode: cd[childCol.modelCode] || '',
              color:     cd[childCol.color]     || ''
            };
            mcRecord.details.push(detail);
            if (!mcRecord.engineNo) mcRecord.engineNo = detail.engineNo;
            if (!mcRecord.chassisNo) mcRecord.chassisNo = detail.chassisNo;
            if (!mcRecord.model) mcRecord.model = detail.model;
            if (!mcRecord.modelCode) mcRecord.modelCode = detail.modelCode;
            if (!mcRecord.color) mcRecord.color = detail.color;
          }
        }
      }

      result.push(mcRecord);
    }

    console.log(`getMCInventory(): returned ${result.length} records`);
    return result;

  } catch (error) {
    console.error('getMCInventory() error:', error.toString());
    return [];
  }
}



// Units currently Available at a branch (for Transfer / Sale unit pickers).
function getAvailableUnits(branch) {
  return _readMCMaster(branch)
    .filter(u => (u.currentStatus || '').toLowerCase() === 'available');
}


// ── Motorcycle Profile ──────────────────────────────────────────────────────
// { unit: {...current state...}, timeline: [movements oldest→newest] }
function getUnitProfile(mcid) {
  mcid = (mcid || '').toString().trim();
  const unit = _readMCMaster('ALL').find(u => u.mcid === mcid) || null;
  // Order by APPEND ORDER (getMCHistory reads MC_MOVEMENTS top→bottom), which is
  // the true event sequence — MC_MOVEMENTS is append-only. We intentionally do
  // NOT sort by the typed MovementDate, so an out-of-sequence date (e.g. a SALE
  // dated before its IB-IN) can't scramble the story. [Adjustment #3]
  const timeline = getMCHistory(mcid);
  return { unit, timeline };
}
