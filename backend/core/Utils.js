// Utils.js - Shared branch, date, currency, and column helpers.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// HELPER — branch filter
// Pass branch = 'ALL' to skip filtering (unrestricted roles).
// =============================================
function _matchesBranch(cellValue, branch) {
  if (!branch || branch === 'ALL') return true;
  return (cellValue || '').toString().trim().toLowerCase() === branch.toLowerCase();
}



/**
 * _parseMoney — coerce a sheet cell to a number safely.
 * Handles Number, "Php 45,000", "₱45,000.50", or junk.
 */
function _parseMoney(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const cleaned = v.toString().replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}



// =============================================
// DATE HELPERS (internal)
// _parseSheetDate handles both real Date objects from getValues()
// and string fallbacks like "11/15/2025".
// _dateKey returns 'YYYY-MM-DD' for bucket keying (timezone-stable).
// =============================================
function _parseSheetDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function _dateKey(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// =============================================
// UTILITY — "A" → 1, "B" → 2, "AB" → 28
// (kept for backward compat with any caller in your live file)
// =============================================
function columnLetterToNumber(letter) {
  letter = letter.toUpperCase();
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col;
}


// Date comparators (newest-first / oldest-first) tolerant of blank/invalid dates.
function _cmpDateDesc(a, b) {
  const da = _parseSheetDate(a), db = _parseSheetDate(b);
  return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
}
function _cmpDateAsc(a, b) { return -_cmpDateDesc(a, b); }
