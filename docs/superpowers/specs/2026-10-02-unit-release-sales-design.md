# Unit Release (Sales) — Design

Date: 2026-10-02
Status: Draft for review

## 1. Goal

Replace the current multi-unit "Create Sale" screen with a controlled **Unit Release** flow: one Available motorcycle is released to one approved customer, with the required sales documents for the unit's type, and the sale is traceable as **Customer → CIR → Sale → Sold unit**.

## 2. Scope

In scope:

- `MC_MASTER` — inventory source and the `Available → Sold` status change.
- New `SALES` sheet — sale-specific fields.
- `TRANSACTION_HEADER`, `TRANSACTION_DETAILS` — the SALE transaction.
- `MC_MOVEMENTS` — the SALE movement only.
- `CIR_Database` (and `Applicant_Database` as the AID reference) — customer lookup and identification.
- Sales list and Create Unit Release screens in `Index.html`.

Out of scope (unchanged in this phase):

- Receiving Report, Inter-Branch Transfer (IB-OUT / IB-IN / In-Transit), and cancellation workflows and their functions.
- Automatic `UnitType` assignment on receiving (revisit with the Receiving Report work).
- Writing sale values into `CIR_Database` (headers only; see §3.3).
- Image/file uploads for sales documents.
- Server-side session verification (existing known gap; see §9).

## 3. Data model

### 3.1 `MC_MASTER` — new `UnitType` column

- Appended as the last column: `UnitType`, values `Brand-New` or `Repo`.
- `setupSalesSchema()` adds the header if missing and fills only **blank** cells with `Brand-New`.
- Repossessed units are changed to `Repo` manually in the sheet.
- Reading rule (normalized, case-insensitive): `repo` or `repossessed` → `Repo`; anything else, including blank → `Brand-New`.
- Existing writers (`_upsertMCMaster`) are not changed; new rows they append leave `UnitType` blank, which reads as `Brand-New`.
- `MC_SCHEMA.MC_MASTER` gains `UnitType` at the end so `setupDatabase()` creates it for new installs.

### 3.2 New `SALES` sheet (MC inventory spreadsheet)

One row per Unit Release, keyed by `TransactionID`.

| Column | Source |
|---|---|
| `TransactionID` | Server-issued UUID (§4.2) |
| `AccountNo` | User input (required) |
| `CID` | CIR record (server) — primary customer link and duplicate-sale key |
| `AID` | CIR `ToWhom` raw value (server) — secondary reference to `Applicant_Database` |
| `CustomerName` | CIR `ApplicantName` (server) |
| `ContactNo` | CIR `ACellNo.` (server) |
| `Address` | CIR `Pres Address` (server) |
| `UnitType` | `MC_MASTER.UnitType`, normalized (server) |
| `ATRNo` | User input — Brand-New only, else blank |
| `SINo` | User input — always required |
| `RCINo` | User input — Repo only, else blank |

`MC_SCHEMA` gains a `SALES` entry with these headers.

### 3.3 `CIR_Database` — header-only link columns

- `setupSalesSchema()` appends the headers `SaleTransactionID`, `SaleSINo`, `SaleMCID` if missing. No values are written under them.
- `Config.js`: `const SALE_CIR_WRITEBACK = false;`. While false, `createUnitRelease()` never writes to `CIR_Database`. The write-back code path is not implemented in this phase.
- After the headers are added, AppSheet's table structure for `CIR_Database` must be regenerated once.

### 3.4 SALE transaction rows

| Sheet | Values |
|---|---|
| `TRANSACTION_HEADER` | `TransactionID` = server-issued UUID; `TransactionNo` = `SALE-{SINo}`; `TransactionType` = `SALE`; `SourceLocation` = unit's `CurrentBranch`; `DestinationLocation` = customer name; `TransactionDate` = Date of Sale; `CreatedBy`; `Status` = `Completed`; `Remarks` blank; `LinkedTransactionNo` blank |
| `TRANSACTION_DETAILS` | One row: the selected unit's MCID, EngineNo, ChassisNo, Model, ModelCode (from `MC_MASTER`) |
| `MC_MOVEMENTS` | One row: `SALE`, From = branch, To = `CUSTOMER` |
| `MC_MASTER` | `CurrentStatus` → `Sold` (and `LastUpdated`). The row is never deleted; `CurrentBranch` and identity fields keep their existing values. |

Traceability: `CID` → `SALES.TransactionID` → `TRANSACTION_DETAILS.MCID` → `MC_MASTER`.

## 4. Backend

### 4.1 One-time setup — `setupSalesSchema()` (MCSetup.js)

Run manually from the Apps Script editor. Idempotent and non-destructive:

1. Create `SALES` with headers if missing.
2. Append `UnitType` header to `MC_MASTER` if missing; fill blank `UnitType` cells with `Brand-New`.
3. Append `SaleTransactionID`, `SaleSINo`, `SaleMCID` headers to `CIR_Database` if missing (no values).
4. Return a log report like `setupDatabase()`.

### 4.2 Server-issued Transaction ID — `beginUnitRelease()`

- Generates a UUID, stores it in `CacheService.getScriptCache()` under `UR_TXN_<uuid>` with a 6-hour TTL, and returns `{ transactionId }`.
- `createUnitRelease()` accepts the ID only if the cache key exists **and** the ID is not already in `TRANSACTION_HEADER`; it removes the cache key after a successful write.
- A missing or expired key returns: "This release form has expired. Please start a new Unit Release."

### 4.3 `getSaleCustomers(branch)` (MCSales.js)

- `branch` must be a specific branch (not blank, not `ALL`); otherwise returns `[]`.
- Reads `CIR_Database` (main spreadsheet). A row is eligible when all hold:
  - `Store Branch:` matches `branch` (case-insensitive, via `_matchesBranch`).
  - `Status / Condition:` normalized equals `approved`.
  - `Type of Applicant:` normalized equals `maker` (excludes `co-maker`).
  - `CID` is non-blank and **not** present in `SALES.CID`.
- Normalization: trim, lowercase, collapse whitespace/`-`/`_` to a single space, so `Co-Maker`, `co maker`, `CO_MAKER` all read as `co maker`.
- Returns `[{ cid, aid, name, contact, address }]`, where `aid` is the **raw** `ToWhom` value (not the resolved maker name), sorted by name.

### 4.4 `getAvailableUnits(branch)` (unchanged signature)

- `_readMCMaster` adds `unitType` (normalized per §3.1) to each record. No other behavior changes.

### 4.5 `createUnitRelease(payload)` (MCSales.js)

Payload (only these fields are read):

```
{ TransactionID, MCID, CID, Scope, SaleDate, AccountNo, ATRNo, SINo, RCINo, CreatedBy }
```

`Scope` is the user's branch scope (`ALL` or a branch). The browser does **not** send Branch, customer details, or unit details; any extra fields are ignored.

Inside one `LockService` script lock, validate everything before the first write:

1. `TransactionID` valid per §4.2.
2. Exactly one `MCID`; the unit exists in `MC_MASTER` and `CurrentStatus` is `Available` (case-insensitive).
3. Branch = unit's `MC_MASTER.CurrentBranch` (re-derived on the server). If `Scope` is not `ALL`, it must match Branch.
4. Exactly one `CID`; the CIR row exists, its `Store Branch:` matches Branch, status is Approved, type is Maker (normalized), and `CID` is not in `SALES.CID`.
5. `SaleDate` present and parseable; `AccountNo` and `SINo` non-blank after trim.
6. Documents by `UnitType`: Brand-New requires `ATRNo` (RCINo stored blank); Repo requires `RCINo` (ATRNo stored blank).
7. `SALE-{SINo}` does not already exist in `TRANSACTION_HEADER` (case-insensitive).

Any failure returns `{ success: false, message }` with nothing written. On success, still inside the lock:

1. `_writeTransaction(ss, tx)` writes header, details, movement, and the `MC_MASTER` status change (§3.4).
2. Append the `SALES` row.
3. Remove the cache key.

Returns `{ success: true, transactionId, transactionNo }`.

No rollback: if a sheet write throws partway, rows already written remain and the error is returned. Pre-validation under one lock keeps this rare.

### 4.6 `_writeTransaction(ss, tx)` refactor (MCTransactions.js)

- Move the body of `createTransaction()` (sheet setup, validation, writes) into `_writeTransaction(ss, tx)`, which takes no lock.
- `_writeTransaction` uses `tx.TransactionID` when provided, otherwise generates a UUID (current behavior).
- `createTransaction(tx)` becomes: acquire lock → `_writeTransaction(_mcSS(), tx)` → release. Its API and results are unchanged for RR / IB-OUT / IB-IN / SALE callers.

### 4.7 `getSales(branch)` (MCSales.js)

Returns one row per SALE header in scope (`_matchesBranch(SourceLocation, branch)`), joined with `SALES` (by `TransactionID`) and `TRANSACTION_DETAILS` (engine number):

```
{ transactionNo, transactionId, date, customer, accountNo, siNo, engineNo, unitType, branch, status }
```

Sales created before this change (no `SALES` row) show blank Account No / SI No / Unit Type. Sorted newest first.

### 4.8 Existing `createSale()`

Left in place and unchanged (no longer called by the UI).

## 5. Screens (Index.html)

### 5.1 Sales list (`salesPage`)

- Title "Unit Releases (Sales)", button "New Unit Release".
- Columns: `Sale No. | Date | Customer | Account No. | Engine No. | Unit Type | Branch | Status`.
- Search (client-side, case-insensitive) over Sale No., SI No., Customer, Account No., Engine No.
- Existing pagination is kept.

### 5.2 Create Unit Release (`createSalePage`) — two steps on one page

Form state: `{ transactionId, units, selectedMcid, unit, branch, customers, customer }`.

On "New Unit Release":

- Call `beginUnitRelease()` once; the returned Transaction ID is kept for the life of this form (including "Change unit").
- Load units with `getAvailableUnits(scope)` (restricted users: their branch; `ALL` users: every branch).

**Step 1 — Select motorcycle**

- Search box filters by Engine No. as the user types.
- Table with a radio per row: Engine No., Chassis No., Model, Color, Unit Type (plus Branch column for `ALL` users).
- "Continue" is disabled until a unit is selected.

**Step 2 — Unit Release form**

| Section | Fields |
|---|---|
| Sale Info | Transaction ID (read-only), Date of Sale (required, default today), Branch (read-only = selected unit's `CurrentBranch`) |
| Customer | Account No. (required, typed). Customer / Account Name: searchable picker over `getSaleCustomers(branch)`, showing name and CID. Contact No. and Address fill automatically, read-only. CID/AID kept in form state only. |
| Documents | Badge with the unit type. Brand-New: ATR No., SI No. Repo: RCI No., SI No. Shown fields are required. |
| Motorcycle Details | Read-only: MCID, Engine No., Chassis No., Model, Model Code, Color, Current Branch, Current Status. "Change unit" link. |

- Customers load for the selected unit's branch after the unit is chosen. For `ALL` users the customer list always follows the selected unit's branch; there is no separate branch selector, and a customer from another branch cannot be chosen.
- "Change unit" returns to Step 1 with the current unit still selected and keeps the same Transaction ID. If a different unit is chosen whose branch differs, the customer list reloads and the selected customer is cleared; if the branch is the same, the customer stays selected.
- Client-side checks mirror §4.5 items 5–6 for fast feedback; the server remains authoritative.

**Review and Confirm**

- Reuses `saleConfirmModal` and its 5-second countdown. Shows Sale No. (`SALE-{SINo}`), Transaction ID, Customer, Account No., Branch, documents, and the single unit (Engine No., Chassis No., Model).
- Confirm calls `createUnitRelease()`.
- Success: toast → refresh Sales and Inventory data (`mcInventoryLoaded = false`, `invDashLoaded = false`, `loadSales()`) → return to the Sales list.
- Failure: message shown in the existing `mcAlert` component; the form stays open with its data.

## 6. Branch rules summary

| User | Units shown | Sale branch | Customers shown |
|---|---|---|---|
| Branch-restricted | Own branch, Available | Own branch (read-only) | Own branch |
| `branchScope = ALL` | All branches, Available | Selected unit's `CurrentBranch` | Selected unit's branch only |

The server always re-derives the branch from `MC_MASTER` and checks the CIR's branch against it.

## 7. Errors

| Condition | Message (server) |
|---|---|
| Expired/unknown Transaction ID | This release form has expired. Please start a new Unit Release. |
| Unit not Available | Unit {EngineNo} is no longer Available (status: {status}). |
| Unit outside user's branch | This unit does not belong to your branch. |
| Customer ineligible | Customer {CID} is not an approved Maker at {branch}. |
| Customer already has a unit | Customer {CID} already has a Unit Release ({TransactionNo}). |
| Missing field | {Field} is required. |
| Duplicate SI | SI No. {SINo} is already used by SALE-{SINo}. |

## 8. Testing

Apps Script has no test runner in this project; tests are editor-run functions following the existing `MCDiagnostics.js` pattern.

- `testUnitReleaseRules()` — no sheet access. Checks status/type normalization (`Approved`, ` APPROVED `, `Co-Maker`, `co_maker`, `Maker`), `UnitType` normalization (blank, `repo`, `Repossessed`, `Brand-New`), and required-document rules per type.
- `testUnitReleaseFlow()` — uses a configurable approved Maker CID (`_UR_TEST_CID`) and a test unit `TEST-MC-UR-0001` placed in that CIR's branch. Verifies: rejection with an unissued Transaction ID; rejection when docs are missing; success path (header, details, movement, `SALES` row, `MC_MASTER` = Sold); second release for the same CID rejected; duplicate SI rejected; the CIR row unchanged.
- `cleanupUnitReleaseTest()` — removes the test SALE rows from `TRANSACTION_HEADER`, `TRANSACTION_DETAILS`, `MC_MOVEMENTS`, `SALES`, and the test unit from `MC_MASTER`.
- Manual UI checklist: restricted user flow; `ALL` user selecting units from two branches (customer list follows); Brand-New vs Repo document switching; "Change unit" keeps Transaction ID and selection; success refresh; server error in `mcAlert`; Sales list columns and search.

## 9. Known limitations

- The branch scope and `CreatedBy` still come from the browser's login state; server functions do not verify a session. The server does re-derive the sale branch from `MC_MASTER`, but a caller could still claim `Scope = ALL`. To be addressed with the custom login work.
- Sheets writes are not transactional (§4.5).
- `CacheService` entries can be evicted early; the user then sees the "form expired" message and starts again.
- `createSale()` remains callable and does not perform the new checks.
