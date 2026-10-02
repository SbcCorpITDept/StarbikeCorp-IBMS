# IBMS - Integrated Branch Management System

Backend file guide.

This is a Google Apps Script V8 project. Local backend files use `.js`; clasp uploads them as Apps Script server files (shown as `.gs` in the editor). The existing clasp configuration accepts both extensions.

All server files share the same global scope. Functions and constants reference one another across files without imports, exports, or HTML includes. Index.html continues to call the same backend functions through google.script.run.

## Shared services

| File | Responsibility |
| --- | --- |
| [Config.js](Config.js) | Spreadsheet IDs, sheet names, motorcycle schema, and seed data. |
| [Code.js](Code.js) | Web app entry point. See BACKEND_GUIDE.md for the backend file map. |
| [Auth.js](Auth.js) | Login validation and role-to-branch scope rules. |
| [Utils.js](Utils.js) | Shared branch, date, currency, and column helpers. |
| [DriveImages.js](DriveImages.js) | Drive attachment lookup and image URLs. |
| [Branches.js](Branches.js) | Branch/region directories and active branch/supplier dropdowns. |

## Applications and dashboards

| File | Responsibility |
| --- | --- |
| [ApplicationsCAS.js](ApplicationsCAS.js) | Customer applications, maker lookup, and credit application template rendering. |
| [ApplicationsCIR.js](ApplicationsCIR.js) | Credit investigation records and report template rendering. |
| [CashSales.js](CashSales.js) | Cash sale records and cash sales template rendering. |
| [Dashboard.js](Dashboard.js) | Application metrics and motorcycle inventory dashboard metrics. |

The printable layouts remain in CASFormTemplate.html, CIRFormTemplate.html, and CashSalesFormTemplate.html. The interface remains in Index.html.

## Motorcycle operations

| File | Responsibility |
| --- | --- |
| [MCInventory.js](MCInventory.js) | Current inventory, available units, profiles, and retained legacy reader. |
| [MCDatabase.js](MCDatabase.js) | Motorcycle sheet access, master updates, and transaction status helpers. |
| [MCTransactions.js](MCTransactions.js) | Shared transaction writer and receiving-report compatibility wrapper. |
| [MCReceiving.js](MCReceiving.js) | Receiving-report creation, duplicate-unit checks, lists, and details. |
| [MCTransfers.js](MCTransfers.js) | Transfer lists, creation, receipt confirmation, and cancellation. |
| [MCSales.js](MCSales.js) | Motorcycle unit releases and sale transactions. |
| [MCHistory.js](MCHistory.js) | Per-unit movement history and filtered branch movement trail. |
| [MCSetup.js](MCSetup.js) | Manual motorcycle database setup and schema verification. |
| [MCDiagnostics.js](MCDiagnostics.js) | Existing sheet diagnostics and manual lifecycle test/cleanup functions. |

When troubleshooting a transaction, start in its operation file, then follow calls into MCTransactions.js and MCDatabase.js. Current unit state lives in MC_MASTER; transaction records live in TRANSACTION_HEADER/TRANSACTION_DETAILS; movement history lives in MC_MOVEMENTS.

## Updating the Apps Script project

Push the full project with your existing clasp workflow, or create the matching server files in the Apps Script editor and copy their contents. Replace the old long Code file with the new short Code.js contents so the old declarations are not duplicated. Retain all listed backend files together.

This split preserves existing function names, signatures, function bodies, configuration values, and templates. It does not deploy or change connected spreadsheet data. The existing testPhase2Write and cleanupPhase2Test functions in MCDiagnostics.js modify spreadsheet rows when explicitly run.

## Existing legacy call limitation

The older inventory transaction handler in Index.html references recordIBOut, recordIBIn, and recordSale, which were already absent from the original backend. These references are retained by this organization-only change. The dedicated transfer and sale screens use createIBOut, confirmIBIn, and createSale, which are preserved.
