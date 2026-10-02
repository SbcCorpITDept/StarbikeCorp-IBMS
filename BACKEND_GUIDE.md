# IBMS - Integrated Branch Management System

Backend file guide.

This is a Google Apps Script V8 project. Local backend files use `.js`; clasp uploads them as Apps Script server files (shown as `.gs` in the editor). The existing clasp configuration accepts both extensions.

All server files share the same global scope. Functions and constants reference one another across files without imports, exports, or HTML includes. The frontend calls backend functions through google.script.run; motorcycle sales now use the Unit Release endpoints.

## Shared services

| File | Responsibility |
| --- | --- |
| [core/Config.js](backend/core/Config.js) | Spreadsheet IDs, sheet names, motorcycle schema, and seed data. |
| [core/Code.js](backend/core/Code.js) | Web app entry point. See BACKEND_GUIDE.md for the backend file map. |
| [core/Auth.js](backend/core/Auth.js) | Login validation and role-to-branch scope rules. |
| [core/Utils.js](backend/core/Utils.js) | Shared branch, date, currency, and column helpers. |
| [core/DriveImages.js](backend/core/DriveImages.js) | Drive attachment lookup and image URLs. |
| [core/Branches.js](backend/core/Branches.js) | Branch/region directories and active branch/supplier dropdowns. |

## Applications and dashboards

| File | Responsibility |
| --- | --- |
| [applications/CAS.js](backend/applications/CAS.js) | Customer applications, maker lookup, and credit application template rendering. |
| [applications/CIR.js](backend/applications/CIR.js) | Credit investigation records and report template rendering. |
| [applications/CashSales.js](backend/applications/CashSales.js) | Cash sale records and cash sales template rendering. |
| [applications/Dashboard.js](backend/applications/Dashboard.js) | Application metrics and motorcycle inventory dashboard metrics. |

The printable layouts remain in frontend/print/CASForm.html, frontend/print/CIRForm.html, and frontend/print/CashSalesForm.html. The interface lives in frontend/ (see README).

## Motorcycle operations

| File | Responsibility |
| --- | --- |
| [motorcycle/Inventory.js](backend/motorcycle/Inventory.js) | Current inventory, available units, profiles, and retained legacy reader. |
| [motorcycle/Database.js](backend/motorcycle/Database.js) | Motorcycle sheet access, master updates, and transaction status helpers. |
| [motorcycle/Transactions.js](backend/motorcycle/Transactions.js) | Shared transaction writer and receiving-report compatibility wrapper. |
| [motorcycle/Receiving.js](backend/motorcycle/Receiving.js) | Receiving-report creation, duplicate-unit checks, lists, and details. |
| [motorcycle/Transfers.js](backend/motorcycle/Transfers.js) | Transfer lists, creation, receipt confirmation, and cancellation. |
| [motorcycle/Sales.js](backend/motorcycle/Sales.js) | Unit Release (1 sale = 1 customer = 1 motorcycle): `beginUnitRelease`, `getSaleCustomers`, `createUnitRelease`, the sales list, and the retired `createSale`. |
| [motorcycle/SalesRules.js](backend/motorcycle/SalesRules.js) | Unit Release rules: UnitType / status / applicant normalization, required documents, `SALE-{SINo}` numbering. |
| [motorcycle/History.js](backend/motorcycle/History.js) | Per-unit movement history and filtered branch movement trail. |
| [motorcycle/Setup.js](backend/motorcycle/Setup.js) | Manual motorcycle database setup (`setupDatabase`), Unit Release setup (`setupSalesSchema`), and schema verification. |
| [motorcycle/Diagnostics.js](backend/motorcycle/Diagnostics.js) | Existing sheet diagnostics and manual lifecycle test/cleanup functions. |

When troubleshooting a transaction, start in its operation file, then follow calls into backend/motorcycle/Transactions.js and backend/motorcycle/Database.js. Current unit state lives in MC_MASTER; transaction records live in TRANSACTION_HEADER/TRANSACTION_DETAILS; movement history lives in MC_MOVEMENTS.

## Updating the Apps Script project

Push the full project with your existing clasp workflow, or create the matching server files in the Apps Script editor and copy their contents. Retain all listed backend files together. The entry point evaluates the frontend/Index template and its include() helper loads frontend partials. Print handlers load templates from frontend/print/. A later clasp push replaces the whole Apps Script project, so the old flat files are removed; update the web app deployment afterward.

Editing these files does not deploy or change connected spreadsheet data. The setup and editor diagnostic functions in backend/motorcycle/Diagnostics.js and backend/motorcycle/Setup.js modify spreadsheet rows only when explicitly run. Receiving Report and transfer behavior is retained; Unit Release replaces the legacy sale creation paths.

## Existing legacy call limitation

The older inventory transaction handler in frontend/js/Inventory.html references recordIBOut, recordIBIn, and recordSale, which were already absent from the original backend. Those old handler references remain outside this change. The dedicated transfer screen uses createIBOut and confirmIBIn. The dedicated Unit Release screen uses createUnitRelease; createSale and direct SALE through createTransaction return an error.


## Unit Release (Sales)

A sale releases exactly one Available motorcycle to one approved Maker customer at the unit's branch. `createUnitRelease()` re-checks everything on the server under one script lock, then writes `TRANSACTION_HEADER`, `TRANSACTION_DETAILS`, `MC_MOVEMENTS`, the new `SALES` row, and sets `MC_MASTER.CurrentStatus` to `Sold`. The legacy `createSale()` and SALE via `createTransaction()` are disabled. Design: [docs/superpowers/specs/2026-10-02-unit-release-sales-design.md](docs/superpowers/specs/2026-10-02-unit-release-sales-design.md).

One-time setup after deploying:

1. Run `setupSalesSchema()` from the Apps Script editor and read the log.
2. In `MC_MASTER`, change repossessed units' `UnitType` to `Repo` (blank and `Brand-New` read as Brand-New; any other value blocks the sale).
3. In AppSheet, regenerate the `CIR_Database` table structure once (three new header-only columns).
4. Optional: set `_UR_TEST_CID` in `backend/motorcycle/Diagnostics.js`, run `testUnitReleaseFlow`, check that every log line is PASS, then run `cleanupUnitReleaseTest`.

## Local tests

Server code is tested in Node with in-memory fakes of the Google services (`tests/harness.js`):

```powershell
node --test "tests/*.test.js"
```

`tests/` and `docs/` are excluded from `clasp push` by `.claspignore`. For UI checks, `node tests/ui/build-preview.js` writes `tests/ui/preview.html`, which runs the assembled frontend page against a stubbed `google.script.run`.

The suite also runs the actual sales UI script against the fake GAS runner and a minimal DOM (tests/ui/harness.js). It covers form state, branch switching, required fields, countdown, retry, duplicate clicks, delayed callbacks, and keyboard selection. It does not render CSS or simulate native browser focus and layout. See [tests/ui/README.md](tests/ui/README.md) for the remaining manual checks.

Known limitations retained from the approved design: branch scope and CreatedBy are browser-supplied; session verification is not added here. Google Sheets writes have no rollback after a partial service failure. Such failures need data reconciliation; replay of an already-written Transaction ID is rejected. Cached form IDs may expire early.
