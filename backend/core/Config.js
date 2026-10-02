// Config.js - Spreadsheet IDs, sheet names, motorcycle schema, and seed data.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// SPREADSHEET CONFIG
// =============================================
const spreadsheetId  = '1CvtBP9_rhByDAzGfOwAXrQ_3Gs6-jPz4YrhxiXAjGnk';
const sheetNameCAS   = 'Applicant_Database';
const sheetNameCIR   = 'CIR_Database';
const sheetNameCash  = 'Cash-Sales_Database';

const userSheetId    = '1aYsoTnIDPqSrcDaUwCSgYVnFsPM6sbRezW7GG2191j8';


const MC_INVENTORY_SPREADSHEET_ID = '18yDG_RlaTWhx_ZkWiCxy8en5dryfrDC9crn1tU4_tW8';

// Unit Release (Sales) — one row per sale, in the MC inventory spreadsheet.
const sheetNameSales = 'SALES';

// Sale → CIR link columns. setupSalesSchema() adds these headers to CIR_Database.
// While SALE_CIR_WRITEBACK is false, no values are ever written under them.
const SALE_CIR_WRITEBACK = false;
const CIR_SALE_LINK_HEADERS = ['SaleTransactionID', 'SaleSINo', 'SaleMCID'];

// Canonical schema — sheet name → header row (order matters).
const MC_SCHEMA = {
  MC_MASTER: [
    'MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode', 'Color',
    'CurrentBranch', 'CurrentStatus', 'OriginalRR', 'DateReceived', 'LastUpdated',
    'UnitType'
  ],
  TRANSACTION_HEADER: [
    'TransactionID', 'TransactionNo', 'TransactionType', 'SourceLocation',
    'DestinationLocation', 'TransactionDate', 'CreatedBy', 'Status',
    'Remarks', 'LinkedTransactionNo'
  ],
  TRANSACTION_DETAILS: [
    'TransactionID', 'TransactionNo', 'MCID', 'EngineNo', 'ChassisNo',
    'Model', 'ModelCode'
  ],
  MC_MOVEMENTS: [
    'MovementID', 'MCID', 'TransactionNo', 'TransactionType', 'FromLocation',
    'ToLocation', 'MovementDate', 'PerformedBy', 'Remarks'
  ],
  BRANCHES: [
    'BranchCode', 'BranchName', 'Region', 'Active'
  ],
  SUPPLIERS: [
    'SupplierName', 'Active'
  ],
  SALES: [
    'TransactionID', 'AccountNo', 'CID', 'AID', 'CustomerName', 'ContactNo',
    'Address', 'UnitType', 'ATRNo', 'SINo', 'RCINo'
  ]
};

// ── SEED DATA — fill in your real branches (code, name, region, active) ──
// Leave the array empty to skip seeding and enter branches by hand later.
const MC_BRANCH_SEED = [
  // ['CTS-CAT', 'CTS-Cataingan', 'Bicol', true],
  // ['CTS-NAG', 'CTS-Naga',      'Bicol', true],
];

// ── SEED DATA — motorcycle suppliers (editable later via Admin Panel). ──
const MC_SUPPLIER_SEED = [
  // ['HONDA', true],
  // ['SUZUKI', true],
  // ['KAWASAKI', true],
  // ['YAMAHA', true],
  // ['TOP MOTORS', true],
  // ['KYMCO', true],
];
