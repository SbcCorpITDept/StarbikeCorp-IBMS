// SalesRules.js - Unit Release rules: value normalization and required documents.
// Apps Script server files share one global scope; no imports are required.

// Lowercase, trim, and collapse spaces/dots/dashes/underscores to one space,
// so 'Co-Maker', 'co maker' and 'CO_MAKER' compare equal.
function _normalizeToken(v) {
  return (v == null ? '' : v).toString().trim().toLowerCase().replace(/[\s._-]+/g, ' ');
}

// MC_MASTER.UnitType → 'Brand-New' | 'Repo' | 'Invalid'. Only known spellings are
// accepted; blank reads as Brand-New until the Receiving Report sets the type.
function _normalizeUnitType(v) {
  const t = (v == null ? '' : v).toString().trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === '' || t === 'brand-new' || t === 'brand new') return 'Brand-New';
  if (t === 'repo' || t === 'repossessed') return 'Repo';
  return 'Invalid';
}

// CIR "Status / Condition:" is Approved.
function _isApprovedStatus(v) { return _normalizeToken(v) === 'approved'; }

// CIR "Applicant" is Maker (Co-Maker records are never sold to).
function _isMakerApplicant(v) { return _normalizeToken(v) === 'maker'; }

// Document fields the user must fill for a unit type.
function _requiredSaleDocs(unitType) {
  if (unitType === 'Brand-New') return ['ATRNo', 'SINo'];
  if (unitType === 'Repo') return ['RCINo', 'SINo'];
  return [];
}

// Sale reference shown to users: SALE-{SINo}.
function _saleTransactionNo(siNo) {
  return 'SALE-' + (siNo == null ? '' : siNo).toString().trim();
}
