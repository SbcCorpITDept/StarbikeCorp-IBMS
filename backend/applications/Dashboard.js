// Dashboard.js - Application metrics and motorcycle inventory dashboard metrics.
// Apps Script server files share one global scope; no imports are required.

// ============================================================================
// DASHBOARD BACK-END
// ============================================================================
// All dashboard functions accept an optional `branch` argument.
// branch === 'ALL' (or empty/undefined) → company-wide scope.
// Otherwise the function filters on the "Store Branch:" column of each sheet.
//
// _countRowsByBranch() is the shared engine — it walks a sheet once and
// returns matching row data so each dashboard function doesn't duplicate
// the read/filter logic.
// ============================================================================

/**
 * Walk a sheet once, return only rows whose "Store Branch:" matches `branch`.
 * Returns { headers, rows, branchIdx } so callers can index into specific cols.
 */
function _readBranchScopedRows(sheetName, branch) {
  const ss    = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { headers: [], rows: [], branchIdx: -1 };

  const data    = sheet.getDataRange().getValues();
  if (data.length < 2) return { headers: data[0] || [], rows: [], branchIdx: -1 };

  const headers   = data[0];
  const branchIdx = headers.indexOf('Store Branch:');
  const rows      = [];

  for (let i = 1; i < data.length; i++) {
    const cellBranch = branchIdx >= 0 ? data[i][branchIdx] : '';
    if (!_matchesBranch(cellBranch, branch)) continue;
    rows.push(data[i]);
  }
  return { headers, rows, branchIdx };
}

// =============================================
// DASHBOARD STATS — branch-scoped
// Replaces the old getDashboardStats() that ignored branch.
// =============================================
function getDashboardStats(branch) {
  try {
    const cas  = _readBranchScopedRows(sheetNameCAS,  branch);
    const cir  = _readBranchScopedRows(sheetNameCIR,  branch);
    const cash = _readBranchScopedRows(sheetNameCash, branch);

    return {
      casTotal:  cas.rows.length,
      cirTotal:  cir.rows.length,
      cashTotal: cash.rows.length,
      branch:    branch || 'ALL'
    };
  } catch (error) {
    console.error('getDashboardStats() error:', error.toString());
    return { casTotal: 0, cirTotal: 0, cashTotal: 0, branch: branch || 'ALL' };
  }
}

// =============================================
// CAS STATUS BREAKDOWN — branch-scoped
// =============================================
function getCASBreakdown(branch) {
  try {
    const { headers, rows } = _readBranchScopedRows(sheetNameCAS, branch);
    const statusIdx = headers.indexOf('Applicant Status:');
    if (statusIdx === -1) {
      console.error('"Applicant Status:" column not found in CAS');
      return { forReview: 0, approved: 0, disApproved: 0, rejected: 0, cancelled: 0 };
    }

    let forReview = 0, approved = 0, disApproved = 0, rejected = 0, cancelled = 0;
    rows.forEach(row => {
      const status = (row[statusIdx] || '').toString();
      if      (status.includes('Review'))      forReview++;
      else if (status.includes('Disapproved')) disApproved++;
      else if (status.includes('Approved'))    approved++;
      else if (status.includes('Rejected'))    rejected++;
      else if (status.includes('Cancelled'))   cancelled++;
    });
    return { forReview, approved, disApproved, rejected, cancelled };
  } catch (error) {
    console.error('getCASBreakdown() error:', error.toString());
    return { forReview: 0, approved: 0, disApproved: 0, rejected: 0, cancelled: 0 };
  }
}

// =============================================
// CIR STATUS BREAKDOWN — new, mirrors CAS
// CIR uses "Status / Condition:" header instead of "Applicant Status:".
// =============================================
function getCIRBreakdown(branch) {
  try {
    const { headers, rows } = _readBranchScopedRows(sheetNameCIR, branch);
    const statusIdx = headers.indexOf('Status / Condition:');
    if (statusIdx === -1) {
      console.error('"Status / Condition:" column not found in CIR');
      return { forApproval: 0, approved: 0, disApproved: 0, rejected: 0, cancelled: 0 };
    }

    let forApproval = 0, approved = 0, disApproved = 0, rejected = 0, cancelled = 0;
    rows.forEach(row => {
      const status = (row[statusIdx] || '').toString();
      if      (status.includes('Approval'))    forApproval++;
      else if (status.includes('Disapproved')) disApproved++;
      else if (status.includes('Approved'))    approved++;
      else if (status.includes('Rejected'))    rejected++;
      else if (status.includes('Cancelled'))   cancelled++;
    });
    return { forApproval, approved, disApproved, rejected, cancelled };
  } catch (error) {
    console.error('getCIRBreakdown() error:', error.toString());
    return { forApproval: 0, approved: 0, disApproved: 0, rejected: 0, cancelled: 0 };
  }
}

// =============================================
// NEEDS ATTENTION — the dashboard's insight layer
// Returns counts that surface what the user should act on:
//   - casPending   : CAS rows in "Review" status
//   - cirPending   : CIR rows in "Approval" status
//   - staleApps    : CAS rows older than 30 days still in non-terminal status
//                    (i.e. not Approved/Disapproved/Rejected/Cancelled)
// Stale detection uses the CAS "Date" column (signature date) as the
// proxy for "when this application was created". If your sheet has a
// dedicated created/submitted timestamp column, swap the header name below.
// =============================================
function getNeedsAttention(branch) {
  try {
    const STALE_DAYS = 30;
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

    // ── CAS pending + stale ─────────────────────────────────────────────
    const cas        = _readBranchScopedRows(sheetNameCAS, branch);
    const casStatIdx = cas.headers.indexOf('Applicant Status:');
    const casDateIdx = cas.headers.indexOf('Date of Application:');   // signature/created date

    let casPending = 0, staleApps = 0;
    cas.rows.forEach(row => {
      const status = (casStatIdx >= 0 ? row[casStatIdx] : '').toString();
      if (status.includes('Review')) casPending++;

      // Stale = older than cutoff AND not in a terminal state
      const isTerminal = /(Approved|Disapproved|Rejected|Cancelled)/.test(status);
      if (!isTerminal && casDateIdx >= 0) {
        const d = _parseSheetDate(row[casDateIdx]);
        if (d && d < staleCutoff) staleApps++;
      }
    });

    // ── CIR pending ─────────────────────────────────────────────────────
    const cir        = _readBranchScopedRows(sheetNameCIR, branch);
    const cirStatIdx = cir.headers.indexOf('Status / Condition:');
    let cirPending = 0;
    cir.rows.forEach(row => {
      const status = (cirStatIdx >= 0 ? row[cirStatIdx] : '').toString();
      if (status.includes('Approval')) cirPending++;
    });

    return { casPending, cirPending, staleApps, staleDays: STALE_DAYS };
  } catch (error) {
    console.error('getNeedsAttention() error:', error.toString());
    return { casPending: 0, cirPending: 0, staleApps: 0, staleDays: 30 };
  }
}

// =============================================
// ACTIVITY TREND — daily submission counts
// Returns: {
//   labels: ['Nov 1', 'Nov 2', ...],     // last `days` dates
//   cas:    [3, 5, 2, ...],              // counts per day
//   cir:    [...],
//   cash:   [...]
// }
// Counts are based on the "Date of Sales" (cash) and signature "Date" (CAS/CIR)
// columns. Anything outside the window is silently skipped.
// =============================================
function getActivityTrend(branch, days) {
  try {
    days = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));

    // Build the date range labels (oldest → newest)
    const now    = new Date();
    const start  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    const labels = [];
    const buckets = {};   // 'YYYY-MM-DD' → { cas, cir, cash }

    for (let i = 0; i < days; i++) {
      const d   = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = _dateKey(d);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      buckets[key] = { cas: 0, cir: 0, cash: 0 };
    }

    // Helper to bump a bucket given a raw cell value
    function tally(rawDate, kind) {
      const d = _parseSheetDate(rawDate);
      if (!d) return;
      const key = _dateKey(d);
      if (buckets[key]) buckets[key][kind]++;
    }

    // CAS
    const cas = _readBranchScopedRows(sheetNameCAS, branch);
    const casDateIdx = cas.headers.indexOf('Date');
    if (casDateIdx >= 0) cas.rows.forEach(r => tally(r[casDateIdx], 'cas'));

    // CIR — CIR sheet has its own "Date" or similar; using header 'Date' if present
    const cir = _readBranchScopedRows(sheetNameCIR, branch);
    const cirDateIdx = cir.headers.indexOf('Date');
    if (cirDateIdx >= 0) cir.rows.forEach(r => tally(r[cirDateIdx], 'cir'));

    // Cash — uses "Date of Sales"
    const cash = _readBranchScopedRows(sheetNameCash, branch);
    const cashDateIdx = cash.headers.indexOf('Date of Sales');
    if (cashDateIdx >= 0) cash.rows.forEach(r => tally(r[cashDateIdx], 'cash'));

    // Emit parallel arrays for Chart.js
    const casOut  = [];
    const cirOut  = [];
    const cashOut = [];
    for (let i = 0; i < days; i++) {
      const d   = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = _dateKey(d);
      casOut.push(buckets[key].cas);
      cirOut.push(buckets[key].cir);
      cashOut.push(buckets[key].cash);
    }

    return { labels, cas: casOut, cir: cirOut, cash: cashOut, days };
  } catch (error) {
    console.error('getActivityTrend() error:', error.toString());
    return { labels: [], cas: [], cir: [], cash: [], days: days || 30 };
  }
}

// =============================================
// CASH BREAKDOWN — Brand New vs Repo, with revenue
// Returns counts + total revenue split by sales type, for the last `days`
// days, scoped by branch. Used by the dashboard's revenue donut card.
//
// Cash schema uses:
//   "Sales Type"     → values contain "Brand New" or "Repo"
//   "SP (Cash)"      → selling price (number) — col AC in the sheet
//   "Date of Sales"  → date column for windowing
//
// Returns:
//   {
//     brandNew: { count, revenue },
//     repo:     { count, revenue },
//     total:    { count, revenue },
//     avgSale,                   // revenue / count, 0 if count = 0
//     days
//   }
// =============================================
function getCashBreakdown(branch, days) {
  try {
    days = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));

    const now    = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));

    const { headers, rows } = _readBranchScopedRows(sheetNameCash, branch);
    const typeIdx  = headers.indexOf('Sales Type');
    const priceIdx = headers.indexOf('SP (Cash)');
    const dateIdx  = headers.indexOf('Date of Sales');

    const out = {
      brandNew: { count: 0, revenue: 0 },
      repo:     { count: 0, revenue: 0 },
      total:    { count: 0, revenue: 0 },
      avgSale:  0,
      days:     days
    };

    rows.forEach(row => {
      // Date window
      if (dateIdx >= 0) {
        const d = _parseSheetDate(row[dateIdx]);
        if (!d || d < cutoff) return;
      }

      const type  = (typeIdx  >= 0 ? row[typeIdx]  : '').toString();
      // Parse selling price safely — strip commas, currency symbols, whitespace
      const raw   = priceIdx >= 0 ? row[priceIdx] : 0;
      const price = _parseMoney(raw);

      if (/brand/i.test(type)) {
        out.brandNew.count++;
        out.brandNew.revenue += price;
      } else if (/repo/i.test(type)) {
        out.repo.count++;
        out.repo.revenue += price;
      }
    });

    out.total.count   = out.brandNew.count   + out.repo.count;
    out.total.revenue = out.brandNew.revenue + out.repo.revenue;
    out.avgSale       = out.total.count > 0 ? (out.total.revenue / out.total.count) : 0;

    return out;
  } catch (error) {
    console.error('getCashBreakdown() error:', error.toString());
    return {
      brandNew: { count: 0, revenue: 0 },
      repo:     { count: 0, revenue: 0 },
      total:    { count: 0, revenue: 0 },
      avgSale:  0,
      days:     days || 30
    };
  }
}


// ── Inventory Dashboard ─────────────────────────────────────────────────────
function getInventoryDashboardStats(branch) {
  const units = _readMCMaster(branch);
  const stats = { total: units.length, available: 0, inTransit: 0, sold: 0, byBranch: {}, byModel: {} };
  units.forEach(u => {
    const s = (u.currentStatus || '').toLowerCase();
    if (s === 'available') stats.available++;
    else if (s === 'in transit') stats.inTransit++;
    else if (s === 'sold') stats.sold++;
    if (u.currentBranch) stats.byBranch[u.currentBranch] = (stats.byBranch[u.currentBranch] || 0) + 1;
    if (u.model) stats.byModel[u.model] = (stats.byModel[u.model] || 0) + 1;
  });
  stats.recent = _readObjects('TRANSACTION_HEADER')
    .filter(h => _matchesBranch(h.SourceLocation, branch) || _matchesBranch(h.DestinationLocation, branch))
    .sort((a, b) => _cmpDateDesc(a.TransactionDate, b.TransactionDate))
    .slice(0, 10)
    .map(h => ({
      transactionNo: h.TransactionNo, type: h.TransactionType, date: h.TransactionDate,
      from: h.SourceLocation, to: h.DestinationLocation, status: h.Status
    }));
  return stats;
}
