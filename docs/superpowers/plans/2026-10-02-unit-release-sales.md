# Unit Release (Sales) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-unit "Create Sale" with a validated, two-step Unit Release (1 sale = 1 customer = 1 motorcycle) that records a SALE transaction, marks the unit Sold, and links the sale to the customer's CID/AID.

**Architecture:** Google Apps Script V8 web app. Server files at the repo root share one global scope (no imports). New pure rules go in `MCSalesRules.js`; Unit Release server functions in `MCSales.js`; the transaction writer is split so `createUnitRelease()` validates and writes under one script lock. Server code is unit-tested locally by loading the `.js` files into a Node `vm` context with in-memory fakes of the Google services. The UI lives in `Index.html` and is checked in a browser against a stubbed `google.script.run`.

**Tech Stack:** Google Apps Script (V8), Google Sheets, HTML + Tailwind (CDN) + vanilla JS, Node 24 (`node:test`, `node:vm`) for local tests, clasp 3.x for deploy.

**Spec:** `docs/superpowers/specs/2026-10-02-unit-release-sales-design.md`

## Global Constraints

- Business rule: **1 Sale = 1 Customer = 1 Motorcycle Unit** — exactly one `CID` and one `MCID` per sale.
- `TransactionType = SALE`, `Status = Completed`, `TransactionNo = SALE-{SINo}`; the raw SI number is stored separately in `SALES.SINo`.
- `SALES` headers, in order: `TransactionID, AccountNo, CID, AID, CustomerName, ContactNo, Address, UnitType, ATRNo, SINo, RCINo`.
- `CIR_Database` link headers `SaleTransactionID`, `SaleSINo`, `SaleMCID` — headers only, never values. `SALE_CIR_WRITEBACK = false`.
- `UnitType` normalization: blank / `brand-new` / `brand new` → `Brand-New`; `repo` / `repossessed` → `Repo`; anything else → `Invalid` (blocks the sale). Case-insensitive, trimmed.
- Customer eligibility: CIR `Store Branch:` = sale branch, `Status / Condition:` normalizes to `approved`, `Applicant` normalizes to `maker`, `CID` not already in `SALES.CID`.
- The browser supplies only `TransactionID` (server-issued), `MCID`, `CID`, `Scope`, `SaleDate`, `AccountNo`, `ATRNo`, `SINo`, `RCINo`, `CreatedBy`. Branch, customer details and unit details are always read on the server.
- `MC_MASTER` rows are never deleted; a sale only changes `CurrentStatus` to `Sold` (and `LastUpdated`).
- Receiving Report / IB-OUT / IB-IN / cancel behavior stays unchanged.
- Code style: match existing files — 2-space indent, a two-line file header comment (`// File.js - purpose.` / `// Apps Script server files share one global scope; no imports are required.`), `const`/arrow functions, single quotes.
- Local tests run with: `node --test "tests/*.test.js"` from the repo root.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Double-clicking Confirm or re-submitting the same form → only one sale is written; the repeat is rejected with the "form has expired" message. (Task 6, test `second submit with the same Transaction ID is rejected`)
- `MCID` / `CID` sent with stray spaces or different letter case → still matched; `SALES.CID` stores the CIR's own spelling. (Task 6, test `trims and case-folds MCID and CID from the browser`)
- CIR cells with odd spacing/case (`' APPROVED '`, `'MAKER'`, `'co_maker'`) → correct eligibility. (Task 5, test `getSaleCustomers applies branch, Approved, Maker and not-sold rules`)
- A unit whose `CurrentBranch` is blank → rejected, never treated as "all branches" (a blank branch makes `_matchesBranch` return true for everything). (Task 6, test `rejects a unit with no Current Branch`)
- `setupSalesSchema()` not run yet (no `SALES` sheet) → customer list still loads and the first release creates `SALES` with headers. (Task 5 and Task 6, tests `... when SALES sheet is missing`)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `.claspignore` | Create | Push only root `*.js`, `*.html`, `appsscript.json` (keeps `tests/`, `docs/` out of Apps Script). |
| `.gitignore` | Modify | Ignore `tests/ui/preview.html`. |
| `tests/harness.js` | Create | Loads server `.js` files into a Node `vm` with fake SpreadsheetApp / LockService / CacheService / Utilities / Session. |
| `tests/fixtures.js` | Create | Sheet data builders (`makeData`) and header constants. |
| `tests/*.test.js` | Create | `node:test` suites per task. |
| `tests/ui/mock-gas.js` | Create | Browser stub of `google.script.run` for UI checks. |
| `tests/ui/build-preview.js` | Create | Writes `tests/ui/preview.html` = `Index.html` + the stub. |
| `Config.js` | Modify | `sheetNameSales`, `SALE_CIR_WRITEBACK`, `CIR_SALE_LINK_HEADERS`, `MC_SCHEMA.SALES`, `MC_SCHEMA.MC_MASTER` + `UnitType`. |
| `MCSalesRules.js` | Create | Pure rules: `_normalizeToken`, `_normalizeUnitType`, `_isApprovedStatus`, `_isMakerApplicant`, `_requiredSaleDocs`, `_saleTransactionNo`. |
| `MCDatabase.js` | Modify | Add `_ensureHeaderColumn`, `_transactionIdExists`. |
| `MCTransactions.js` | Modify | Split `createTransaction` into lock wrapper + `_writeTransaction(ss, tx)`; reject SALE in the public wrapper. |
| `MCSetup.js` | Modify | Add `setupSalesSchema()`. |
| `MCInventory.js` | Modify | `_readMCMaster` adds `unitType`, `unitTypeRaw`. |
| `MCSales.js` | Modify | `getSales` (rewritten), `createSale` (disabled), `beginUnitRelease`, `getSaleCustomers`, `createUnitRelease` + private helpers. |
| `MCDiagnostics.js` | Modify | Fix `testPhase2Write` (IB-IN number, legacy sale now rejected); add `_purgeTestRows`, `_setMasterCellForTest`, `testUnitReleaseFlow`, `cleanupUnitReleaseTest`. |
| `Index.html` | Modify | Sales list columns/search; two-step Create Unit Release page; review modal. |
| `BACKEND_GUIDE.md`, `README.md` | Modify | New files, setup steps, how to run tests. |

---

### Task 1: Local test harness and clasp ignore

**Files:**
- Create: `tests/harness.js`, `tests/fixtures.js`, `tests/harness.test.js`, `.claspignore`

**Interfaces:**
- Produces: `loadApp(data) → { fn(name), run(name, ...args), get(expr), rows(bookKey, sheetName), book(bookKey), cache, lock, logs }` where `bookKey ∈ 'main' | 'users' | 'mc'`; `run`/`get`/`rows` return JSON-plain copies. `makeData(opts)` with `opts = { units, customers, sales, headers, details, withUnitType = true, withSalesSheet = true }`. Constants `BRANCH_A`, `BRANCH_B`, `MASTER_HEADERS` (11 base columns), `TX_HEADER`, `TX_DETAILS`, `MOVEMENTS`, `SALES_HEADERS`, `CIR_HEADERS`.

- [ ] **Step 1: Write the harness**

Create `tests/harness.js`:

```js
// tests/harness.js - Loads the Apps Script server files into a Node vm context
// with in-memory fakes for the Google services they call. Test-only; excluded
// from clasp push by .claspignore.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function displayOf(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v);
}

class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = (rows || []).map(r => r.slice()); }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows || 1, numCols || 1); }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() { return this; }
  _cell(r, c) {
    const row = this.rows[r - 1];
    const v = row ? row[c - 1] : undefined;
    return v === undefined ? '' : v;
  }
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c - 1) row.push('');
    row[c - 1] = v;
  }
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.numRows; i++) {
      const r = [];
      for (let j = 0; j < this.numCols; j++) r.push(this.sheet._cell(this.row + i, this.col + j));
      out.push(r);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map(r => r.map(displayOf)); }
  setValues(values) {
    values.forEach((r, i) => r.forEach((v, j) => this.sheet._set(this.row + i, this.col + j, v)));
    return this;
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
}

class FakeSpreadsheet {
  constructor(sheets) {
    this.sheets = {};
    Object.keys(sheets || {}).forEach(n => { this.sheets[n] = new FakeSheet(n, sheets[n]); });
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { this.sheets[name] = new FakeSheet(name, []); return this.sheets[name]; }
}

// Asia/Shanghai (UTC+8, no DST) — the time zone in appsscript.json.
function formatShanghai(d, fmt) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  const date = p(t.getUTCMonth() + 1) + '/' + p(t.getUTCDate()) + '/' + t.getUTCFullYear();
  if (fmt === 'MM/dd/yyyy') return date;
  return date + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
}

// Objects from the vm realm have a different Object.prototype; copy them so
// assert.deepStrictEqual compares plain data.
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function loadApp(data) {
  data = data || {};
  let uuidSeq = 0;
  const cache = new Map();
  const lock = { waits: 0, releases: 0 };
  const logs = [];
  const books = {};
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    Logger: { log: m => { logs.push(String(m)); } },
    LockService: {
      getScriptLock: () => ({
        waitLock() { lock.waits++; },
        tryLock() { lock.waits++; return true; },
        releaseLock() { lock.releases++; },
        hasLock: () => true
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: k => { cache.delete(k); }
      })
    },
    Utilities: {
      getUuid: () => 'uuid-' + (++uuidSeq),
      formatDate: (d, tz, fmt) => formatShanghai(d, fmt)
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Shanghai',
      getActiveUser: () => ({ getEmail: () => '' })
    },
    SpreadsheetApp: {
      openById: id => {
        if (!books[id]) throw new Error('Unknown spreadsheet: ' + id);
        return books[id];
      }
    }
  };
  vm.createContext(context);
  fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  });

  const ids = vm.runInContext('({ main: spreadsheetId, users: userSheetId, mc: MC_INVENTORY_SPREADSHEET_ID })', context);
  books[ids.main] = new FakeSpreadsheet(data.main);
  books[ids.users] = new FakeSpreadsheet(data.users);
  books[ids.mc] = new FakeSpreadsheet(data.mc);
  const byKey = { main: books[ids.main], users: books[ids.users], mc: books[ids.mc] };

  return {
    fn: name => vm.runInContext(name, context),
    run: (name, ...args) => plain(vm.runInContext(name, context)(...args)),
    get: expr => plain(vm.runInContext(expr, context)),
    rows: (bookKey, sheetName) => {
      const s = byKey[bookKey].getSheetByName(sheetName);
      return s ? plain(s.rows) : null;
    },
    book: bookKey => byKey[bookKey],
    cache: cache,
    lock: lock,
    logs: logs
  };
}

module.exports = { loadApp, plain };
```

- [ ] **Step 2: Write the fixtures**

Create `tests/fixtures.js`:

```js
// tests/fixtures.js - Sheet data builders for tests/harness.js.
'use strict';

const BRANCH_A = 'CTS-NAG - Naga';
const BRANCH_B = 'CTS-CAT - Cataingan';

const MASTER_HEADERS = ['MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode', 'Color',
  'CurrentBranch', 'CurrentStatus', 'OriginalRR', 'DateReceived', 'LastUpdated'];
const TX_HEADER = ['TransactionID', 'TransactionNo', 'TransactionType', 'SourceLocation',
  'DestinationLocation', 'TransactionDate', 'CreatedBy', 'Status', 'Remarks', 'LinkedTransactionNo'];
const TX_DETAILS = ['TransactionID', 'TransactionNo', 'MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode'];
const MOVEMENTS = ['MovementID', 'MCID', 'TransactionNo', 'TransactionType', 'FromLocation',
  'ToLocation', 'MovementDate', 'PerformedBy', 'Remarks'];
const SALES_HEADERS = ['TransactionID', 'AccountNo', 'CID', 'AID', 'CustomerName', 'ContactNo',
  'Address', 'UnitType', 'ATRNo', 'SINo', 'RCINo'];
const CIR_HEADERS = ['CID', 'ToWhom', 'Applicant', 'Type of Applicant:', 'Status / Condition:',
  'Store Branch:', 'ApplicantName', 'ACellNo.', 'Pres Address'];

function unitRow(u, withUnitType) {
  const row = [u.mcid, u.engineNo, u.chassisNo || 'CH-' + u.engineNo, u.model || 'XRM125',
    u.modelCode || 'XRM-01', u.color || 'RED', u.branch === undefined ? BRANCH_A : u.branch,
    u.status || 'Available', u.rr || 'RR-1', '09/01/2026', '09/01/2026 08:00:00'];
  if (withUnitType) row.push(u.unitType || '');
  return row;
}

function cirRow(c) {
  return [c.cid, c.aid === undefined ? 'AID-' + c.cid : c.aid, c.applicant || 'Maker',
    c.channel || 'Walk-in', c.status || 'Approved', c.branch === undefined ? BRANCH_A : c.branch,
    c.name || 'DELA CRUZ, JUAN', c.contact || '09170000000', c.address || 'NAGA CITY'];
}

function saleRow(s) {
  return [s.transactionId, s.accountNo || 'ACC-OLD', s.cid, s.aid || '', s.name || 'OLD CUSTOMER',
    '', '', s.unitType || 'Brand-New', s.atrNo || 'ATR-OLD', s.siNo, s.rciNo || ''];
}

function makeData(opts) {
  opts = opts || {};
  const withUnitType = opts.withUnitType !== false;
  const mc = {
    MC_MASTER: [withUnitType ? MASTER_HEADERS.concat(['UnitType']) : MASTER_HEADERS.slice()]
      .concat((opts.units || []).map(u => unitRow(u, withUnitType))),
    TRANSACTION_HEADER: [TX_HEADER.slice()].concat(opts.headers || []),
    TRANSACTION_DETAILS: [TX_DETAILS.slice()].concat(opts.details || []),
    MC_MOVEMENTS: [MOVEMENTS.slice()]
  };
  if (opts.withSalesSheet !== false) {
    mc.SALES = [SALES_HEADERS.slice()].concat((opts.sales || []).map(saleRow));
  }
  return {
    main: {
      CIR_Database: [CIR_HEADERS.slice()].concat((opts.customers || []).map(cirRow)),
      Applicant_Database: [['AID', 'ApplicantName', 'Store Branch:']],
      'Cash-Sales_Database': [['CSID']]
    },
    users: {},
    mc: mc
  };
}

module.exports = {
  BRANCH_A, BRANCH_B, MASTER_HEADERS, TX_HEADER, TX_DETAILS, MOVEMENTS, SALES_HEADERS, CIR_HEADERS,
  makeData
};
```

- [ ] **Step 3: Write a characterization test of the existing `createTransaction`**

Create `tests/harness.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

test('createTransaction RR writes header, details, movement and MC_MASTER', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', {
    TransactionNo: 'RR-100', TransactionType: 'RR', Source: 'HONDA', Destination: BRANCH_A,
    TransactionDate: '2026-10-01', CreatedBy: 'tester',
    Details: [{ MCID: 'MC-1', EngineNo: 'ENG1', ChassisNo: 'CHS1', Model: 'XRM125', ModelCode: 'X1', Color: 'RED' }]
  });
  assert.equal(res.success, true);
  assert.equal(res.transactionNo, 'RR-100');

  const header = app.rows('mc', 'TRANSACTION_HEADER');
  assert.deepEqual(header[1], [res.transactionId, 'RR-100', 'RR', 'HONDA', BRANCH_A, '10/01/2026', 'tester', 'Completed', '', '']);
  assert.deepEqual(app.rows('mc', 'TRANSACTION_DETAILS')[1], [res.transactionId, 'RR-100', 'MC-1', 'ENG1', 'CHS1', 'XRM125', 'X1']);

  const move = app.rows('mc', 'MC_MOVEMENTS')[1];
  assert.deepEqual([move[1], move[2], move[3], move[4], move[5]], ['MC-1', 'RR-100', 'RR', 'HONDA', BRANCH_A]);

  const master = app.rows('mc', 'MC_MASTER')[1];
  assert.deepEqual([master[0], master[6], master[7], master[8]], ['MC-1', BRANCH_A, 'Available', 'RR-100']);
  assert.equal(app.lock.waits, 1);
  assert.equal(app.lock.releases, 1);
});

test('createTransaction rejects a duplicate TransactionNo', () => {
  const app = loadApp(makeData());
  const tx = { TransactionNo: 'RR-1', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-1' }] };
  assert.equal(app.run('createTransaction', tx).success, true);
  const again = app.run('createTransaction', tx);
  assert.equal(again.success, false);
  assert.match(again.message, /already exists/);
});
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/*.test.js"`
Expected: 2 tests PASS. (This pins current behavior; there is no red step because it is a characterization test.) If a test fails, fix the harness, not the server code.

- [ ] **Step 5: Add `.claspignore`**

Create `.claspignore`:

```
# clasp pushes only the Apps Script sources at the project root.
# tests/, docs/ and any other folder stay local.
**/**
!appsscript.json
!*.js
!*.html
```

- [ ] **Step 6: Verify clasp will not push the tests**

Run: `clasp show-file-status` (on older clasp: `clasp status`)
Expected: the "to push" list contains only root files (`Code.js`, `Index.html`, `appsscript.json`, …) and none under `tests/` or `docs/`. If clasp reports it is not logged in, record that in the task notes and continue — the pattern is verified again before the first `clasp push` (Task 11).

- [ ] **Step 7: Commit**

```powershell
git add .claspignore tests/harness.js tests/fixtures.js tests/harness.test.js
git commit -m @'
Add local Apps Script test harness and clasp ignore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Sales configuration and pure rules

**Files:**
- Modify: `Config.js` (after line 15 `MC_INVENTORY_SPREADSHEET_ID`, and inside `MC_SCHEMA`)
- Create: `MCSalesRules.js`
- Test: `tests/sales-rules.test.js`

**Interfaces:**
- Produces (globals): `sheetNameSales = 'SALES'`, `SALE_CIR_WRITEBACK = false`, `CIR_SALE_LINK_HEADERS = ['SaleTransactionID','SaleSINo','SaleMCID']`, `MC_SCHEMA.SALES` (array, see Global Constraints), `MC_SCHEMA.MC_MASTER` ending in `'UnitType'`.
- Produces (functions): `_normalizeToken(v) → string`, `_normalizeUnitType(v) → 'Brand-New'|'Repo'|'Invalid'`, `_isApprovedStatus(v) → boolean`, `_isMakerApplicant(v) → boolean`, `_requiredSaleDocs(unitType) → string[]` (field names `ATRNo`/`RCINo`/`SINo`), `_saleTransactionNo(siNo) → 'SALE-' + trimmed siNo`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sales-rules.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, SALES_HEADERS } = require('./fixtures');

const app = loadApp(makeData());

test('Config declares the SALES schema, UnitType column and CIR link headers', () => {
  assert.equal(app.get('sheetNameSales'), 'SALES');
  assert.deepEqual(app.get('MC_SCHEMA.SALES'), SALES_HEADERS);
  assert.equal(app.get('MC_SCHEMA.MC_MASTER[MC_SCHEMA.MC_MASTER.length - 1]'), 'UnitType');
  assert.equal(app.get('SALE_CIR_WRITEBACK'), false);
  assert.deepEqual(app.get('CIR_SALE_LINK_HEADERS'), ['SaleTransactionID', 'SaleSINo', 'SaleMCID']);
});

test('_normalizeUnitType accepts only known values', () => {
  const cases = {
    '': 'Brand-New', '   ': 'Brand-New', 'Brand-New': 'Brand-New', 'brand new': 'Brand-New',
    'BRAND-NEW': 'Brand-New', 'Brand  New': 'Brand-New',
    'repo': 'Repo', 'REPO': 'Repo', 'Repossessed': 'Repo', ' repossessed ': 'Repo',
    'Demo': 'Invalid', 'used': 'Invalid', 'brand_new': 'Invalid', 'Repo unit': 'Invalid'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(app.run('_normalizeUnitType', input), expected, JSON.stringify(input));
  }
  assert.equal(app.run('_normalizeUnitType', null), 'Brand-New');
  assert.equal(app.run('_normalizeUnitType', undefined), 'Brand-New');
});

test('_isApprovedStatus is case- and space-insensitive', () => {
  ['Approved', ' APPROVED ', 'approved'].forEach(v => assert.equal(app.run('_isApprovedStatus', v), true, v));
  ['For Approval', 'Disapproved', 'Rejected', ''].forEach(v => assert.equal(app.run('_isApprovedStatus', v), false, v));
});

test('_isMakerApplicant accepts Maker and excludes every Co-Maker spelling', () => {
  ['Maker', 'MAKER', ' maker '].forEach(v => assert.equal(app.run('_isMakerApplicant', v), true, v));
  ['Co-Maker', 'co_maker', 'CO MAKER', 'Comaker', ''].forEach(v => assert.equal(app.run('_isMakerApplicant', v), false, v));
});

test('_requiredSaleDocs depends on the unit type', () => {
  assert.deepEqual(app.run('_requiredSaleDocs', 'Brand-New'), ['ATRNo', 'SINo']);
  assert.deepEqual(app.run('_requiredSaleDocs', 'Repo'), ['RCINo', 'SINo']);
  assert.deepEqual(app.run('_requiredSaleDocs', 'Invalid'), []);
});

test('_saleTransactionNo prefixes the trimmed SI number', () => {
  assert.equal(app.run('_saleTransactionNo', ' SI-0001 '), 'SALE-SI-0001');
  assert.equal(app.run('_saleTransactionNo', 12345), 'SALE-12345');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: the 6 new tests FAIL (`sheetNameSales is not defined`, `_normalizeUnitType is not defined`, …); Task 1 tests still PASS.

- [ ] **Step 3: Add the configuration**

In `Config.js`, after the line `const MC_INVENTORY_SPREADSHEET_ID = '18yDG_RlaTWhx_ZkWiCxy8en5dryfrDC9crn1tU4_tW8';` add:

```js
// Unit Release (Sales) — one row per sale, in the MC inventory spreadsheet.
const sheetNameSales = 'SALES';

// Sale → CIR link columns. setupSalesSchema() adds these headers to CIR_Database.
// While SALE_CIR_WRITEBACK is false, no values are ever written under them.
const SALE_CIR_WRITEBACK = false;
const CIR_SALE_LINK_HEADERS = ['SaleTransactionID', 'SaleSINo', 'SaleMCID'];
```

In `MC_SCHEMA`, replace the `MC_MASTER` entry with:

```js
  MC_MASTER: [
    'MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode', 'Color',
    'CurrentBranch', 'CurrentStatus', 'OriginalRR', 'DateReceived', 'LastUpdated',
    'UnitType'
  ],
```

and replace the `SUPPLIERS` entry (the last entry, just before the closing `};`) with:

```js
  SUPPLIERS: [
    'SupplierName', 'Active'
  ],
  SALES: [
    'TransactionID', 'AccountNo', 'CID', 'AID', 'CustomerName', 'ContactNo',
    'Address', 'UnitType', 'ATRNo', 'SINo', 'RCINo'
  ]
```

- [ ] **Step 4: Create `MCSalesRules.js`**

```js
// MCSalesRules.js - Unit Release rules: value normalization and required documents.
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add Config.js MCSalesRules.js tests/sales-rules.test.js
git commit -m @'
Add Unit Release config and sales rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Split `createTransaction` into a lock wrapper and `_writeTransaction`

**Files:**
- Modify: `MCTransactions.js:16-108` (`createTransaction`)
- Test: `tests/transactions.test.js`

**Interfaces:**
- Consumes: `_mcSS()`, `_ensureSheetWithHeaders`, `_transactionNoExists`, `_appendRow`, `_upsertMCMaster`, `_uuid`, `_normalizeDate`, `_mcToday` (all existing in `MCDatabase.js`).
- Produces: `_writeTransaction(ss, tx) → { success, transactionNo, transactionId } | { success:false, message }` — takes no lock; honors `tx.TransactionID` when non-blank. `createTransaction(tx)` keeps its signature and results.

- [ ] **Step 1: Write the failing tests**

Create `tests/transactions.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

const rr = extra => Object.assign({
  TransactionNo: 'RR-7', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-7' }]
}, extra || {});

test('createTransaction uses a provided TransactionID', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', rr({ TransactionID: 'server-issued-1' }));
  assert.equal(res.transactionId, 'server-issued-1');
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER')[1][0], 'server-issued-1');
  assert.equal(app.rows('mc', 'TRANSACTION_DETAILS')[1][0], 'server-issued-1');
});

test('createTransaction still mints a TransactionID when none is given', () => {
  const app = loadApp(makeData());
  const res = app.run('createTransaction', rr());
  assert.match(res.transactionId, /^uuid-\d+$/);
});

test('_writeTransaction writes without taking the script lock', () => {
  const app = loadApp(makeData());
  const ss = app.fn('_mcSS')();
  const res = app.fn('_writeTransaction')(ss, rr({ TransactionID: 'tx-9' }));
  assert.equal(res.success, true);
  assert.equal(res.transactionId, 'tx-9');
  assert.equal(app.lock.waits, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: `uses a provided TransactionID` FAILS (ID is `uuid-1`), `_writeTransaction writes without…` FAILS (`_writeTransaction is not defined`); the minting test PASSES.

- [ ] **Step 3: Implement the split**

In `MCTransactions.js`, replace the whole `function createTransaction(tx) { ... }` (lines 16–108, from `function createTransaction(tx) {` through its closing `}` before the `recordRR` doc comment) with:

```js
function createTransaction(tx) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return _writeTransaction(_mcSS(), tx);
  } catch (error) {
    console.error('createTransaction error:', error.toString());
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * _writeTransaction(ss, tx) — validates and writes one transaction (header,
 * details, movements, MC_MASTER). Takes NO lock: the caller must already hold
 * the script lock (createTransaction, createUnitRelease). Uses tx.TransactionID
 * when given (server-issued), otherwise mints a new UUID.
 */
function _writeTransaction(ss, tx) {
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

  const transactionId = (tx.TransactionID || '').toString().trim() || _uuid();

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
}
```

Leave the doc comment above `createTransaction` and the `recordRR` function unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS (including Task 1's characterization tests — `createTransaction` results are unchanged).

- [ ] **Step 5: Commit**

```powershell
git add MCTransactions.js tests/transactions.test.js
git commit -m @'
Split createTransaction into lock wrapper and _writeTransaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: `setupSalesSchema()`

**Files:**
- Modify: `MCDatabase.js` (add `_ensureHeaderColumn` after `_headerMap`, line ~111)
- Modify: `MCSetup.js` (append after `setupDatabase`)
- Test: `tests/setup-sales-schema.test.js`

**Interfaces:**
- Consumes: `sheetNameSales`, `MC_SCHEMA.SALES`, `CIR_SALE_LINK_HEADERS`, `sheetNameCIR`, `spreadsheetId` (Config), `_mcSS`, `_headerMap`.
- Produces: `_ensureHeaderColumn(sheet, header) → 1-based column` (adds the header after the last column if missing; never writes below row 1). `setupSalesSchema() → report string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/setup-sales-schema.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, SALES_HEADERS } = require('./fixtures');

test('setupSalesSchema creates SALES, backfills UnitType and adds CIR headers only', () => {
  const app = loadApp(makeData({
    withUnitType: false, withSalesSheet: false,
    units: [{ mcid: 'MC-1', engineNo: 'E1' }, { mcid: 'MC-2', engineNo: 'E2' }],
    customers: [{ cid: 'CID-1' }]
  }));
  // A stray row without an MCID must not receive a UnitType.
  app.book('mc').getSheetByName('MC_MASTER').appendRow(['', '', '', '', '', '', '', '', '', '', '']);

  const report = app.run('setupSalesSchema');

  assert.deepEqual(app.rows('mc', 'SALES'), [SALES_HEADERS]);
  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master[0][11], 'UnitType');
  assert.equal(master[1][11], 'Brand-New');
  assert.equal(master[2][11], 'Brand-New');
  assert.equal(master[3][11] || '', '');

  const cir = app.rows('main', 'CIR_Database');
  assert.deepEqual(cir[0].slice(-3), ['SaleTransactionID', 'SaleSINo', 'SaleMCID']);
  assert.equal(cir[1].length, 9, 'no values are written under the new CIR headers');
  assert.match(report, /CREATED  SALES/);
});

test('setupSalesSchema is safe to re-run and keeps existing UnitType values', () => {
  const app = loadApp(makeData({
    units: [{ mcid: 'MC-1', engineNo: 'E1', unitType: 'Repo' }, { mcid: 'MC-2', engineNo: 'E2' }],
    customers: [{ cid: 'CID-1' }]
  }));
  app.run('setupSalesSchema');
  app.run('setupSalesSchema');

  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master[0].filter(h => h === 'UnitType').length, 1);
  assert.equal(master[1][11], 'Repo');
  assert.equal(master[2][11], 'Brand-New');
  assert.equal(app.rows('mc', 'SALES').length, 1);
  assert.equal(app.rows('main', 'CIR_Database')[0].filter(h => h === 'SaleSINo').length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: both new tests FAIL with `setupSalesSchema is not defined`.

- [ ] **Step 3: Add `_ensureHeaderColumn`**

In `MCDatabase.js`, directly after the `_headerMap` function, add:

```js
// 1-based column of `header` in row 1. Appends the header after the last column
// when it is missing. Never writes below row 1.
function _ensureHeaderColumn(sheet, header) {
  const map = _headerMap(sheet);
  if (map[header] !== undefined) return map[header] + 1;
  const col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(header);
  return col;
}
```

- [ ] **Step 4: Add `setupSalesSchema`**

Append to the end of `MCSetup.js`:

```js

// =====================================================================
// ===============  UNIT RELEASE (SALES) — SCHEMA SETUP  ================
// =====================================================================
// Run setupSalesSchema() ONCE from the Apps Script editor. Safe to re-run:
//   • Creates the SALES sheet with MC_SCHEMA.SALES headers if missing.
//   • Adds MC_MASTER.UnitType and sets BLANK cells (rows with an MCID) to Brand-New.
//     Change repossessed units to Repo by hand afterward.
//   • Adds the CIR_Database sale-link headers — headers only, no values.
// Afterward, regenerate the CIR_Database table structure in AppSheet once.
// =====================================================================
function setupSalesSchema() {
  const log = [];
  const mc = _mcSS();

  // 1) SALES sheet
  if (mc.getSheetByName(sheetNameSales)) {
    log.push('OK       ' + sheetNameSales + '  (already exists)');
  } else {
    const headers = MC_SCHEMA.SALES;
    const sales = mc.insertSheet(sheetNameSales);
    sales.getRange(1, 1, 1, headers.length).setValues([headers]);
    sales.setFrozenRows(1);
    sales.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    log.push('CREATED  ' + sheetNameSales + '  (' + headers.length + ' cols)');
  }

  // 2) MC_MASTER.UnitType header + blank backfill
  const master = mc.getSheetByName('MC_MASTER');
  if (!master) {
    log.push('SKIP     MC_MASTER not found — run setupDatabase() first');
  } else {
    const typeCol = _ensureHeaderColumn(master, 'UnitType');
    const mcidCol = _headerMap(master)['MCID'];
    let filled = 0;
    if (mcidCol !== undefined && master.getLastRow() > 1) {
      const n = master.getLastRow() - 1;
      const ids = master.getRange(2, mcidCol + 1, n, 1).getValues();
      const typeRange = master.getRange(2, typeCol, n, 1);
      const types = typeRange.getValues();
      types.forEach(function (r, i) {
        const hasId = (ids[i][0] == null ? '' : ids[i][0]).toString().trim() !== '';
        const blank = (r[0] == null ? '' : r[0]).toString().trim() === '';
        if (hasId && blank) { r[0] = 'Brand-New'; filled++; }
      });
      if (filled) typeRange.setValues(types);
    }
    log.push('OK       MC_MASTER.UnitType  (' + filled + ' blank cell(s) set to Brand-New)');
  }

  // 3) CIR_Database link headers (no values)
  const cir = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetNameCIR);
  if (!cir) {
    log.push('SKIP     ' + sheetNameCIR + ' not found');
  } else {
    const before = _headerMap(cir);
    CIR_SALE_LINK_HEADERS.forEach(function (h) {
      _ensureHeaderColumn(cir, h);
      log.push((before[h] === undefined ? 'ADDED    ' : 'OK       ') + sheetNameCIR + '.' + h);
    });
  }

  const report = log.join('\n');
  Logger.log('setupSalesSchema() complete:\n' + report);
  return report;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add MCDatabase.js MCSetup.js tests/setup-sales-schema.test.js
git commit -m @'
Add setupSalesSchema for SALES, UnitType and CIR link headers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: Unit type on inventory reads and the eligible-customer list

**Files:**
- Modify: `MCInventory.js` (`_readMCMaster`, the `const rec = { ... }` block at lines ~69-95)
- Modify: `MCSales.js` (add helpers and `getSaleCustomers`)
- Test: `tests/sale-customers.test.js`

**Interfaces:**
- Consumes: `_normalizeUnitType`, `_isApprovedStatus`, `_isMakerApplicant`, `_saleTransactionNo` (Task 2), `_readObjects`, `_matchesBranch`, `sheetNameCIR`, `sheetNameSales`, `spreadsheetId`.
- Produces:
  - `_readMCMaster(branch)` records gain `unitType: 'Brand-New'|'Repo'|'Invalid'` and `unitTypeRaw: string`; `getAvailableUnits(branch)` therefore returns them too.
  - `_readCIRCustomers() → [{ cid, aid, applicant, status, branch, name, contact, address }]` (`aid` = raw `ToWhom`).
  - `_soldCIDSet() → { [lowercased CID]: SALES row object }`.
  - `_isEligibleCustomer(c, branch) → boolean`.
  - `getSaleCustomers(branch) → [{ cid, aid, name, contact, address }]` sorted by name; `[]` for blank/`ALL`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sale-customers.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B } = require('./fixtures');

test('available units carry a normalized unitType and the raw cell text', () => {
  const app = loadApp(makeData({ units: [
    { mcid: 'MC-1', engineNo: 'E1', unitType: '' },
    { mcid: 'MC-2', engineNo: 'E2', unitType: 'repossessed' },
    { mcid: 'MC-3', engineNo: 'E3', unitType: 'Demo' }
  ] }));
  const units = app.run('getAvailableUnits', BRANCH_A);
  assert.deepEqual(units.map(u => [u.mcid, u.unitType, u.unitTypeRaw]),
    [['MC-1', 'Brand-New', ''], ['MC-2', 'Repo', 'repossessed'], ['MC-3', 'Invalid', 'Demo']]);
});

test('units read as Brand-New when MC_MASTER has no UnitType column yet', () => {
  const app = loadApp(makeData({ withUnitType: false, units: [{ mcid: 'MC-1', engineNo: 'E1' }] }));
  const [u] = app.run('getAvailableUnits', BRANCH_A);
  assert.equal(u.unitType, 'Brand-New');
  assert.equal(u.unitTypeRaw, '');
});

const customers = [
  { cid: 'CID-1', aid: 'AID-777', name: 'SANTOS, ANA', contact: '0917-1', address: 'NAGA' },
  { cid: 'CID-2', applicant: 'Co-Maker', name: 'CO MAKER, ONE' },
  { cid: 'CID-3', status: 'For Approval', name: 'PENDING, ONE' },
  { cid: 'CID-4', branch: BRANCH_B, name: 'OTHER BRANCH, ONE' },
  { cid: 'CID-5', status: ' APPROVED ', applicant: 'MAKER', name: 'ABAD, BEN' },
  { cid: 'CID-6', name: 'ALREADY SOLD, ONE' },
  { cid: 'CID-7', applicant: 'co_maker', name: 'CO MAKER, TWO' },
  { cid: '', name: 'NO CID, ONE' }
];

test('getSaleCustomers applies branch, Approved, Maker and not-sold rules', () => {
  const app = loadApp(makeData({ customers, sales: [{ transactionId: 'old-1', cid: 'cid-6', siNo: 'SI-OLD' }] }));
  const rows = app.run('getSaleCustomers', BRANCH_A);
  assert.deepEqual(rows.map(c => c.cid), ['CID-5', 'CID-1']);   // sorted by name
  assert.deepEqual(rows[1], { cid: 'CID-1', aid: 'AID-777', name: 'SANTOS, ANA', contact: '0917-1', address: 'NAGA' });
});

test('getSaleCustomers matches the branch case-insensitively', () => {
  const app = loadApp(makeData({ customers }));
  assert.deepEqual(app.run('getSaleCustomers', BRANCH_A.toUpperCase()).map(c => c.cid).sort(), ['CID-1', 'CID-5', 'CID-6']);
});

test('getSaleCustomers returns nothing without a specific branch', () => {
  const app = loadApp(makeData({ customers }));
  assert.deepEqual(app.run('getSaleCustomers', 'ALL'), []);
  assert.deepEqual(app.run('getSaleCustomers', ''), []);
  assert.deepEqual(app.run('getSaleCustomers'), []);
});

test('getSaleCustomers works when SALES sheet is missing', () => {
  const app = loadApp(makeData({ customers, withSalesSheet: false }));
  assert.deepEqual(app.run('getSaleCustomers', BRANCH_A).map(c => c.cid).sort(), ['CID-1', 'CID-5', 'CID-6']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: the two unit-type tests FAIL (`unitType` undefined); the four customer tests FAIL (`getSaleCustomers is not defined`).

- [ ] **Step 3: Add unit type to `_readMCMaster`**

In `MCInventory.js`, inside `_readMCMaster`, replace:

```js
    const rec = {
      mcid: mcid,
```

with:

```js
    const unitTypeRaw = mh['UnitType'] === undefined ? '' : (row[mh['UnitType']] || '');
    const rec = {
      mcid: mcid,
      unitType: _normalizeUnitType(unitTypeRaw),
      unitTypeRaw: unitTypeRaw,
```

- [ ] **Step 4: Add the customer helpers and `getSaleCustomers`**

Append to the end of `MCSales.js`:

```js

// ── Unit Release: customers ─────────────────────────────────────────────────

// CIR_Database rows as customer records. `aid` is the raw ToWhom value (the
// Applicant_Database AID), never the resolved maker name.
function _readCIRCustomers() {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetNameCIR);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getDisplayValues();
  const h = {};
  data[0].forEach((name, i) => { h[(name || '').toString().trim()] = i; });
  const cell = (row, name) => (h[name] === undefined ? '' : (row[h[name]] || '').toString().trim());
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cid = cell(row, 'CID');
    if (!cid) continue;
    out.push({
      cid: cid,
      aid: cell(row, 'ToWhom'),
      applicant: cell(row, 'Applicant'),
      status: cell(row, 'Status / Condition:'),
      branch: cell(row, 'Store Branch:'),
      name: cell(row, 'ApplicantName'),
      contact: cell(row, 'ACellNo.'),
      address: cell(row, 'Pres Address')
    });
  }
  return out;
}

// CIDs that already have a Unit Release → their SALES row (keys lowercased).
function _soldCIDSet() {
  const sold = {};
  _readObjects(sheetNameSales).forEach(s => {
    const cid = (s.CID || '').toString().trim().toLowerCase();
    if (cid) sold[cid] = s;
  });
  return sold;
}

// Approved Maker CIR at exactly this branch. `branch` must be a real branch —
// _matchesBranch treats blank/'ALL' as "everything".
function _isEligibleCustomer(c, branch) {
  return _matchesBranch(c.branch, branch) && _isApprovedStatus(c.status) && _isMakerApplicant(c.applicant);
}

// Customers the branch can release a unit to: approved Makers with no sale yet.
function getSaleCustomers(branch) {
  branch = (branch || '').toString().trim();
  if (!branch || branch.toUpperCase() === 'ALL') return [];
  const sold = _soldCIDSet();
  return _readCIRCustomers()
    .filter(c => _isEligibleCustomer(c, branch) && !sold[c.cid.toLowerCase()])
    .map(c => ({ cid: c.cid, aid: c.aid, name: c.name, contact: c.contact, address: c.address }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add MCInventory.js MCSales.js tests/sale-customers.test.js
git commit -m @'
Add unit type to inventory reads and eligible sale customers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: `beginUnitRelease` and `createUnitRelease`

**Files:**
- Modify: `MCDatabase.js` (add `_transactionIdExists` after `_transactionNoExists`)
- Modify: `MCSales.js` (append)
- Test: `tests/unit-release.test.js`

**Interfaces:**
- Consumes: Task 2 rules, Task 3 `_writeTransaction(ss, tx)`, Task 5 `_readCIRCustomers`, `_soldCIDSet`, `_isEligibleCustomer`, `_readMCMaster` (with `unitType`, `unitTypeRaw`), `_transactionNoExists`, `_ensureSheetWithHeaders`, `_appendRow`, `_normalizeDate`, `_uuid`, `_mcSS`.
- Produces:
  - `beginUnitRelease() → { transactionId }` (cache key `UR_TXN_<id>`, 6 h).
  - `createUnitRelease(payload) → { success:true, transactionId, transactionNo } | { success:false, message }`.
  - `_transactionIdExists(ss, transactionId) → boolean`.
  - Constants `UNIT_RELEASE_TTL_SECONDS`, `UNIT_RELEASE_EXPIRED_MSG`, `UNIT_RELEASE_ONE_EACH_MSG`, `SALE_DISABLED_MSG` (`'Create Sale is no longer supported. Use Unit Release.'`, used by Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit-release.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B, SALES_HEADERS } = require('./fixtures');

const EXPIRED = 'This release form has expired. Please start a new Unit Release.';
const ONE_EACH = 'A Unit Release must contain exactly one motorcycle and one customer.';

function setup(extra) {
  const app = loadApp(makeData(Object.assign({
    units: [
      { mcid: 'MC-1', engineNo: 'ENG1', branch: BRANCH_A, unitType: '' },
      { mcid: 'MC-2', engineNo: 'ENG2', branch: BRANCH_A, unitType: 'Repo' },
      { mcid: 'MC-3', engineNo: 'ENG3', branch: BRANCH_B, unitType: 'Brand-New' },
      { mcid: 'MC-4', engineNo: 'ENG4', branch: BRANCH_A, unitType: 'Demo' },
      { mcid: 'MC-5', engineNo: 'ENG5', branch: BRANCH_A, status: 'Sold' },
      { mcid: 'MC-6', engineNo: 'ENG6', branch: '' }
    ],
    customers: [
      { cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', contact: '09170000001', address: 'NAGA CITY', branch: BRANCH_A },
      { cid: 'CID-2', aid: 'AID-2', name: 'SANTOS, ANA', branch: BRANCH_A },
      { cid: 'CID-3', aid: 'AID-3', name: 'REYES, MARK', branch: BRANCH_B },
      { cid: 'CID-4', applicant: 'Co-Maker', name: 'CO, MAKER', branch: BRANCH_A }
    ]
  }, extra || {})));
  const id = app.run('beginUnitRelease').transactionId;
  const payload = {
    TransactionID: id, MCID: 'MC-1', CID: 'CID-1', Scope: BRANCH_A, SaleDate: '2026-10-02',
    AccountNo: 'ACC-1', ATRNo: 'ATR-1', SINo: 'SI-1', RCINo: '', CreatedBy: 'clerk@sbc.test'
  };
  return { app, id, payload, with: over => Object.assign({}, payload, over) };
}

test('beginUnitRelease issues a cached Transaction ID', () => {
  const { app, id } = setup();
  assert.match(id, /^uuid-\d+$/);
  assert.equal(app.cache.get('UR_TXN_' + id), '1');
});

test('a Brand-New release writes header, detail, movement, SALES and marks the unit Sold', () => {
  const { app, id, payload } = setup();
  const cirBefore = app.rows('main', 'CIR_Database');
  const masterRowsBefore = app.rows('mc', 'MC_MASTER').length;

  const res = app.run('createUnitRelease', payload);
  assert.deepEqual(res, { success: true, transactionId: id, transactionNo: 'SALE-SI-1' });

  assert.deepEqual(app.rows('mc', 'TRANSACTION_HEADER')[1],
    [id, 'SALE-SI-1', 'SALE', BRANCH_A, 'DELA CRUZ, JUAN', '10/02/2026', 'clerk@sbc.test', 'Completed', '', '']);
  assert.deepEqual(app.rows('mc', 'TRANSACTION_DETAILS')[1], [id, 'SALE-SI-1', 'MC-1', 'ENG1', 'CH-ENG1', 'XRM125', 'XRM-01']);
  const move = app.rows('mc', 'MC_MOVEMENTS')[1];
  assert.deepEqual([move[1], move[2], move[3], move[4], move[5]], ['MC-1', 'SALE-SI-1', 'SALE', BRANCH_A, 'CUSTOMER']);

  const master = app.rows('mc', 'MC_MASTER');
  assert.equal(master.length, masterRowsBefore, 'unit is not deleted');
  assert.deepEqual([master[1][0], master[1][6], master[1][7]], ['MC-1', BRANCH_A, 'Sold']);

  assert.deepEqual(app.rows('mc', 'SALES')[1],
    [id, 'ACC-1', 'CID-1', 'AID-1', 'DELA CRUZ, JUAN', '09170000001', 'NAGA CITY', 'Brand-New', 'ATR-1', 'SI-1', '']);
  assert.equal(app.cache.has('UR_TXN_' + id), false, 'Transaction ID is consumed');
  assert.deepEqual(app.rows('main', 'CIR_Database'), cirBefore, 'CIR_Database is never written');
  assert.equal(app.lock.waits, 1);
  assert.equal(app.lock.releases, 1);
});

test('a Repo release requires RCI No. and stores ATR No. blank', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', RCINo: '' })).message, 'RCI No. is required.');
  const ok = s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', RCINo: 'RCI-9', ATRNo: 'IGNORED' }));
  assert.equal(ok.success, true);
  const sale = s.app.rows('mc', 'SALES')[1];
  assert.deepEqual([sale[7], sale[8], sale[9], sale[10]], ['Repo', '', 'SI-1', 'RCI-9']);
});

test('a Brand-New release requires ATR No. and stores RCI No. blank', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ ATRNo: '  ' })).message, 'ATR No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ RCINo: 'IGNORED' })).success, true);
  assert.equal(s.app.rows('mc', 'SALES')[1][10], '');
});

test('required sale fields are enforced', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ SINo: '' })).message, 'SI No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ AccountNo: ' ' })).message, 'Account No. is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ SaleDate: '' })).message, 'Date of Sale is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ SaleDate: 'not-a-date' })).message, 'Date of Sale is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: '' })).message, 'Motorcycle is required.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: '' })).message, 'Customer is required.');
  assert.equal(s.app.rows('mc', 'TRANSACTION_HEADER').length, 1, 'nothing written');
});

test('an unissued or already-used Transaction ID is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ TransactionID: 'made-up' })).message, EXPIRED);
  assert.equal(s.app.run('createUnitRelease', s.with({ TransactionID: '' })).message, EXPIRED);
  s.app.book('mc').getSheetByName('TRANSACTION_HEADER').appendRow([s.id, 'X-1', 'RR', '', BRANCH_A, '', '', 'Completed', '', '']);
  assert.equal(s.app.run('createUnitRelease', s.payload).message, EXPIRED);
});

test('second submit with the same Transaction ID is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-2', CID: 'CID-2', RCINo: 'R', SINo: 'SI-2' })).message, EXPIRED);
  assert.equal(s.app.rows('mc', 'SALES').length, 2);
});

test('rejects arrays for MCID or CID', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: ['MC-1'] })).message, ONE_EACH);
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: ['MC-1', 'MC-2'] })).message, ONE_EACH);
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: ['CID-1'] })).message, ONE_EACH);
});

test('rejects a unit that is not Available, unknown, or of an unrecognized type', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-5' })).message, 'Unit ENG5 is no longer Available (status: Sold).');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-404' })).message, 'Unit MC-404 was not found in MC_MASTER.');
  assert.equal(s.app.run('createUnitRelease', s.with({ MCID: 'MC-4' })).message,
    'Unit ENG4 has an unrecognized Unit Type "Demo". Set it to Brand-New or Repo in MC_MASTER.');
});

test('rejects a unit with no Current Branch', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({ MCID: 'MC-6', Scope: 'ALL' }));
  assert.equal(res.message, 'Unit ENG6 has no Current Branch in MC_MASTER.');
});

test('branch scope: restricted users only release their own units; ALL may release any', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: BRANCH_B })).message, 'This unit does not belong to your branch.');
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: '' })).message, 'Your account has no branch scope. Please sign in again.');
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: BRANCH_A.toLowerCase() })).success, true);

  const t = setup();
  assert.equal(t.app.run('createUnitRelease', t.with({ Scope: 'ALL' })).success, true);
});

test('customer must be an approved Maker at the unit branch', () => {
  const s = setup();
  // ALL user: Branch A unit + Branch B customer is not allowed.
  assert.equal(s.app.run('createUnitRelease', s.with({ Scope: 'ALL', CID: 'CID-3' })).message,
    'Customer CID-3 is not an approved Maker at ' + BRANCH_A + '.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: 'CID-4' })).message,
    'Customer CID-4 is not an approved Maker at ' + BRANCH_A + '.');
  assert.equal(s.app.run('createUnitRelease', s.with({ CID: 'CID-404' })).message,
    'Customer CID-404 is not an approved Maker at ' + BRANCH_A + '.');
});

test('a customer who already has a unit is rejected (CID is the duplicate key)', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const id2 = s.app.run('beginUnitRelease').transactionId;
  const res = s.app.run('createUnitRelease', s.with({ TransactionID: id2, MCID: 'MC-2', RCINo: 'R', SINo: 'SI-2', CID: 'cid-1' }));
  assert.equal(res.message, 'Customer CID-1 already has a Unit Release (SALE-SI-1).');
});

test('a duplicate SI number is rejected', () => {
  const s = setup();
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const id2 = s.app.run('beginUnitRelease').transactionId;
  const res = s.app.run('createUnitRelease', s.with({ TransactionID: id2, MCID: 'MC-2', CID: 'CID-2', RCINo: 'R', SINo: 'si-1' }));
  assert.equal(res.message, 'SI No. si-1 is already used by SALE-si-1.');
});

test('trims and case-folds MCID and CID from the browser', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({ MCID: ' MC-1 ', CID: ' cid-1 ' }));
  assert.equal(res.success, true);
  assert.equal(s.app.rows('mc', 'SALES')[1][2], 'CID-1');
});

test('browser-supplied branch, customer and unit details are ignored', () => {
  const s = setup();
  const res = s.app.run('createUnitRelease', s.with({
    Branch: BRANCH_B, Source: BRANCH_B, CustomerName: 'HACKER', ContactNo: '000', EngineNo: 'FAKE', UnitType: 'Repo'
  }));
  assert.equal(res.success, true);
  const header = s.app.rows('mc', 'TRANSACTION_HEADER')[1];
  assert.deepEqual([header[3], header[4]], [BRANCH_A, 'DELA CRUZ, JUAN']);
  const sale = s.app.rows('mc', 'SALES')[1];
  assert.deepEqual([sale[5], sale[7]], ['09170000001', 'Brand-New']);
});

test('CreatedBy falls back to System when blank', () => {
  const s = setup();
  s.app.run('createUnitRelease', s.with({ CreatedBy: '' }));
  assert.equal(s.app.rows('mc', 'TRANSACTION_HEADER')[1][6], 'System');
});

test('the first release creates the SALES sheet when SALES sheet is missing', () => {
  const s = setup({ withSalesSheet: false });
  assert.equal(s.app.run('createUnitRelease', s.payload).success, true);
  const sales = s.app.rows('mc', 'SALES');
  assert.deepEqual(sales[0], SALES_HEADERS);
  assert.equal(sales[1][0], s.id);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: every test in `unit-release.test.js` FAILS (`beginUnitRelease is not defined`); earlier suites PASS.

- [ ] **Step 3: Add `_transactionIdExists`**

In `MCDatabase.js`, directly after `_transactionNoExists`, add:

```js
// True if a TransactionID already exists in TRANSACTION_HEADER.
function _transactionIdExists(ss, transactionId) {
  const sheet = ss.getSheetByName('TRANSACTION_HEADER');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const col = _headerMap(sheet)['TransactionID'];
  if (col === undefined) return false;
  const target = (transactionId || '').toString().trim();
  return sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues()
    .some(r => (r[0] || '').toString().trim() === target);
}
```

- [ ] **Step 4: Add the Unit Release server functions**

Append to the end of `MCSales.js`:

```js

// ── Unit Release: create ────────────────────────────────────────────────────
// Business rule: 1 Sale = 1 Customer = 1 Motorcycle Unit.

const UNIT_RELEASE_TTL_SECONDS = 21600;   // 6 h — CacheService maximum
const UNIT_RELEASE_EXPIRED_MSG = 'This release form has expired. Please start a new Unit Release.';
const UNIT_RELEASE_ONE_EACH_MSG = 'A Unit Release must contain exactly one motorcycle and one customer.';
const SALE_DISABLED_MSG = 'Create Sale is no longer supported. Use Unit Release.';

function _unitReleaseCacheKey(transactionId) { return 'UR_TXN_' + transactionId; }

// Issues the Transaction ID shown on the release form. createUnitRelease()
// only accepts IDs issued here and not yet used.
function beginUnitRelease() {
  const transactionId = _uuid();
  CacheService.getScriptCache().put(_unitReleaseCacheKey(transactionId), '1', UNIT_RELEASE_TTL_SECONDS);
  return { transactionId: transactionId };
}

/**
 * createUnitRelease(payload) — validates and records one Unit Release.
 * payload: { TransactionID, MCID, CID, Scope, SaleDate, AccountNo, ATRNo, SINo, RCINo, CreatedBy }
 * Branch, customer and unit details are read on the server; anything else in
 * the payload is ignored. All checks run before the first write, and the whole
 * operation holds one script lock.
 * Returns { success, transactionId, transactionNo } or { success:false, message }.
 */
function createUnitRelease(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = _mcSS();
    const checked = _validateUnitRelease(ss, payload || {});
    if (!checked.success) return checked;
    const r = checked.release;

    _ensureSheetWithHeaders(ss, sheetNameSales, MC_SCHEMA.SALES);
    const res = _writeTransaction(ss, {
      TransactionID: r.transactionId,
      TransactionNo: r.transactionNo,
      TransactionType: 'SALE',
      Source: r.branch,
      Destination: r.customer.name || 'CUSTOMER',
      TransactionDate: r.saleDate,
      CreatedBy: r.createdBy,
      Status: 'Completed',
      Details: [{
        MCID: r.unit.mcid, EngineNo: r.unit.engineNo, ChassisNo: r.unit.chassisNo,
        Model: r.unit.model, ModelCode: r.unit.modelCode, Color: r.unit.color
      }]
    });
    if (!res.success) return res;

    _appendRow(ss, sheetNameSales, [
      r.transactionId, r.accountNo, r.customer.cid, r.customer.aid, r.customer.name,
      r.customer.contact, r.customer.address, r.unitType, r.atrNo, r.siNo, r.rciNo
    ]);
    CacheService.getScriptCache().remove(_unitReleaseCacheKey(r.transactionId));
    return { success: true, transactionId: r.transactionId, transactionNo: r.transactionNo };
  } catch (error) {
    console.error('createUnitRelease error:', error.toString());
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Every Unit Release check. Returns { success:false, message } on the first
// failure, or { success:true, release } with the server-side values to write.
function _validateUnitRelease(ss, p) {
  const fail = message => ({ success: false, message: message });
  const text = v => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : '';

  if (Array.isArray(p.MCID) || Array.isArray(p.CID)) return fail(UNIT_RELEASE_ONE_EACH_MSG);

  const transactionId = text(p.TransactionID);
  if (!transactionId ||
      CacheService.getScriptCache().get(_unitReleaseCacheKey(transactionId)) === null ||
      _transactionIdExists(ss, transactionId)) {
    return fail(UNIT_RELEASE_EXPIRED_MSG);
  }

  const mcid = text(p.MCID);
  const cid = text(p.CID);
  if (!mcid) return fail('Motorcycle is required.');
  if (!cid) return fail('Customer is required.');

  // Unit — authoritative values come from MC_MASTER.
  const unit = _readMCMaster('ALL').find(u => u.mcid === mcid);
  if (!unit) return fail('Unit ' + mcid + ' was not found in MC_MASTER.');
  if (_normalizeToken(unit.currentStatus) !== 'available') {
    return fail('Unit ' + unit.engineNo + ' is no longer Available (status: ' + unit.currentStatus + ').');
  }
  if (unit.unitType === 'Invalid') {
    return fail('Unit ' + unit.engineNo + ' has an unrecognized Unit Type "' + unit.unitTypeRaw +
      '". Set it to Brand-New or Repo in MC_MASTER.');
  }
  const branch = (unit.currentBranch || '').toString().trim();
  if (!branch) return fail('Unit ' + unit.engineNo + ' has no Current Branch in MC_MASTER.');

  // Scope — restricted users may only release units at their own branch.
  const scope = text(p.Scope);
  if (!scope) return fail('Your account has no branch scope. Please sign in again.');
  if (scope.toUpperCase() !== 'ALL' && !_matchesBranch(branch, scope)) {
    return fail('This unit does not belong to your branch.');
  }

  // Customer — must follow the unit's branch; CID is the duplicate-sale key.
  const customer = _readCIRCustomers().find(c => c.cid.toLowerCase() === cid.toLowerCase());
  if (!customer || !_isEligibleCustomer(customer, branch)) {
    return fail('Customer ' + cid + ' is not an approved Maker at ' + branch + '.');
  }
  const prior = _soldCIDSet()[customer.cid.toLowerCase()];
  if (prior) {
    return fail('Customer ' + customer.cid + ' already has a Unit Release (' + _saleTransactionNo(prior.SINo) + ').');
  }

  // User-entered fields.
  const saleDate = _normalizeDate(text(p.SaleDate));
  if (!saleDate) return fail('Date of Sale is required.');
  const accountNo = text(p.AccountNo);
  if (!accountNo) return fail('Account No. is required.');

  const docs = { ATRNo: text(p.ATRNo), SINo: text(p.SINo), RCINo: text(p.RCINo) };
  const labels = { ATRNo: 'ATR No.', SINo: 'SI No.', RCINo: 'RCI No.' };
  const required = _requiredSaleDocs(unit.unitType);
  for (let i = 0; i < required.length; i++) {
    if (!docs[required[i]]) return fail(labels[required[i]] + ' is required.');
  }
  Object.keys(docs).forEach(f => { if (required.indexOf(f) === -1) docs[f] = ''; });

  const transactionNo = _saleTransactionNo(docs.SINo);
  if (_transactionNoExists(ss, transactionNo)) {
    return fail('SI No. ' + docs.SINo + ' is already used by ' + transactionNo + '.');
  }

  return {
    success: true,
    release: {
      transactionId: transactionId,
      transactionNo: transactionNo,
      branch: branch,
      unit: unit,
      unitType: unit.unitType,
      customer: customer,
      saleDate: saleDate,
      accountNo: accountNo,
      atrNo: docs.ATRNo,
      siNo: docs.SINo,
      rciNo: docs.RCINo,
      createdBy: text(p.CreatedBy) || Session.getActiveUser().getEmail() || 'System'
    }
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add MCDatabase.js MCSales.js tests/unit-release.test.js
git commit -m @'
Add server-issued Unit Release with full server-side validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Sales list data and closing the legacy sale paths

**Files:**
- Modify: `MCSales.js` (`getSales` lines 6-21, `createSale` lines 23-40)
- Modify: `MCTransactions.js` (`createTransaction`)
- Modify: `MCDiagnostics.js` (`testPhase2Write` steps 4–5 and its final log line)
- Test: `tests/sales-list.test.js`

**Interfaces:**
- Consumes: `SALE_DISABLED_MSG` (Task 6), `sheetNameSales`, `_readObjects`, `_matchesBranch`, `_cmpDateDesc`.
- Produces: `getSales(branch) → [{ transactionNo, transactionId, date, customer, accountNo, siNo, engineNo, unitType, branch, status }]` newest first. `createSale(payload)` and `createTransaction({ TransactionType:'SALE', ... })` return `{ success:false, message: SALE_DISABLED_MSG }` and write nothing.

- [ ] **Step 1: Write the failing tests**

Create `tests/sales-list.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A, BRANCH_B } = require('./fixtures');

const DISABLED = 'Create Sale is no longer supported. Use Unit Release.';

function withOneRelease() {
  const app = loadApp(makeData({
    units: [{ mcid: 'MC-1', engineNo: 'ENG1', branch: BRANCH_A }],
    customers: [{ cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', branch: BRANCH_A }],
    headers: [['uuid-old', 'LEGACY-1', 'SALE', BRANCH_A, 'OLD BUYER', '09/15/2026', 'x', 'Completed', '', '']],
    details: [['uuid-old', 'LEGACY-1', 'MC-9', 'ENG9', 'CH9', 'M', 'MC']]
  }));
  const id = app.run('beginUnitRelease').transactionId;
  const res = app.run('createUnitRelease', {
    TransactionID: id, MCID: 'MC-1', CID: 'CID-1', Scope: BRANCH_A, SaleDate: '2026-10-02',
    AccountNo: 'ACC-1', ATRNo: 'ATR-1', SINo: 'SI-1', CreatedBy: 'clerk'
  });
  assert.equal(res.success, true);
  return { app, id };
}

test('getSales joins SALES and the single detail row, newest first', () => {
  const { app, id } = withOneRelease();
  assert.deepEqual(app.run('getSales', BRANCH_A), [
    { transactionNo: 'SALE-SI-1', transactionId: id, date: '10/02/2026', customer: 'DELA CRUZ, JUAN',
      accountNo: 'ACC-1', siNo: 'SI-1', engineNo: 'ENG1', unitType: 'Brand-New', branch: BRANCH_A, status: 'Completed' },
    { transactionNo: 'LEGACY-1', transactionId: 'uuid-old', date: '09/15/2026', customer: 'OLD BUYER',
      accountNo: '', siNo: '', engineNo: 'ENG9', unitType: '', branch: BRANCH_A, status: 'Completed' }
  ]);
});

test('getSales is branch-scoped', () => {
  const { app } = withOneRelease();
  assert.deepEqual(app.run('getSales', BRANCH_B), []);
  assert.equal(app.run('getSales', 'ALL').length, 2);
});

test('legacy createSale is disabled and writes nothing', () => {
  const app = loadApp(makeData({ units: [{ mcid: 'MC-1', engineNo: 'ENG1' }] }));
  const res = app.run('createSale', { TransactionNo: 'S-1', Source: BRANCH_A, Units: [{ MCID: 'MC-1' }] });
  assert.deepEqual(res, { success: false, message: DISABLED });
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER')[1][7], 'Available');
});

test('createTransaction refuses SALE but still accepts RR', () => {
  const app = loadApp(makeData({ units: [{ mcid: 'MC-1', engineNo: 'ENG1' }] }));
  const sale = app.run('createTransaction', { TransactionNo: 'S-2', TransactionType: ' sale ', Source: BRANCH_A, Details: [{ MCID: 'MC-1' }] });
  assert.deepEqual(sale, { success: false, message: DISABLED });
  assert.equal(app.rows('mc', 'MC_MASTER')[1][7], 'Available');
  assert.equal(app.run('createTransaction', { TransactionNo: 'RR-2', TransactionType: 'RR', Destination: BRANCH_A, Details: [{ MCID: 'MC-2' }] }).success, true);
});

test('testPhase2Write: legacy sale is rejected and the unit ends Available at branch B', () => {
  const app = loadApp(makeData());
  const out = app.run('testPhase2Write');
  assert.match(out, /Confirm IB-IN: \{"success":true/);
  assert.match(out, /Legacy SALE \(expect success:false\): \{"success":false/);
  const unit = app.run('getUnitProfile', 'TEST-MC-0001').unit;
  assert.deepEqual([unit.currentStatus, unit.currentBranch], ['Available', 'ZZ-TEST-B']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: FAIL — `getSales` returns the old shape (`units`, no `accountNo`); `createSale` succeeds; `createTransaction` accepts SALE; `testPhase2Write` shows `Confirm IB-IN: {"success":false` (its IB-IN number does not match the IB-OUT).

- [ ] **Step 3: Rewrite `getSales` and disable `createSale`**

In `MCSales.js`, replace everything from `function getSales(branch) {` through the end of `function createSale(payload) { ... }` (original lines 6–40) with:

```js
// One row per SALE (1 sale = 1 unit), joined with its SALES row and single
// TRANSACTION_DETAILS row. Sales made before Unit Release have no SALES row,
// so their Account No. / SI No. / Unit Type are blank.
function getSales(branch) {
  const salesById = {};
  _readObjects(sheetNameSales).forEach(s => { if (s.TransactionID) salesById[s.TransactionID] = s; });
  const detailById = {};
  _readObjects('TRANSACTION_DETAILS').forEach(d => { if (!detailById[d.TransactionID]) detailById[d.TransactionID] = d; });
  return _readObjects('TRANSACTION_HEADER')
    .filter(h => h.TransactionType === 'SALE' && _matchesBranch(h.SourceLocation, branch))
    .map(h => {
      const s = salesById[h.TransactionID] || {};
      const d = detailById[h.TransactionID] || {};
      return {
        transactionNo: h.TransactionNo, transactionId: h.TransactionID, date: h.TransactionDate,
        customer: h.DestinationLocation, accountNo: s.AccountNo || '', siNo: s.SINo || '',
        engineNo: d.EngineNo || '', unitType: s.UnitType || '', branch: h.SourceLocation, status: h.Status
      };
    })
    .sort((a, b) => _cmpDateDesc(a.date, b.date));
}

// Retired: sales go through createUnitRelease() so its checks cannot be bypassed.
function createSale(payload) {
  return { success: false, message: SALE_DISABLED_MSG };
}
```

- [ ] **Step 4: Refuse SALE in the public `createTransaction`**

In `MCTransactions.js`, replace:

```js
function createTransaction(tx) {
  const lock = LockService.getScriptLock();
```

with:

```js
function createTransaction(tx) {
  // SALE is written only by createUnitRelease() (through _writeTransaction) so
  // the Unit Release checks cannot be bypassed from the browser.
  if (tx && (tx.TransactionType || '').toString().trim().toUpperCase() === 'SALE') {
    return { success: false, message: SALE_DISABLED_MSG };
  }
  const lock = LockService.getScriptLock();
```

- [ ] **Step 5: Update `testPhase2Write`**

In `MCDiagnostics.js`:

Replace the step-4 line

```js
  r = confirmIBIn({ IBOutNo: 'TEST-IB-OUT-001', IBInNo: 'TEST-IB-IN-001', CreatedBy: 'tester' });
```

with

```js
  // The IB-IN number must match the IB-OUT number (invoice-style).
  r = confirmIBIn({ IBOutNo: 'TEST-IB-OUT-001', IBInNo: 'TEST-IB-OUT-001', CreatedBy: 'tester' });
```

Replace the step-5 block

```js
  // 5) SALE at B → unit Sold
  r = createSale({ TransactionNo: 'TEST-SALE-001', CustomerName: 'Test Customer', Source: _TEST_BR_B, CreatedBy: 'tester', Units: [{ MCID: _TEST_MCID }] });
  log.push('SALE: ' + JSON.stringify(r));
```

with

```js
  // 5) Legacy createSale is retired — must be REJECTED (Unit Release replaces it)
  r = createSale({ TransactionNo: 'TEST-SALE-001', CustomerName: 'Test Customer', Source: _TEST_BR_B, CreatedBy: 'tester', Units: [{ MCID: _TEST_MCID }] });
  log.push('Legacy SALE (expect success:false): ' + JSON.stringify(r));
```

Replace

```js
    '\n\nExpected: unit ends Sold at ' + _TEST_BR_B + ', 4 moves (RR→IB-OUT→IB-IN→SALE), duplicate rejected.' +
```

with

```js
    '\n\nExpected: unit ends Available at ' + _TEST_BR_B + ', 3 moves (RR→IB-OUT→IB-IN), duplicate and legacy sale rejected.' +
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add MCSales.js MCTransactions.js MCDiagnostics.js tests/sales-list.test.js
git commit -m @'
Single-unit sales list; retire createSale and SALE via createTransaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: Browser stub and the Sales list screen

**Files:**
- Create: `tests/ui/mock-gas.js`, `tests/ui/build-preview.js`
- Modify: `.gitignore` (append `tests/ui/preview.html`)
- Modify: `Index.html` — `<!-- SALES — LIST -->` block (`<div id="salesPage" …>` … its closing `</div>`, ~lines 2543-2588) and, in the `PHASE 4 — SALES (UNIT RELEASES)` script, `loadSales`'s `mcSkelRows` call, `applySalesSearch`, and `drawSalesPage`.

**Interfaces:**
- Consumes: `getSales(branch)` row shape from Task 7.
- Produces: `tests/ui/preview.html` (generated, gitignored); `window.__gasCalls` (array of `{ name, args }`), `window.__mockUser` (login result user), `window.__nextRelease` (one-shot override result for `createUnitRelease`) — used by Tasks 9–10.

- [ ] **Step 1: Create the browser stub**

Create `tests/ui/mock-gas.js`:

```js
// tests/ui/mock-gas.js - Browser stub of google.script.run so Index.html can be
// exercised outside Apps Script. UI verification only; never deployed.
(function () {
  const A = 'CTS-NAG - Naga';
  const B = 'CTS-CAT - Cataingan';
  const unit = (mcid, engineNo, branch, unitType, unitTypeRaw) => ({
    mcid: mcid, engineNo: engineNo, chassisNo: 'CH-' + engineNo, model: 'XRM125', modelCode: 'XRM-01',
    color: 'RED', currentBranch: branch, currentStatus: 'Available', unitType: unitType, unitTypeRaw: unitTypeRaw
  });
  const units = [
    unit('MC-1', 'ENG1001', A, 'Brand-New', ''),
    unit('MC-2', 'ENG1002', A, 'Repo', 'Repo'),
    unit('MC-3', 'ENG2001', B, 'Brand-New', 'Brand-New'),
    unit('MC-4', 'ENG1004', A, 'Invalid', 'Demo')
  ];
  const customers = {};
  customers[A] = [
    { cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', contact: '09170000001', address: 'NAGA CITY' },
    { cid: 'CID-2', aid: 'AID-2', name: 'SANTOS, ANA', contact: '09170000002', address: 'PILI' }
  ];
  customers[B] = [
    { cid: 'CID-3', aid: 'AID-3', name: 'REYES, MARK', contact: '09170000003', address: 'CATAINGAN' }
  ];
  const sales = [];
  let seq = 0;

  window.__gasCalls = [];
  window.__mockUser = {
    id: 1, name: 'Test Clerk', fullName: 'Test Clerk', email: 'clerk@sbc.test',
    role: 'Branch Manager', branch: A, branchScope: A, restricted: true
  };
  window.__nextRelease = null;   // e.g. { success:false, message:'...' } to simulate a rejection

  const handlers = {
    validateLogin: () => ({ success: true, user: window.__mockUser }),
    beginUnitRelease: () => ({ transactionId: 'mock-uuid-' + (++seq) }),
    getAvailableUnits: b => units.filter(u => u.currentStatus === 'Available' && (b === 'ALL' || u.currentBranch === b)),
    getSaleCustomers: b => (customers[b] || []).filter(c => !sales.some(s => s.cid === c.cid)),
    createUnitRelease: p => {
      if (window.__nextRelease) { const r = window.__nextRelease; window.__nextRelease = null; return r; }
      const u = units.find(x => x.mcid === p.MCID);
      const c = Object.keys(customers).map(k => customers[k]).reduce((a, b) => a.concat(b), []).find(x => x.cid === p.CID);
      u.currentStatus = 'Sold';
      sales.unshift({
        transactionNo: 'SALE-' + p.SINo, transactionId: p.TransactionID, date: p.SaleDate, customer: c.name,
        accountNo: p.AccountNo, siNo: p.SINo, engineNo: u.engineNo, unitType: u.unitType,
        branch: u.currentBranch, status: 'Completed', cid: c.cid
      });
      return { success: true, transactionId: p.TransactionID, transactionNo: 'SALE-' + p.SINo };
    },
    getSales: () => sales.map(s => Object.assign({}, s))
  };

  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return fn => runner(fn, onFailure);
        if (name === 'withFailureHandler') return fn => runner(onSuccess, fn);
        if (name === 'withUserObject') return () => runner(onSuccess, onFailure);
        return function () {
          const args = Array.prototype.slice.call(arguments);
          window.__gasCalls.push({ name: name, args: JSON.parse(JSON.stringify(args)) });
          setTimeout(function () {
            const h = handlers[name];
            let res = null;
            if (h) {
              try { res = JSON.parse(JSON.stringify(h.apply(null, args))); }
              catch (e) { if (onFailure) onFailure(e); return; }
            }
            try { if (onSuccess) onSuccess(res); } catch (e) { /* unrelated dashboard handlers */ }
          }, 120);
        };
      }
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };
})();
```

- [ ] **Step 2: Create the preview builder and ignore its output**

Create `tests/ui/build-preview.js`:

```js
// tests/ui/build-preview.js - Writes tests/ui/preview.html (Index.html with the
// google.script.run stub loaded first) for browser checks. Output is gitignored.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const out = html.replace(/<head([^>]*)>/i, m => m + '\n<script src="mock-gas.js"></script>');
if (out === html) throw new Error('No <head> tag found in Index.html');
const target = path.join(__dirname, 'preview.html');
fs.writeFileSync(target, out);
console.log('Wrote ' + target);
```

Append to `.gitignore`:

```

# Generated UI preview (tests/ui/build-preview.js)
tests/ui/preview.html
```

- [ ] **Step 3: Replace the Sales list markup**

In `Index.html`, replace the whole `<!-- SALES — LIST -->` block (from `<!-- SALES — LIST -->` through the `</div>` that closes `<div id="salesPage" …>`, just before `<!-- CREATE SALE -->`) with:

```html
    <!-- SALES — LIST (Unit Releases: 1 sale = 1 customer = 1 motorcycle) -->
    <div id="salesPage" class="hidden overflow-y-auto w-full flex-1">
      <main class="mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div class="mb-6 flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-slate-800">Unit Releases (Sales)</h1>
            <p class="text-sm text-slate-500">Motorcycles released to customers</p>
          </div>
          <button onclick="openCreateSale()" class="inline-flex items-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition">
            <i data-lucide="plus" class="w-4 h-4"></i> New Unit Release
          </button>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm mb-4">
          <div class="relative max-w-md">
            <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input id="salesSearch" type="text" placeholder="Search sale no, SI, customer, account or engine…" class="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm" oninput="applySalesSearch()" />
          </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200">
              <thead class="bg-slate-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Sale No.</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Date</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Customer</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Account No.</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Engine No.</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Unit Type</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Branch</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody id="salesBody" class="bg-white divide-y divide-slate-100"></tbody>
            </table>
          </div>
          <div id="salesStatus" class="text-sm text-slate-500 px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center">
            <i data-lucide="loader" class="w-4 h-4 mr-2 animate-spin"></i> Loading sales…
          </div>
          <div id="salePaginationBar" class="pagination-bar hidden">
            <div id="salePaginationInfo" class="pagination-info"></div>
            <div id="salePaginationControls" class="pagination-controls"></div>
          </div>
        </div>
      </main>
    </div>
```

- [ ] **Step 4: Update the list script**

In the `<!-- ==================== PHASE 4 — SALES (UNIT RELEASES) ==================== -->` script:

In `window.loadSales`, change `window.mcSkelRows('salesBody', 6);` to `window.mcSkelRows('salesBody', 8);`.

Replace `window.applySalesSearch = function () { ... };` with:

```js
    window.applySalesSearch = function () {
      const q = (document.getElementById('salesSearch').value || '').trim().toLowerCase();
      const fields = ['transactionNo', 'siNo', 'customer', 'accountNo', 'engineNo'];
      renderSales(!q ? salesData : salesData.filter(s =>
        fields.some(f => (s[f] || '').toString().toLowerCase().includes(q))));
    };
```

Replace `function drawSalesPage() { ... }` with:

```js
    function drawSalesPage() {
      const body = document.getElementById('salesBody');
      const status = document.getElementById('salesStatus');
      const total = saleState.filteredRows.length;
      const rows = window.paginateRows(saleState.filteredRows, saleState.currentPage);
      if (!total) {
        body.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-slate-400">No unit releases yet.</td></tr>';
      } else {
        body.innerHTML = rows.map(s => `
          <tr class="hover:bg-slate-50">
            <td class="px-6 py-4 font-mono font-semibold text-slate-800">${window.mcEscape(s.transactionNo)}</td>
            <td class="px-6 py-4 text-slate-600">${window.mcEscape(s.date)}</td>
            <td class="px-6 py-4 text-slate-700">${window.mcEscape(s.customer)}</td>
            <td class="px-6 py-4 font-mono text-slate-700">${window.mcEscape(s.accountNo) || '-'}</td>
            <td class="px-6 py-4 font-mono text-slate-700">${window.mcEscape(s.engineNo) || '-'}</td>
            <td class="px-6 py-4 text-slate-700">${window.mcEscape(s.unitType) || '-'}</td>
            <td class="px-6 py-4 text-slate-700">${window.mcEscape(s.branch)}</td>
            <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs rounded-full bg-orange-50 text-orange-700">${window.mcEscape(s.status) || 'Completed'}</span></td>
          </tr>`).join('');
      }
      if (status) status.innerHTML = '<i data-lucide="list" class="w-4 h-4 mr-2"></i> Showing <strong class="mx-1">' + total + '</strong> release' + (total === 1 ? '' : 's');
      window.renderPagination(saleState, 'salePaginationControls', 'salePaginationInfo', 'salePaginationBar', drawSalesPage);
      if (window.lucide) lucide.createIcons();
    }
```

- [ ] **Step 5: Verify the list in a browser**

Run: `node tests/ui/build-preview.js`
Expected: `Wrote …\tests\ui\preview.html`.

With the Playwright browser tools: navigate to `file:///C:/Users/PC/Desktop/HTML%20PROJECT/AppScript%20Project/BAF-Dashboard/tests/ui/preview.html`; evaluate `localStorage.clear()` and reload so the login form shows; log in through the form (any email, password ≥ 4 chars); then evaluate:

```js
showPage('salesPage', null); loadSales();
```

Expected: the table header shows exactly `SALE NO. | DATE | CUSTOMER | ACCOUNT NO. | ENGINE NO. | UNIT TYPE | BRANCH | STATUS` and the body shows "No unit releases yet." with status "Showing 0 releases". (Rows and search are checked in Task 10 after a release exists.) Take a screenshot for the task notes.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore tests/ui/mock-gas.js tests/ui/build-preview.js Index.html
git commit -m @'
Unit Release sales list columns and search; browser stub for UI checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 9: Two-step Create Unit Release screen

**Files:**
- Modify: `Index.html`
  - `<!-- CREATE SALE -->` block (`<div id="createSalePage" …>` through its closing `</div>`, ~lines 2590-2674)
  - `<div id="saleConfirmModal" …>` block (~lines 2411-2449)
  - In the `PHASE 4 — SALES (UNIT RELEASES)` script: everything from the line `    // ── Create Sale ──` through the end of `window.confirmSaleFinal = function () { … };` (the `};` right after `.createSale(p.payload);`).

**Interfaces:**
- Consumes (server): `beginUnitRelease()`, `getAvailableUnits(scope)` (records with `mcid, engineNo, chassisNo, model, modelCode, color, currentBranch, currentStatus, unitType, unitTypeRaw`), `getSaleCustomers(branch)` (`{ cid, aid, name, contact, address }`), `createUnitRelease(payload)`.
- Consumes (page): `showPage`, `loadSales`, `window._userBranch`, `window._userEmail`, `window.mcEscape`, `window.mcAlert`, `window.mcToast`, `window.mcInventoryLoaded`, `window.invDashLoaded`.
- Produces (globals called from markup): `openCreateSale`, `renderUrUnits`, `selectUrUnit(mcid)`, `urContinue`, `urBackToStep1`, `urCustomerTyped`, `renderUrCustomers`, `selectUrCustomer(cid)`, `submitSale`, `closeSaleReview`, `confirmSaleFinal`.

- [ ] **Step 1: Replace the create page markup**

Replace the whole `<!-- CREATE SALE -->` block with:

```html
    <!-- CREATE UNIT RELEASE — step 1: select motorcycle, step 2: release form -->
    <div id="createSalePage" class="hidden overflow-y-auto w-full flex-1">
      <main class="mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <button onclick="showPage('salesPage', null)" class="mb-4 text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1.5">
          <i data-lucide="arrow-left" class="w-4 h-4"></i> Back to Sales
        </button>
        <div class="mb-6">
          <h1 class="text-2xl font-bold text-slate-800">New Unit Release</h1>
          <p id="urStepLabel" class="text-sm text-slate-500">Step 1 of 2 — Select an available motorcycle</p>
        </div>

        <!-- STEP 1 — SELECT MOTORCYCLE -->
        <div id="urStep1">
          <div class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <h4 class="text-sm font-bold text-slate-900">Available Motorcycles</h4>
              <div class="relative w-full sm:w-72">
                <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input id="urEngineSearch" type="text" placeholder="Search engine number…" class="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm" oninput="renderUrUnits()" />
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-200">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-4 py-3 w-10"></th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Engine No</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Chassis No</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Model</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Color</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Unit Type</th>
                    <th id="urBranchHead" class="hidden px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Branch</th>
                  </tr>
                </thead>
                <tbody id="urUnitsBody" class="bg-white divide-y divide-slate-100"></tbody>
              </table>
            </div>
            <div id="urUnitsStatus" class="text-sm text-slate-500 px-5 py-3 bg-slate-50 border-t border-slate-100">Loading available units…</div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button onclick="showPage('salesPage', null)" class="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
            <button id="urContinueBtn" onclick="urContinue()" disabled class="px-5 py-2 text-sm rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 opacity-60 cursor-not-allowed">Continue</button>
          </div>
        </div>

        <!-- STEP 2 — UNIT RELEASE FORM -->
        <div id="urStep2" class="hidden space-y-4">
          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-4">Sale Info</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Transaction ID</label>
                <input id="urTxnId" type="text" readonly data-no-uppercase class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono bg-slate-50 text-slate-600" />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Date of Sale <span class="text-red-500">*</span></label>
                <input id="urDate" type="date" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Branch</label>
                <input id="urBranch" type="text" readonly class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" />
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-4">Customer</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Account No. <span class="text-red-500">*</span></label>
                <input id="urAccountNo" type="text" placeholder="Customer account number" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div class="md:col-span-2 relative">
                <label class="block text-xs font-medium text-slate-500 mb-1">Customer / Account Name <span class="text-red-500">*</span></label>
                <input id="urCustomerSearch" type="text" autocomplete="off" placeholder="Search approved Maker by name or CID…" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  oninput="urCustomerTyped()" onfocus="renderUrCustomers()" onblur="document.getElementById('urCustomerList').classList.add('hidden')" />
                <div id="urCustomerList" class="hidden absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg"></div>
                <p id="urCustomerStatus" class="mt-1 text-xs text-slate-400"></p>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Contact Number</label>
                <input id="urContact" type="text" readonly class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" />
              </div>
              <div class="md:col-span-2">
                <label class="block text-xs font-medium text-slate-500 mb-1">Address</label>
                <input id="urAddress" type="text" readonly class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" />
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex items-center justify-between mb-4">
              <div class="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Documents</div>
              <div id="urTypeBadge"></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div id="urAtrWrap">
                <label class="block text-xs font-medium text-slate-500 mb-1">ATR No. <span class="text-red-500">*</span></label>
                <input id="urAtrNo" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div id="urRciWrap" class="hidden">
                <label class="block text-xs font-medium text-slate-500 mb-1">RCI No. <span class="text-red-500">*</span></label>
                <input id="urRciNo" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">SI No. <span class="text-red-500">*</span></label>
                <input id="urSiNo" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex items-center justify-between mb-4">
              <div class="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Motorcycle Details</div>
              <button type="button" onclick="urBackToStep1()" class="text-xs font-semibold text-orange-600 hover:text-orange-700">Change unit</button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div class="text-slate-400 text-xs">MCID</div><div id="urMcid" class="font-mono text-xs text-slate-800 break-all">-</div></div>
              <div><div class="text-slate-400 text-xs">Engine No</div><div id="urEngine" class="font-mono text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Chassis No</div><div id="urChassis" class="font-mono text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Model</div><div id="urModel" class="text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Model Code</div><div id="urModelCode" class="text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Color</div><div id="urColor" class="text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Current Branch</div><div id="urCurBranch" class="text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Current Status</div><div id="urCurStatus" class="text-slate-800">-</div></div>
            </div>
          </div>

          <div id="urError" class="hidden text-sm text-red-600"></div>
          <div class="flex justify-end gap-2">
            <button onclick="showPage('salesPage', null)" class="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
            <button id="urSubmitBtn" onclick="submitSale()" class="px-5 py-2 text-sm rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700">Review &amp; Release</button>
          </div>
        </div>
      </main>
    </div>
```

- [ ] **Step 2: Replace the review modal markup**

Replace the whole `<div id="saleConfirmModal" class="fixed inset-0 z-50 hidden">` … its closing `</div>` (just before `<!-- CANCEL PENDING TRANSFER MODAL (with countdown) -->`) with:

```html
    <div id="saleConfirmModal" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onclick="closeSaleReview()"></div>
      <div class="relative flex min-h-screen items-center justify-center p-4">
        <div class="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div class="px-6 py-5 border-b border-slate-200">
            <h3 class="text-lg font-bold text-slate-900">Review Unit Release</h3>
            <p class="text-xs text-slate-500">Verify the customer, documents and motorcycle before confirming — this marks the unit Sold.</p>
          </div>
          <div class="p-6">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm mb-4">
              <div><div class="text-slate-400 text-xs">Sale No.</div><div id="scNo" class="font-mono font-semibold text-slate-800">-</div></div>
              <div class="sm:col-span-2"><div class="text-slate-400 text-xs">Transaction ID</div><div id="scTxnId" class="font-mono text-xs text-slate-600 break-all">-</div></div>
              <div class="sm:col-span-2"><div class="text-slate-400 text-xs">Customer</div><div id="scCustomer" class="text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Account No.</div><div id="scAccount" class="font-mono text-slate-800">-</div></div>
              <div><div class="text-slate-400 text-xs">Branch</div><div id="scBranch" class="text-slate-800">-</div></div>
              <div class="sm:col-span-2"><div class="text-slate-400 text-xs">Documents</div><div id="scDocs" class="font-mono text-slate-800">-</div></div>
            </div>
            <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 mb-4 flex items-center gap-2">
              <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0"></i>
              Confirm the engine number below. Once released, this unit is marked Sold.
            </div>
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
              <table class="min-w-full text-sm">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Engine No</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Chassis No</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Model</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Unit Type</th>
                  </tr>
                </thead>
                <tbody id="scUnitsBody"></tbody>
              </table>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
            <button onclick="closeSaleReview()" class="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
            <button id="scConfirmBtn" onclick="confirmSaleFinal()" disabled class="px-5 py-2 text-sm rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 opacity-60 cursor-not-allowed">Please review… (5)</button>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Replace the create/review script**

In the `PHASE 4 — SALES (UNIT RELEASES)` script, replace everything from the line `    // ── Create Sale ──` through the `};` that closes `window.confirmSaleFinal` (the IIFE's closing `  })();` stays) with:

```js
    // ── Create Unit Release (1 sale = 1 customer = 1 motorcycle) ──
    // Step 1 picks one Available unit; step 2 fills the release form. The
    // Transaction ID is issued by the server once per form and kept through
    // "Change unit". Branch always follows the selected unit's CurrentBranch.
    const ur = { transactionId: '', units: [], selectedMcid: '', unit: null, branch: '', customers: [], customer: null };
    function urEl(id) { return document.getElementById(id); }
    function urScopeAll() { return (window._userBranch || 'ALL') === 'ALL'; }
    function urToday() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    window.openCreateSale = function () {
      Object.assign(ur, { transactionId: '', units: [], selectedMcid: '', unit: null, branch: '', customers: [], customer: null });
      ['urEngineSearch', 'urAccountNo', 'urCustomerSearch', 'urContact', 'urAddress', 'urAtrNo', 'urRciNo', 'urSiNo', 'urBranch']
        .forEach(id => { urEl(id).value = ''; });
      urEl('urDate').value = urToday();
      urEl('urTxnId').value = 'Generating…';
      urEl('urCustomerStatus').textContent = '';
      urEl('urError').classList.add('hidden');
      urEl('urBranchHead').classList.toggle('hidden', !urScopeAll());
      urShowStep(1);
      showPage('createSalePage', null);

      google.script.run
        .withSuccessHandler(function (res) {
          ur.transactionId = (res && res.transactionId) || '';
          urEl('urTxnId').value = ur.transactionId || '—';
        })
        .withFailureHandler(function (e) {
          urEl('urTxnId').value = '—';
          window.mcAlert('' + e, { title: 'Could not start Unit Release' });
        })
        .beginUnitRelease();

      urEl('urUnitsStatus').textContent = 'Loading available units…';
      urEl('urUnitsBody').innerHTML = '';
      urUpdateContinue();
      google.script.run
        .withSuccessHandler(function (units) { ur.units = units || []; renderUrUnits(); })
        .withFailureHandler(function (e) { urEl('urUnitsStatus').textContent = 'Failed: ' + e; })
        .getAvailableUnits(window._userBranch || 'ALL');
    };

    function urShowStep(n) {
      urEl('urStep1').classList.toggle('hidden', n !== 1);
      urEl('urStep2').classList.toggle('hidden', n !== 2);
      urEl('urStepLabel').textContent = n === 1
        ? 'Step 1 of 2 — Select an available motorcycle'
        : 'Step 2 of 2 — Complete the Unit Release form';
      if (window.lucide) lucide.createIcons();
    }

    function urTypeBadge(u) {
      if (u.unitType === 'Repo') return '<span class="px-2 py-0.5 text-xs rounded-full bg-orange-50 text-orange-700">Repo</span>';
      if (u.unitType === 'Brand-New') return '<span class="px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700">Brand-New</span>';
      return '<span class="px-2 py-0.5 text-xs rounded-full bg-red-50 text-red-700">Invalid type: ' + window.mcEscape(u.unitTypeRaw) + '</span>';
    }

    window.renderUrUnits = function () {
      const q = (urEl('urEngineSearch').value || '').trim().toLowerCase();
      const all = urScopeAll();
      const rows = ur.units.filter(u => !q || (u.engineNo || '').toLowerCase().includes(q));
      const body = urEl('urUnitsBody');
      if (!rows.length) {
        const msg = ur.units.length ? 'No unit matches that engine number.' : 'No available units.';
        body.innerHTML = '<tr><td colspan="' + (all ? 7 : 6) + '" class="text-center py-8 text-slate-400">' + msg + '</td></tr>';
      } else {
        body.innerHTML = rows.map(u => {
          const invalid = u.unitType === 'Invalid';
          const sel = u.mcid === ur.selectedMcid;
          return `<tr data-mcid="${window.mcEscape(u.mcid)}" class="${invalid ? 'opacity-60' : 'hover:bg-slate-50 cursor-pointer'} ${sel ? 'bg-orange-50' : ''}" ${invalid ? '' : 'onclick="selectUrUnit(this.dataset.mcid)"'}>
            <td class="px-4 py-3"><input type="radio" name="urUnit" ${sel ? 'checked' : ''} ${invalid ? 'disabled' : ''} data-no-uppercase /></td>
            <td class="px-4 py-3 font-mono text-slate-800">${window.mcEscape(u.engineNo)}</td>
            <td class="px-4 py-3 font-mono text-slate-600">${window.mcEscape(u.chassisNo)}</td>
            <td class="px-4 py-3 text-slate-700">${window.mcEscape(u.model)}</td>
            <td class="px-4 py-3 text-slate-700">${window.mcEscape(u.color)}</td>
            <td class="px-4 py-3">${urTypeBadge(u)}</td>
            ${all ? `<td class="px-4 py-3 text-slate-700">${window.mcEscape(u.currentBranch)}</td>` : ''}
          </tr>`;
        }).join('');
      }
      urEl('urUnitsStatus').textContent = ur.units.length + ' available unit(s)';
      urUpdateContinue();
    };

    window.selectUrUnit = function (mcid) { ur.selectedMcid = mcid; renderUrUnits(); };

    function urUpdateContinue() {
      const u = ur.units.find(x => x.mcid === ur.selectedMcid);
      const ok = !!u && u.unitType !== 'Invalid';
      const btn = urEl('urContinueBtn');
      btn.disabled = !ok;
      btn.classList.toggle('opacity-60', !ok);
      btn.classList.toggle('cursor-not-allowed', !ok);
    }

    window.urContinue = function () {
      const unit = ur.units.find(u => u.mcid === ur.selectedMcid);
      if (!unit || unit.unitType === 'Invalid') return;
      const branchChanged = unit.currentBranch !== ur.branch;
      ur.unit = unit;
      ur.branch = unit.currentBranch;
      [['urMcid', unit.mcid], ['urEngine', unit.engineNo], ['urChassis', unit.chassisNo], ['urModel', unit.model],
       ['urModelCode', unit.modelCode], ['urColor', unit.color], ['urCurBranch', unit.currentBranch], ['urCurStatus', unit.currentStatus]]
        .forEach(([id, v]) => { urEl(id).textContent = v || '-'; });
      urEl('urBranch').value = ur.branch;
      urEl('urTypeBadge').innerHTML = urTypeBadge(unit);
      urEl('urAtrWrap').classList.toggle('hidden', unit.unitType !== 'Brand-New');
      urEl('urRciWrap').classList.toggle('hidden', unit.unitType !== 'Repo');
      urEl('urError').classList.add('hidden');
      urShowStep(2);
      if (branchChanged) urLoadCustomers();
    };

    window.urBackToStep1 = function () { urShowStep(1); renderUrUnits(); };

    // Customers always follow the selected unit's branch.
    function urLoadCustomers() {
      ur.customers = [];
      ur.customer = null;
      urEl('urCustomerSearch').value = '';
      urEl('urContact').value = '';
      urEl('urAddress').value = '';
      urEl('urCustomerList').classList.add('hidden');
      const branch = ur.branch;
      const st = urEl('urCustomerStatus');
      st.textContent = 'Loading customers for ' + branch + '…';
      google.script.run
        .withSuccessHandler(function (rows) {
          if (branch !== ur.branch) return;   // a unit from another branch was chosen meanwhile
          ur.customers = rows || [];
          st.textContent = ur.customers.length + ' eligible customer(s) at ' + branch + ' (approved Maker, no unit yet)';
        })
        .withFailureHandler(function (e) { st.textContent = 'Failed to load customers: ' + e; })
        .getSaleCustomers(branch);
    }

    window.urCustomerTyped = function () {
      if (ur.customer) { ur.customer = null; urEl('urContact').value = ''; urEl('urAddress').value = ''; }
      renderUrCustomers();
    };

    window.renderUrCustomers = function () {
      const q = (urEl('urCustomerSearch').value || '').trim().toLowerCase();
      const list = urEl('urCustomerList');
      const rows = ur.customers.filter(c => !q ||
        (c.name || '').toLowerCase().includes(q) || (c.cid || '').toLowerCase().includes(q)).slice(0, 50);
      list.innerHTML = rows.length
        ? rows.map(c => `<button type="button" data-cid="${window.mcEscape(c.cid)}" onmousedown="event.preventDefault(); selectUrCustomer(this.dataset.cid)" class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between gap-3">
            <span class="text-slate-800">${window.mcEscape(c.name)}</span><span class="font-mono text-xs text-slate-400">${window.mcEscape(c.cid)}</span>
          </button>`).join('')
        : '<div class="px-3 py-2 text-sm text-slate-400">No matching customer.</div>';
      list.classList.remove('hidden');
    };

    window.selectUrCustomer = function (cid) {
      const c = ur.customers.find(x => x.cid === cid);
      if (!c) return;
      ur.customer = c;   // CID / AID stay in form state only
      urEl('urCustomerSearch').value = c.name + '  (' + c.cid + ')';
      urEl('urContact').value = c.contact || '';
      urEl('urAddress').value = c.address || '';
      urEl('urCustomerList').classList.add('hidden');
    };

    // Validate, then open the review-and-confirm modal (does NOT submit yet).
    let pendingSale = null;
    let scTimer = null;
    const SALE_REVIEW_SECONDS = 5;

    window.submitSale = function () {
      const err = urEl('urError');
      err.classList.add('hidden');
      const show = m => { err.textContent = m; err.classList.remove('hidden'); return false; };
      const u = ur.unit;
      if (!ur.transactionId) return show('Transaction ID is not ready yet. Wait a moment, or start a new Unit Release.');
      if (!u) return show('Select a motorcycle first.');
      if (!urEl('urDate').value) return show('Date of Sale is required.');
      const accountNo = urEl('urAccountNo').value.trim();
      if (!accountNo) return show('Account No. is required.');
      if (!ur.customer) return show('Select a customer from the list.');
      const docs = { ATRNo: urEl('urAtrNo').value.trim(), SINo: urEl('urSiNo').value.trim(), RCINo: urEl('urRciNo').value.trim() };
      if (u.unitType === 'Brand-New' && !docs.ATRNo) return show('ATR No. is required.');
      if (u.unitType === 'Repo' && !docs.RCINo) return show('RCI No. is required.');
      if (!docs.SINo) return show('SI No. is required.');
      if (u.unitType === 'Brand-New') docs.RCINo = ''; else docs.ATRNo = '';

      pendingSale = {
        saleNo: 'SALE-' + docs.SINo, unit: u, customer: ur.customer, accountNo: accountNo, docs: docs,
        payload: {
          TransactionID: ur.transactionId, MCID: u.mcid, CID: ur.customer.cid, Scope: window._userBranch || 'ALL',
          SaleDate: urEl('urDate').value, AccountNo: accountNo,
          ATRNo: docs.ATRNo, SINo: docs.SINo, RCINo: docs.RCINo, CreatedBy: (window._userEmail || '')
        }
      };
      openSaleReview();
    };

    function openSaleReview() {
      const p = pendingSale; if (!p) return;
      urEl('scNo').textContent = p.saleNo;
      urEl('scTxnId').textContent = p.payload.TransactionID;
      urEl('scCustomer').textContent = p.customer.name + ' (' + p.customer.cid + ')';
      urEl('scAccount').textContent = p.accountNo;
      urEl('scBranch').textContent = ur.branch;
      urEl('scDocs').textContent = (p.unit.unitType === 'Repo' ? 'RCI ' + p.docs.RCINo : 'ATR ' + p.docs.ATRNo) + ' · SI ' + p.docs.SINo;
      urEl('scUnitsBody').innerHTML = `
        <tr class="border-t border-slate-100">
          <td class="px-4 py-2 font-mono text-slate-800">${window.mcEscape(p.unit.engineNo) || '-'}</td>
          <td class="px-4 py-2 font-mono text-slate-600">${window.mcEscape(p.unit.chassisNo) || '-'}</td>
          <td class="px-4 py-2 text-slate-700">${window.mcEscape(p.unit.model) || '-'}</td>
          <td class="px-4 py-2 text-slate-700">${window.mcEscape(p.unit.unitType)}</td>
        </tr>`;
      urEl('saleConfirmModal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons();
      startSaleCountdown(SALE_REVIEW_SECONDS);
    }

    function startSaleCountdown(sec) {
      const btn = urEl('scConfirmBtn');
      if (scTimer) { clearInterval(scTimer); scTimer = null; }
      let remaining = sec;
      btn.disabled = true;
      btn.classList.add('opacity-60', 'cursor-not-allowed');
      btn.textContent = 'Please review… (' + remaining + ')';
      scTimer = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(scTimer); scTimer = null;
          btn.disabled = false;
          btn.classList.remove('opacity-60', 'cursor-not-allowed');
          btn.textContent = 'Confirm & Release';
        } else {
          btn.textContent = 'Please review… (' + remaining + ')';
        }
      }, 1000);
    }

    window.closeSaleReview = function () {
      if (scTimer) { clearInterval(scTimer); scTimer = null; }
      urEl('saleConfirmModal').classList.add('hidden');
      document.body.style.overflow = '';
    };

    // Create the Unit Release; server errors stay in the existing alert component.
    window.confirmSaleFinal = function () {
      const p = pendingSale; if (!p) return;
      const btn = urEl('scConfirmBtn');
      if (btn.disabled) return; // guard: countdown not finished / already saving
      btn.disabled = true; btn.textContent = 'Saving…';
      google.script.run
        .withSuccessHandler(function (res) {
          if (!res || !res.success) {
            btn.disabled = false; btn.textContent = 'Confirm & Release';
            window.mcAlert((res && res.message) || 'Failed to create Unit Release.', { title: 'Could not release unit' });
            return;
          }
          closeSaleReview();
          pendingSale = null;
          window.mcToast('Unit Release ' + res.transactionNo + ' recorded — ' + (p.unit.engineNo || '') + ' sold', 'success');
          window.mcInventoryLoaded = false; window.invDashLoaded = false;
          showPage('salesPage', null); loadSales();
        })
        .withFailureHandler(function (e) {
          btn.disabled = false; btn.textContent = 'Confirm & Release';
          window.mcAlert('' + e, { title: 'Could not release unit' });
        })
        .createUnitRelease(p.payload);
    };
```

- [ ] **Step 4: Check that no stale references remain**

Run (Grep tool or `rg`): search `Index.html` for `csNo|csLast|csUnitsBody|csSelectAll|toggleAllSaleUnits|updateSaleSelCount|scCount|\.createSale\(`.
Expected: no matches.

- [ ] **Step 5: Smoke-check the flow in a browser**

Run: `node tests/ui/build-preview.js`, open `tests/ui/preview.html`, evaluate `localStorage.clear()` and reload, log in, evaluate `openCreateSale()`.
Expected: Step 1 lists ENG1001 (Brand-New), ENG1002 (Repo), ENG1004 with a red "Invalid type: Demo" badge and a disabled radio; no Branch column; Continue disabled. Click ENG1001 → Continue enables → Continue shows Step 2 with Transaction ID `mock-uuid-1`, Branch `CTS-NAG - Naga`, ATR No. and SI No. visible, RCI No. hidden, and "2 eligible customer(s) at CTS-NAG - Naga". Browser console has no errors from this page's code. (The full checklist is Task 10.)

- [ ] **Step 6: Commit**

```powershell
git add Index.html
git commit -m @'
Two-step Create Unit Release screen and review modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 10: Browser verification checklist

**Files:**
- No source changes expected. If a check fails, fix `Index.html` in this task and re-run the full checklist.

**Interfaces:**
- Consumes: `tests/ui/preview.html` (Task 8 builder), `window.__gasCalls`, `window.__mockUser`, `window.__nextRelease`.

Run `node tests/ui/build-preview.js` first. Steps 1–10 run in one session in order (state carries over: the release made in Step 8 is used by Steps 9–10). Start by opening `preview.html`, evaluating `localStorage.clear()`, reloading, and logging in via the form (the login is saved in localStorage, so clearing it is what brings the form back). Act through the Playwright browser tools (clicks/typing, or `browser_evaluate` where noted). Record PASS/FAIL per check in the task notes; take a screenshot for checks 3, 5 and 9.

- [ ] **Step 1: Restricted user — units and branch**

Evaluate `openCreateSale()`. Expected: only Branch A units (ENG1001, ENG1002, ENG1004); no Branch column; `__gasCalls` contains `getAvailableUnits` with args `['CTS-NAG - Naga']`.

- [ ] **Step 2: Engine search**

Type `1002` in "Search engine number…". Expected: only ENG1002 shown. Clear the box: all three return.

- [ ] **Step 3: Brand-New form**

Select ENG1001 → Continue. Expected: Transaction ID `mock-uuid-1` read-only; Branch read-only `CTS-NAG - Naga`; badge Brand-New; ATR No. + SI No. visible; RCI No. hidden; Motorcycle Details show MC-1 / ENG1001 / CH-ENG1001 / XRM125 / XRM-01 / RED / CTS-NAG - Naga / Available.

- [ ] **Step 4: Customer picker**

Focus the customer box → list shows DELA CRUZ, JUAN (CID-1) and SANTOS, ANA (CID-2). Type `ana` → only SANTOS, ANA. Click it. Expected: box shows `SANTOS, ANA  (CID-2)`, Contact `09170000002`, Address `PILI`, both read-only. Type one more character → Contact and Address clear.

- [ ] **Step 5: Change unit keeps Transaction ID, selection and customer**

Re-pick SANTOS, ANA. Click "Change unit". Expected: Step 1 with ENG1001 still selected. Select ENG1002 (Repo) → Continue. Expected: same Transaction ID `mock-uuid-1` (`__gasCalls` has exactly one `beginUnitRelease`); badge Repo; RCI No. + SI No. visible, ATR No. hidden; customer SANTOS, ANA still selected (same branch).

- [ ] **Step 6: Client-side required fields**

With Account No. empty click "Review & Release" → red text "Account No. is required.". Fill Account No. `ACC-9`; leave RCI empty → "RCI No. is required."; fill RCI `RCI-9`, leave SI empty → "SI No. is required.".

- [ ] **Step 7: Review modal and server rejection in mcAlert**

Fill SI `SI-9`. Click "Review & Release". Expected modal: Sale No. `SALE-SI-9`, Transaction ID `mock-uuid-1`, Customer `SANTOS, ANA (CID-2)`, Account No. `ACC-9`, Branch, Documents `RCI RCI-9 · SI SI-9`, one unit row ENG1002 / Repo; confirm button counts down 5→0 then reads "Confirm & Release". Evaluate `window.__nextRelease = { success: false, message: 'SI No. SI-9 is already used by SALE-SI-9.' }`, click Confirm. Expected: the mcAlert dialog titled "Could not release unit" with that message; the modal stays open and the button reads "Confirm & Release".

- [ ] **Step 8: Successful release → Sales list**

Click Confirm again. Expected: toast "Unit Release SALE-SI-9 recorded — ENG1002 sold"; Sales list shows one row `SALE-SI-9 | <date> | SANTOS, ANA | ACC-9 | ENG1002 | Repo | CTS-NAG - Naga | Completed`; the last `createUnitRelease` call's args contain exactly the keys `TransactionID, MCID, CID, Scope, SaleDate, AccountNo, ATRNo, SINo, RCINo, CreatedBy` with `ATRNo: ''`.

- [ ] **Step 9: Sales list search**

Type each of `SI-9`, `SALE-SI`, `santos`, `ACC-9`, `ENG1002` in the list search → row stays. Type `zzz` → "No unit releases yet." and "Showing 0 releases".

- [ ] **Step 10: Sold unit and customer drop out**

Click "New Unit Release". Expected: ENG1002 no longer listed; a new Transaction ID `mock-uuid-2`. Pick ENG1001 → Continue → customer list shows only DELA CRUZ, JUAN.

- [ ] **Step 11: ALL-branch user**

Evaluate `localStorage.clear()` and reload (fresh mock data). Before logging in, evaluate `window.__mockUser = Object.assign({}, window.__mockUser, { role: 'Admin', branch: 'ALL', branchScope: 'ALL', restricted: false })`; log in; evaluate `openCreateSale()`. Expected: Branch column visible; units from both branches (ENG1001, ENG1002, ENG2001, ENG1004); `getAvailableUnits` called with `'ALL'`. Pick ENG2001 → Continue: Branch `CTS-CAT - Cataingan`; customers only REYES, MARK. Pick REYES, MARK, then Change unit → ENG1001 → Continue: Branch `CTS-NAG - Naga`, customer selection cleared, list now DELA CRUZ, JUAN and SANTOS, ANA. There is no branch selector anywhere on the page.

- [ ] **Step 12: Commit any fixes**

If fixes were needed:

```powershell
git add Index.html
git commit -m @'
Fix Unit Release UI issues found in browser verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

Otherwise record "all checks PASS" and move on.

---

### Task 11: Editor-run end-to-end test, docs, and deploy notes

**Files:**
- Modify: `MCDiagnostics.js` (append; refactor `cleanupPhase2Test` to use `_purgeTestRows`)
- Modify: `BACKEND_GUIDE.md`, `README.md`
- Test: `tests/diagnostics.test.js`

**Interfaces:**
- Consumes: `beginUnitRelease`, `createUnitRelease`, `createSale`, `_readCIRCustomers`, `_readMCMaster`, `_readObjects`, `_upsertMCMaster`, `_findMasterRowIndex`, `_headerMap`, `_saleTransactionNo`, `_mcToday`, `_mcSS`, `sheetNameSales`, `sheetNameCIR`.
- Produces: `_purgeTestRows(ss, sheetName, header, values) → number removed`, `_setMasterCellForTest(ss, mcid, header, value)`, `testUnitReleaseFlow(cid?) → log string`, `cleanupUnitReleaseTest() → report string`; `cleanupPhase2Test()` unchanged behavior.

- [ ] **Step 1: Write the failing tests**

Create `tests/diagnostics.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeData, BRANCH_A } = require('./fixtures');

test('testUnitReleaseFlow passes on fake sheets and cleanup removes its rows', () => {
  const app = loadApp(makeData({ customers: [{ cid: 'CID-1', aid: 'AID-1', branch: BRANCH_A }] }));
  const cirBefore = app.rows('main', 'CIR_Database');

  const out = app.run('testUnitReleaseFlow', 'CID-1');
  assert.doesNotMatch(out, /FAIL/);
  assert.equal((out.match(/^PASS /gm) || []).length, 11);

  const report = app.run('cleanupUnitReleaseTest');
  assert.match(report, /removed rows/);
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'TRANSACTION_DETAILS').length, 1);
  assert.equal(app.rows('mc', 'MC_MOVEMENTS').length, 1);
  assert.equal(app.rows('mc', 'SALES').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER').length, 1);
  assert.deepEqual(app.rows('main', 'CIR_Database'), cirBefore);
});

test('testUnitReleaseFlow explains a missing CID', () => {
  const app = loadApp(makeData());
  assert.throws(() => app.fn('testUnitReleaseFlow')(''), /Set _UR_TEST_CID/);
  assert.throws(() => app.fn('testUnitReleaseFlow')('CID-404'), /not found/);
});

test('cleanupPhase2Test still removes the Phase 2 test rows', () => {
  const app = loadApp(makeData());
  app.run('testPhase2Write');
  app.run('cleanupPhase2Test');
  assert.equal(app.rows('mc', 'TRANSACTION_HEADER').length, 1);
  assert.equal(app.rows('mc', 'MC_MASTER').length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: the first two tests FAIL (`testUnitReleaseFlow is not defined`); the cleanupPhase2Test test PASSES (characterizes current behavior before the refactor).

- [ ] **Step 3: Extract `_purgeTestRows` and refactor `cleanupPhase2Test`**

In `MCDiagnostics.js`, replace the whole `function cleanupPhase2Test() { ... }` with:

```js
// Deletes every row created by testPhase2Write() from all 4 data sheets.
function cleanupPhase2Test() {
  const ss = _mcSS();
  const testNos = ['TEST-RR-001', 'TEST-IB-OUT-001', 'TEST-IB-IN-001', 'TEST-SALE-001'];
  const removed = {
    TRANSACTION_HEADER:  _purgeTestRows(ss, 'TRANSACTION_HEADER',  'TransactionNo', testNos),
    TRANSACTION_DETAILS: _purgeTestRows(ss, 'TRANSACTION_DETAILS', 'TransactionNo', testNos),
    MC_MOVEMENTS:        _purgeTestRows(ss, 'MC_MOVEMENTS',        'TransactionNo', testNos),
    MC_MASTER:           _purgeTestRows(ss, 'MC_MASTER',           'MCID', [_TEST_MCID])
  };
  const report = 'cleanupPhase2Test() removed rows: ' + JSON.stringify(removed);
  Logger.log(report);
  return report;
}

// Deletes rows whose `header` column equals one of `values` (bottom-up so row
// indices stay valid). Returns the number of rows removed. Test cleanup only.
function _purgeTestRows(ss, sheetName, header, values) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const col = _headerMap(sheet)[header];
  if (col === undefined) return 0;
  const cells = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
  let count = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (values.indexOf((cells[i][0] || '').toString().trim()) !== -1) {
      sheet.deleteRow(i + 2);
      count++;
    }
  }
  return count;
}
```

- [ ] **Step 4: Add the Unit Release editor test and cleanup**

Append to `MCDiagnostics.js`:

```js

// ── Unit Release end-to-end test (real sheets) ──────────────────────────────
// 1. Run setupSalesSchema() first.
// 2. Set _UR_TEST_CID to an Approved Maker CID that has no Unit Release yet.
// 3. Run ▸ testUnitReleaseFlow and read the Logs — every line should be PASS.
// 4. Run ▸ cleanupUnitReleaseTest to remove the test rows.
// The CIR row is only read, never written.
const _UR_TEST_CID = '';   // ← set before running from the editor
const _UR_TEST_MCIDS = ['TEST-MC-UR-0001', 'TEST-MC-UR-0002'];
const _UR_TEST_SI = 'TEST-UR-001';

function testUnitReleaseFlow(cid) {
  cid = (cid || _UR_TEST_CID || '').toString().trim();
  if (!cid) throw new Error('Set _UR_TEST_CID to an Approved Maker CID first.');
  const customer = _readCIRCustomers().find(c => c.cid === cid);
  if (!customer) throw new Error('CID ' + cid + ' not found in ' + sheetNameCIR + '.');

  const ss = _mcSS();
  _UR_TEST_MCIDS.forEach((mcid, i) => _upsertMCMaster(ss, {
    MCID: mcid, EngineNo: 'TESTURENG' + (i + 1), ChassisNo: 'TESTURCHS' + (i + 1), Model: 'TESTMODEL',
    ModelCode: 'TM-01', Color: 'RED', CurrentBranch: customer.branch, CurrentStatus: 'Available', OriginalRR: 'TEST-UR-RR'
  }));

  const log = [];
  const expect = (label, res, wantSuccess) =>
    log.push((!!(res && res.success) === wantSuccess ? 'PASS ' : 'FAIL ') + label + ': ' + JSON.stringify(res));
  const base = {
    MCID: _UR_TEST_MCIDS[0], CID: cid, Scope: 'ALL', SaleDate: _mcToday(), AccountNo: 'TEST-ACCT-1',
    ATRNo: 'TEST-ATR-1', SINo: _UR_TEST_SI, RCINo: '', CreatedBy: 'tester'
  };
  const id = beginUnitRelease().transactionId;
  const withId = extra => Object.assign({}, base, { TransactionID: id }, extra || {});

  expect('Unissued Transaction ID rejected', createUnitRelease(Object.assign({}, base, { TransactionID: 'not-issued' })), false);
  expect('Missing ATR No. rejected', createUnitRelease(withId({ ATRNo: '' })), false);
  expect('MCID array rejected', createUnitRelease(withId({ MCID: [_UR_TEST_MCIDS[0]] })), false);
  expect('CID array rejected', createUnitRelease(withId({ CID: [cid] })), false);
  expect('Legacy createSale rejected', createSale({ TransactionNo: 'TEST-UR-LEGACY', Source: customer.branch, Units: [{ MCID: _UR_TEST_MCIDS[0] }] }), false);

  _setMasterCellForTest(ss, _UR_TEST_MCIDS[0], 'UnitType', 'Demo');
  expect('Unknown UnitType rejected', createUnitRelease(withId()), false);
  _setMasterCellForTest(ss, _UR_TEST_MCIDS[0], 'UnitType', 'Brand-New');

  const cirBefore = JSON.stringify(customer);
  expect('Release succeeds', createUnitRelease(withId()), true);
  const unit = _readMCMaster('ALL').find(u => u.mcid === _UR_TEST_MCIDS[0]);
  expect('Unit is Sold and kept in MC_MASTER', { success: !!unit && unit.currentStatus === 'Sold', unit: unit }, true);
  const sale = _readObjects(sheetNameSales).find(s => s.TransactionID === id);
  expect('SALES row stores CID + AID', { success: !!sale && sale.CID === cid && sale.AID === customer.aid, sale: sale }, true);

  const id2 = beginUnitRelease().transactionId;
  expect('Second release for the same CID rejected', createUnitRelease(Object.assign({}, base, {
    TransactionID: id2, MCID: _UR_TEST_MCIDS[1], SINo: _UR_TEST_SI + '-B'
  })), false);

  const cirAfter = JSON.stringify(_readCIRCustomers().find(c => c.cid === cid));
  expect('CIR row unchanged', { success: cirBefore === cirAfter }, true);

  const out = log.join('\n');
  Logger.log('testUnitReleaseFlow() results:\n' + out + '\n\nRun cleanupUnitReleaseTest() to remove the test rows.');
  return out;
}

// Removes every row created by testUnitReleaseFlow().
function cleanupUnitReleaseTest() {
  const ss = _mcSS();
  const sis = [_UR_TEST_SI, _UR_TEST_SI + '-B'];
  const txnNos = sis.map(_saleTransactionNo).concat(['TEST-UR-LEGACY']);
  const removed = {
    TRANSACTION_HEADER:  _purgeTestRows(ss, 'TRANSACTION_HEADER',  'TransactionNo', txnNos),
    TRANSACTION_DETAILS: _purgeTestRows(ss, 'TRANSACTION_DETAILS', 'TransactionNo', txnNos),
    MC_MOVEMENTS:        _purgeTestRows(ss, 'MC_MOVEMENTS',        'TransactionNo', txnNos),
    SALES:               _purgeTestRows(ss, sheetNameSales,        'SINo', sis),
    MC_MASTER:           _purgeTestRows(ss, 'MC_MASTER',           'MCID', _UR_TEST_MCIDS)
  };
  const report = 'cleanupUnitReleaseTest() removed rows: ' + JSON.stringify(removed);
  Logger.log(report);
  return report;
}

// Sets one MC_MASTER cell for a test unit. Throws if the unit or column is missing.
function _setMasterCellForTest(ss, mcid, header, value) {
  const sheet = ss.getSheetByName('MC_MASTER');
  const row = _findMasterRowIndex(ss, mcid);
  const col = _headerMap(sheet)[header];
  if (row === -1 || col === undefined) {
    throw new Error('Cannot set ' + header + ' for ' + mcid + ' — run setupSalesSchema() first.');
  }
  sheet.getRange(row, col + 1).setValue(value);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS.

- [ ] **Step 6: Update the docs**

In `BACKEND_GUIDE.md`, in the "Motorcycle operations" table, replace the `MCSales.js` row with:

```markdown
| [MCSales.js](MCSales.js) | Unit Release (1 sale = 1 customer = 1 motorcycle): `beginUnitRelease`, `getSaleCustomers`, `createUnitRelease`, the sales list, and the retired `createSale`. |
| [MCSalesRules.js](MCSalesRules.js) | Unit Release rules: UnitType / status / applicant normalization, required documents, `SALE-{SINo}` numbering. |
```

and replace the `MCSetup.js` row with:

```markdown
| [MCSetup.js](MCSetup.js) | Manual motorcycle database setup (`setupDatabase`), Unit Release setup (`setupSalesSchema`), and schema verification. |
```

Then append to `BACKEND_GUIDE.md`:

```markdown

## Unit Release (Sales)

A sale releases exactly one Available motorcycle to one approved Maker customer at the unit's branch. `createUnitRelease()` re-checks everything on the server under one script lock, then writes `TRANSACTION_HEADER`, `TRANSACTION_DETAILS`, `MC_MOVEMENTS`, the new `SALES` row, and sets `MC_MASTER.CurrentStatus` to `Sold`. The legacy `createSale()` and SALE via `createTransaction()` are disabled. Design: [docs/superpowers/specs/2026-10-02-unit-release-sales-design.md](docs/superpowers/specs/2026-10-02-unit-release-sales-design.md).

One-time setup after deploying:

1. Run `setupSalesSchema()` from the Apps Script editor and read the log.
2. In `MC_MASTER`, change repossessed units' `UnitType` to `Repo` (blank and `Brand-New` read as Brand-New; any other value blocks the sale).
3. In AppSheet, regenerate the `CIR_Database` table structure once (three new header-only columns).
4. Optional: set `_UR_TEST_CID` in `MCDiagnostics.js`, run `testUnitReleaseFlow`, check that every log line is PASS, then run `cleanupUnitReleaseTest`.

## Local tests

Server code is tested in Node with in-memory fakes of the Google services (`tests/harness.js`):

```powershell
node --test "tests/*.test.js"
```

`tests/` and `docs/` are excluded from `clasp push` by `.claspignore`. For UI checks, `node tests/ui/build-preview.js` writes `tests/ui/preview.html`, which runs `Index.html` against a stubbed `google.script.run`.
```

In `README.md`, under "## Update Google Apps Script", after the `clasp push` code block, add:

```markdown
Before pushing, run the local tests:

```powershell
node --test "tests/*.test.js"
```

`.claspignore` keeps `tests/` and `docs/` out of the Apps Script project. After the Unit Release change is deployed, follow the one-time setup in [BACKEND_GUIDE.md](BACKEND_GUIDE.md#unit-release-sales).
```

- [ ] **Step 7: Verify the clasp push list**

Run: `clasp show-file-status` (or `clasp status`)
Expected: the files to push include `MCSalesRules.js` and the other root `.js`/`.html` files plus `appsscript.json`, and nothing under `tests/` or `docs/`. If clasp is not logged in, tell the user this check needs `clasp login` and must pass before `clasp push`.

- [ ] **Step 8: Run the full test suite one last time**

Run: `node --test "tests/*.test.js"`
Expected: all tests PASS, 0 failures.

- [ ] **Step 9: Commit**

```powershell
git add MCDiagnostics.js BACKEND_GUIDE.md README.md tests/diagnostics.test.js
git commit -m @'
Add Unit Release editor test, cleanup, and setup docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

Do not run `clasp push` or `git push` — deployment and publishing are the user's call.
