# Project Restructure — Design

Date: 2026-10-02
Status: Approved

## 1. Goal

Reorganize the flat project into `frontend/` and `backend/` folders and split the 6,200-line `Index.html` into focused partials, **without changing what the app does or what the browser receives** (apart from the documented block moves in §4.3).

## 2. Target tree

```
BAF-Dashboard/
├── frontend/
│   ├── Index.html                 shell: <head> CDN tags + include() calls
│   ├── css/      Base, Layout, Components, Dashboard            (.html)
│   ├── pages/    Login, Navbar, Dashboard, Applications, Inventory,
│   │             Receiving, Transfers, Sales, History            (.html)
│   ├── js/       App, Dashboard, Forms, Inventory               (.html)
│   └── print/    CASForm, CIRForm, CashSalesForm                (.html)
├── backend/
│   ├── core/          Code, Config, Auth, Utils, DriveImages, Branches          (.js)
│   ├── applications/  CAS, CIR, CashSales, Dashboard                            (.js)
│   └── motorcycle/    Inventory, Receiving, Transfers, Sales, History,
│                      Database, Transactions, SalesRules, Setup, Diagnostics   (.js)
├── tests/   docs/   README.md   BACKEND_GUIDE.md
├── appsscript.json   .clasp.json   .claspignore
```

## 3. Backend moves (git mv, contents unchanged except §5)

| From | To |
|---|---|
| Code.js, Config.js, Auth.js, Utils.js, DriveImages.js, Branches.js | `backend/core/` (same names) |
| ApplicationsCAS.js, ApplicationsCIR.js | `backend/applications/CAS.js`, `CIR.js` |
| CashSales.js, Dashboard.js | `backend/applications/CashSales.js`, `Dashboard.js` |
| MCInventory, MCReceiving, MCTransfers, MCSales, MCHistory (.js) | `backend/motorcycle/Inventory.js`, `Receiving.js`, `Transfers.js`, `Sales.js`, `History.js` |
| MCDatabase, MCTransactions, MCSalesRules, MCSetup, MCDiagnostics (.js) | `backend/motorcycle/Database.js`, `Transactions.js`, `SalesRules.js`, `Setup.js`, `Diagnostics.js` |
| CASFormTemplate, CIRFormTemplate, CashSalesFormTemplate (.html) | `frontend/print/CASForm.html`, `CIRForm.html`, `CashSalesForm.html` |

All server files still share one global scope. Every top-level declaration is a literal, so file load order does not matter.

## 4. Frontend split

### 4.1 Loading

- `doGet` uses `HtmlService.createTemplateFromFile('frontend/Index').evaluate()` (same title, X-Frame and viewport settings).
- New `include(filename)` in `backend/core/Code.js` returns `HtmlService.createHtmlOutputFromFile(filename).getContent()`.
- `frontend/Index.html` keeps the doctype, `<head>` meta/title/CDN tags, the `dashboardScreen` wrapper, and one `<?!= include('frontend/...'); ?>` line per partial. Partials contain no scriptlets and include nothing themselves. Today's `Index.html` contains no `<?`, so templating is safe.
- Print templates are loaded as `frontend/print/CASForm`, `frontend/print/CIRForm`, `frontend/print/CashSalesForm`.

### 4.2 Partials (whole blocks, original order)

| File | Content (marker in today's Index.html) |
|---|---|
| css/Base | `<!-- GLOBAL STYLING -->` block |
| css/Layout | Branding style block + `<!-- NAVIGATION STYLE -->` block |
| css/Components | `<!-- LOGIN STYLE -->` block + `<!-- DATA TABLE STYLE -->` block |
| css/Dashboard | `.stat-card` rules (from Components) and `#trendRangeToggle .trend-range-active` (from Layout), in a new `<!-- DASHBOARD STYLE -->` block placed last in `<head>` |
| pages/Login | Login screen + logout modal |
| pages/Navbar | Navbar + user menu |
| pages/Dashboard | Applications dashboard page |
| pages/Applications | CAS, CIR, Cash table pages and their modals |
| pages/Inventory | MC inventory table, inventory dashboard, motorcycle profile |
| pages/Receiving | Receiving Report list, details, new-RR and review modals |
| pages/Transfers | Transfer list/create pages; transfer, cancel and receipt modals |
| pages/Sales | Unit Release list/create pages + sale review modal |
| pages/History | Movement history page |
| js/App | `<!-- SCRIPTS -->` first script (auth, navigation, `showPage`) |
| js/Dashboard | `<!-- DASHBOARD SCRIPT -->` |
| js/Forms | Shared pagination, region/branch filter, CAS/CIR/Cash table scripts |
| js/Inventory | Every motorcycle script from `<!-- MC INV TABLE SCRIPT -->` to the end, including shared MC helpers and global UX helpers |

### 4.3 Allowed differences from today's page

Only these blocks change position; their content is byte-identical:

1. The motorcycle profile page moves from after Movement History to after the inventory dashboard (inside `pages/Inventory`).
2. The sale review modal moves from between the transfer modals to after the create-sale page (inside `pages/Sales`).
3. The `.stat-card` and trend-toggle CSS rules move into the new last `<style>` block (`css/Dashboard`).

All three are hidden-by-default elements or rules with unique selectors, so rendering and behavior are unchanged. Scripts keep their exact order and content.

## 5. Tooling

- `.claspignore` pushes only `appsscript.json`, `frontend/**/*.html` and `backend/**/*.js`.
- `tests/assemble.js` (`assemblePage(root)`) rebuilds the served page by replacing each include line with the partial's content, as HtmlService does.
- `tests/harness.js` loads `backend/**/*.js` recursively (sorted by path).
- `tests/ui-syntax.test.js`, `tests/ui/harness.js` and `tests/ui/build-preview.js` read the assembled page instead of `Index.html`.
- New `tests/frontend-structure.test.js`: every include resolves; every partial under `css/`, `pages/`, `js/` is included exactly once; no `<?` left in the assembled page; element IDs unique; every `createTemplateFromFile` / `createHtmlOutputFromFile` name used by the backend exists under `frontend/`.
- README and BACKEND_GUIDE list the new paths. Historical specs/plans are left as written.

## 6. Verification

- **One-time migration check** (before deleting the old `Index.html`): the assembled page equals today's `Index.html` with exactly the §4.3 moves applied, and the inline script bodies are identical and in the same order.
- All existing tests pass (70) plus the new structure tests.
- `clasp show-file-status` lists exactly the intended files.
- Browser smoke check of the preview: login, dashboard, a table page, Unit Release step 1.

## 7. Deployment note

`clasp push` replaces the whole Apps Script project, so the old flat files are removed remotely. After pushing, update the web app deployment. Nothing is pushed as part of this work.
