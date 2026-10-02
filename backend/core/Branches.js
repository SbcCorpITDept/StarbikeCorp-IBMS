// Branches.js - Branch/region directories and active branch/supplier dropdowns.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// AVAILABLE BRANCHES — distinct list across all three sheets
// Used to populate the manager's branch-switcher dropdown.
// =============================================
function getAvailableBranches() {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const set = new Set();

    [sheetNameCAS, sheetNameCIR, sheetNameCash].forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return;
      const idx = data[0].indexOf('Store Branch:');
      if (idx === -1) return;
      for (let i = 1; i < data.length; i++) {
        const b = (data[i][idx] || '').toString().trim();
        if (b) set.add(b);
      }
    });

    // Return sorted alphabetically
    return [...set].sort();
  } catch (error) {
    console.error('getAvailableBranches() error:', error.toString());
    return [];
  }
}

// =============================================
// BRANCH DIRECTORY — branches + their regions
// Used by the Region / Branch filter pair on the Customer Application,
// Credit Investigation and Cash Sales tables.
//
// Returns:
//   {
//     branches:  ['CMB - Cawayan', ...]      distinct 'Store Branch:' values
//                                            actually present in the 3 sheets
//     directory: [{ code, name, full, region }]  from the BRANCHES sheet
//     regions:   ['Bicol', ...]              distinct non-blank regions
//   }
//
// The BRANCHES sheet lives in the MC inventory spreadsheet and is the only
// place a Region is recorded, so it is the source for region grouping.
// A branch present in the form sheets but missing from BRANCHES simply has
// no region — it still shows in the Branch dropdown, just not under a region.
// =============================================
function getBranchDirectory() {
  var directory = [];
  var regions   = [];

  try {
    var seen = {};
    directory = _readObjects('BRANCHES')
      .filter(function (b) { return b.BranchCode || b.BranchName; })
      .filter(function (b) { return String(b.Active).toLowerCase() !== 'false'; })
      .map(function (b) {
        var code = (b.BranchCode || '').toString().trim();
        var name = (b.BranchName || '').toString().trim();
        var reg  = (b.Region     || '').toString().trim();
        if (reg && !seen[reg.toLowerCase()]) { seen[reg.toLowerCase()] = true; regions.push(reg); }
        return {
          code:   code,
          name:   name,
          // Canonical "CODE - Name" string — the same form stored in
          // 'Store Branch:' / UserTable.Branch / MC_MASTER.CurrentBranch.
          full:   (code && name) ? (code + ' - ' + name) : (code || name),
          region: reg
        };
      });
    regions.sort();
  } catch (error) {
    // No BRANCHES sheet (or no access) — degrade to branch-only filtering.
    console.error('getBranchDirectory(): BRANCHES unavailable —', error.toString());
  }

  return {
    branches:  getAvailableBranches(),
    directory: directory,
    regions:   regions
  };
}



// ── Lookups ──────────────────────────────────────────────────────────────

// Active motorcycle suppliers for the RR dropdown. Falls back to the seed list
// if the SUPPLIERS sheet is missing/empty. Returns array of names (strings).
function getSuppliers() {
  const rows = _readObjects('SUPPLIERS')
    .filter(s => s.SupplierName && String(s.Active).toLowerCase() !== 'false')
    .map(s => (s.SupplierName || '').toString().trim());
  if (rows.length) return rows;
  return MC_SUPPLIER_SEED.map(r => r[0]); // fallback so the dropdown is never empty
}

// Active branches for dropdowns. [{code, name, region}]
function getBranches() {
  return _readObjects('BRANCHES')
    .filter(b => b.BranchCode && String(b.Active).toLowerCase() !== 'false')
    .map(b => ({ code: b.BranchCode, name: b.BranchName, region: b.Region }));
}
