// Auth.js - Login validation and role-to-branch scope rules.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// ROLE SCOPE
// Only these roles are locked to their own branch. Every other role
// (Admin, IT, Head Office, Staff, ...) is unrestricted and sees all
// forms across every branch.
// =============================================
const BRANCH_RESTRICTED_ROLES = ['branch manager', 'ci', 'csa', 'area manager'];

/** Normalise a Role cell for comparison: lowercase, collapse spaces/punctuation. */
function _normalizeRole(role) {
  return (role || '').toString().trim().toLowerCase().replace(/[\s._-]+/g, ' ');
}

/** True when the role must only ever see its own branch's records. */
function _isBranchRestrictedRole(role) {
  return BRANCH_RESTRICTED_ROLES.indexOf(_normalizeRole(role)) !== -1;
}

/**
 * Effective data scope for a user.
 * Restricted roles keep their assigned branch; anyone else gets 'ALL'
 * so every branch filter downstream becomes a no-op.
 */
function resolveBranchScope(role, branch) {
  if (!_isBranchRestrictedRole(role)) return 'ALL';
  return (branch || '').toString().trim() || 'ALL';
}


// =============================================
// LOGIN VALIDATION
// Returns: { success, user: { id, name, email, role, branch, branchScope, fullName } }
// Branch comes from Column F ("Branch") in UserTable.
// branchScope is what the app actually filters on (see resolveBranchScope).
// =============================================
function validateLogin(email, password) {
  try {
    const ss    = SpreadsheetApp.openById(userSheetId);
    const sheet = ss.getSheetByName('UserTable');

    if (!sheet) throw new Error('UserTable sheet not found');

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    const col = {
      id:       headers.indexOf('ID'),
      email:    headers.indexOf('Email'),
      password: headers.indexOf('Password'),
      name:     headers.indexOf('Name'),
      role:     headers.indexOf('Role'),
      branch:   headers.indexOf('Branch')   // Column F — REQUIRED for filtering
    };

    if (col.email === -1 || col.password === -1) {
      throw new Error('Email or Password column not found in UserTable');
    }
    if (col.branch === -1) {
      throw new Error('"Branch" column not found in UserTable. Please add it (Column F).');
    }

    for (let i = 1; i < data.length; i++) {
      const row      = data[i];
      const rowEmail = (row[col.email]    || '').toString().trim().toLowerCase();
      const rowPass  = (row[col.password] || '').toString().trim();

      if (rowEmail === email.toLowerCase().trim() && rowPass === password) {
        const role   = row[col.role] || 'Staff';
        const branch = (row[col.branch] || '').toString().trim() || 'ALL';
        return {
          success: true,
          user: {
            id:       col.id >= 0 ? row[col.id] : i,
            name:     row[col.name]   || 'User',
            fullName: row[col.name]   || 'IBMS User',
            email:    rowEmail,
            role:     role,
            // Assigned branch exactly as entered in UserTable ('ALL' = none set)
            branch:   branch,
            // What the app filters on: own branch for Branch Manager / CI / CSA /
            // Area Manager, 'ALL' (every form, every branch) for any other role.
            branchScope: resolveBranchScope(role, branch),
            restricted:  _isBranchRestrictedRole(role)
          }
        };
      }
    }

    return { success: false, message: 'Invalid email or password' };

  } catch (error) {
    console.error('validateLogin error:', error);
    return { success: false, message: 'Login system error. Please contact administrator.' };
  }
}

