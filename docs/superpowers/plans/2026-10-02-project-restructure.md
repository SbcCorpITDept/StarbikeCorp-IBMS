# Project Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the flat Apps Script project into `frontend/` + `backend/` folders and split `Index.html` into include-based partials, with the served page unchanged except for three documented block moves.

**Architecture:** `doGet` evaluates the `frontend/Index` template, whose `<?!= include('…'); ?>` lines pull in CSS, page-markup and JS partials through a new server `include()` helper. A one-time split script cuts today's `Index.html` at existing section markers and verifies the reassembled page against the original. Backend files move with `git mv`; tests load them recursively and rebuild the page with a shared assembler.

**Tech Stack:** Google Apps Script (V8, HtmlService templates), clasp 3.x, Node 24 (`node:test`, `node:vm`).

**Spec:** `docs/superpowers/specs/2026-10-02-project-restructure-design.md`

## Global Constraints

- Pure restructure: no behavior, text, class or script changes. The only allowed page differences are the three moves in spec §4.3 (motorcycle profile block, sale review modal, two dashboard CSS rule groups).
- Apps Script file names are the path without extension: `frontend/Index`, `frontend/css/Base`, `frontend/print/CASForm`, `backend/core/Code`, …
- Partials contain no `<?` scriptlets and include nothing themselves.
- Move files with `git mv` so history follows them.
- Pre-existing duplicate element IDs `pageHeaderTitle` and `pageHeaderSubtitle` stay as they are (out of scope); no new duplicates.
- Local tests: `node --test "tests/*.test.js"` from the repo root. All 70 current tests must keep passing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not `git push` or `clasp push`.

## Review Focus

- A partial file that exists but is never included (dead markup) → caught by `every css/pages/js partial is included exactly once` (Task 1).
- A section marker matching twice (e.g. the same comment text inside a JS template string) → the split script's `once()` aborts before writing anything (Task 2).
- Scripts reordered or edited by the split → the migration check compares every inline `<script>` body in order (Task 2).
- `clasp push` uploading `tests/` or `docs/`, or missing the new folders → `clasp show-file-status` check (Task 3).
- A print template or the page shell renamed without updating the backend → `print templates resolve` and `doGet serves frontend/Index` tests (Task 3).

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `tests/assemble.js` | Create | `assemblePage(root)`, `includeNames(root)` — rebuild the served page from includes. |
| `tests/frontend-structure.test.js` | Create | Includes resolve, partials used once, no scriptlets, no new duplicate IDs. |
| `tests/backend-layout.test.js` | Create | `doGet`, `include`, print templates, no server files left at the root. |
| `frontend/Index.html` + `css/`, `pages/`, `js/` | Create (split) | Page shell and partials (spec §4.2). |
| `frontend/print/*.html` | Move | Print templates. |
| `backend/core|applications|motorcycle/*.js` | Move | Server code (spec §3). |
| `backend/core/Code.js` | Modify | Template `doGet` + `include()`. |
| `backend/applications/CAS.js`, `CIR.js`, `CashSales.js` | Modify | Print template names. |
| `Index.html` | Delete | Replaced by `frontend/`. |
| `tests/harness.js` | Modify | Load `backend/**/*.js`; fake `HtmlService`. |
| `tests/ui-syntax.test.js`, `tests/ui/harness.js`, `tests/ui/build-preview.js` | Modify | Read the assembled page. |
| `.claspignore` | Modify | Push `appsscript.json`, `frontend/**/*.html`, `backend/**/*.js`. |
| `README.md`, `BACKEND_GUIDE.md`, `tests/ui/README.md` | Modify | New paths. |

---

### Task 1: Page assembler and structure tests

**Files:**
- Create: `tests/assemble.js`, `tests/frontend-structure.test.js`

**Interfaces:**
- Produces: `assemblePage(root = ROOT) → string`, `includeNames(root = ROOT) → string[]` (e.g. `'frontend/css/Base'`), `ROOT` (repo root). Include line format: `^[ \t]*<?!= include('NAME'); ?>\n`, replaced by the full content of `NAME.html`.

- [ ] **Step 1: Write the assembler**

Create `tests/assemble.js`:

```js
// tests/assemble.js - Rebuilds the page HtmlService serves: every
// `<?!= include('name'); ?>` line in frontend/Index.html is replaced by that
// partial's full content (partials contain no scriptlets).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INCLUDE_LINE = /^[ \t]*<\?!= include\('([^']+)'\); \?>\r?\n/gm;

function readPartial(root, name) {
  return fs.readFileSync(path.join(root, name + '.html'), 'utf8');
}

function includeNames(root = ROOT) {
  return [...readPartial(root, 'frontend/Index').matchAll(INCLUDE_LINE)].map(m => m[1]);
}

function assemblePage(root = ROOT) {
  return readPartial(root, 'frontend/Index').replace(INCLUDE_LINE, (line, name) => readPartial(root, name));
}

module.exports = { assemblePage, includeNames, ROOT };
```

- [ ] **Step 2: Write the failing structure tests**

Create `tests/frontend-structure.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assemblePage, includeNames, ROOT } = require('./assemble');

// Partial names (no extension) under frontend/<dir>, recursively.
function partials(dir) {
  const base = path.join(ROOT, 'frontend', dir);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
  return walk(base).map(f => path.relative(ROOT, f).replace(/\\/g, '/').replace(/\.html$/, ''));
}

test('every include in frontend/Index.html resolves to a partial', () => {
  const names = includeNames();
  assert.ok(names.length > 0, 'frontend/Index.html has include lines');
  for (const name of names) assert.ok(fs.existsSync(path.join(ROOT, name + '.html')), name);
});

test('every css/pages/js partial is included exactly once', () => {
  const included = includeNames();
  assert.equal(new Set(included).size, included.length, 'no partial is included twice');
  const all = ['css', 'pages', 'js'].flatMap(partials);
  assert.deepEqual([...included].sort(), all.sort());
});

test('partials contain no scriptlets and the assembled page has none left', () => {
  for (const name of includeNames()) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8'), /<\?/, name);
  }
  assert.doesNotMatch(assemblePage(), /<\?/);
});

test('no new duplicate element ids in the page markup', () => {
  const markup = assemblePage().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  // Pre-existing: the CAS/CIR/Cash table headers share these two ids (out of scope).
  assert.deepEqual(dupes, ['pageHeaderSubtitle', 'pageHeaderTitle']);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test "tests/*.test.js"`
Expected: the 4 new tests FAIL with `ENOENT … frontend\Index.html`; the existing 70 PASS.

- [ ] **Step 4: Commit**

```powershell
git add tests/assemble.js tests/frontend-structure.test.js
git commit -m @'
Add page assembler and frontend structure tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Split Index.html into frontend partials

**Files:**
- Create: `frontend/Index.html`, `frontend/css/{Base,Layout,Components,Dashboard}.html`, `frontend/pages/{Login,Navbar,Dashboard,Applications,Inventory,Receiving,Transfers,Sales,History}.html`, `frontend/js/{App,Dashboard,Forms,Inventory}.html`
- Delete: `Index.html`
- Modify: `tests/ui-syntax.test.js`, `tests/ui/harness.js`, `tests/ui/build-preview.js`, `tests/ui/README.md`

**Interfaces:**
- Consumes: `assemblePage`, `ROOT` (Task 1).

- [ ] **Step 1: Write the one-time split script (not committed)**

Save as `split-index.js` in the session scratchpad directory (outside the repo) and run it from the repo root. It reads `Index.html`, writes the partials and shell, then runs the migration check against the original. It writes nothing if a marker is missing, duplicated or out of order.

```js
// split-index.js - One-time split of Index.html into frontend/ partials.
// Run from the repo root: node <path>/split-index.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { assemblePage } = require(path.join(process.cwd(), 'tests', 'assemble.js'));

const original = fs.readFileSync('Index.html', 'utf8').replace(/\r\n/g, '\n');

function once(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + JSON.stringify(marker));
  if (text.indexOf(marker, i + 1) >= 0) throw new Error('marker not unique: ' + JSON.stringify(marker));
  return i;
}

// ── 1. Dashboard-only CSS rules move to css/Dashboard (spec §4.3 #3) ──
const STAT_START = '    .stat-card {\n';
const STAT_END = '    ::-webkit-scrollbar {\n';
const TREND_RULE = '\n    #trendRangeToggle .trend-range-active {\n      background: #f1f5f9;\n      color: #0f172a;\n    }\n';
let src = original;
const s0 = once(src, STAT_START), s1 = once(src, STAT_END);
const statCss = src.slice(s0, s1);                       // both .stat-card rules + trailing blank line
src = src.slice(0, s0) + src.slice(s1);
const t0 = once(src, TREND_RULE);
src = src.slice(0, t0) + src.slice(t0 + TREND_RULE.length);
const DASHBOARD_CSS = '  <!-- DASHBOARD STYLE -->\n  <style>\n' + statCss + TREND_RULE.slice(1) + '  </style>\n';

// ── 2. Ordered cut points. Each part runs from its marker to the next one.
// file: null → stays in the shell. deferred: appended after the file's other parts.
const parts = [
  { file: null, at: '<!DOCTYPE html>' },
  { file: 'frontend/css/Base', at: '  <!-- GLOBAL STYLING -->\n' },
  { file: 'frontend/css/Layout', at: '  <style>\n    /* Shared branding for sign-in and navigation. */\n' },
  { file: 'frontend/css/Components', at: '  <!-- LOGIN STYLE -->\n' },
  { file: null, at: '</head>\n\n<body class="min-h-screen">\n' },
  { file: 'frontend/pages/Login', at: '  <!-- ==================== LOGIN SCREEN ==================== -->\n' },
  { file: 'frontend/pages/Navbar', at: '  <!-- ==================== NAVBAR (REDESIGNED) ==================== -->\n' },
  { file: null, at: '  <!-- ==================== DASHBOARD SCREEN ==================== -->\n' },
  { file: 'frontend/pages/Dashboard', at: '    <!-- DASHBOARD PAGE -->\n' },
  { file: 'frontend/pages/Applications', at: '    <!-- ==================== CAS TABLE PAGE ==================== -->\n' },
  { file: 'frontend/pages/Inventory', at: '    <!-- ==================== MC INV TABLE PAGE ================== -->\n' },
  { file: 'frontend/pages/Receiving', at: '    <!-- RECEIVING REPORTS — LIST -->\n' },
  { file: 'frontend/pages/Transfers', at: '    <!-- INTERBRANCH TRANSFERS — LIST -->\n' },
  { file: 'frontend/pages/Sales', at: '    <!-- SALE REVIEW / CONFIRM MODAL (with countdown) -->\n', deferred: true },
  { file: 'frontend/pages/Transfers', at: '    <!-- CANCEL PENDING TRANSFER MODAL (with countdown) -->\n' },
  { file: 'frontend/pages/Sales', at: '    <!-- SALES — LIST (Unit Releases: 1 sale = 1 customer = 1 motorcycle) -->\n' },
  { file: 'frontend/pages/History', at: '    <!-- MOVEMENT HISTORY -->\n' },
  { file: 'frontend/pages/Inventory', at: '    <!-- MOTORCYCLE PROFILE -->\n' },
  { file: null, at: '  </div>\n  <!-- END DASHBOARD SCREEN -->\n' },
  { file: 'frontend/js/App', at: '  <!-- ==================== SCRIPTS ==================== -->\n' },
  { file: 'frontend/js/Dashboard', at: '  <!-- ==================== DASHBOARD SCRIPT' },
  { file: 'frontend/js/Forms', at: '  <!-- ==================== SHARED PAGINATION HELPER' },
  { file: 'frontend/js/Inventory', at: '  <!-- ==================== MC INV TABLE SCRIPT' },
  { file: null, at: '</body>\n</html>' }
];
const pos = parts.map(p => once(src, p.at));
pos.forEach((p, i) => { if (i && p <= pos[i - 1]) throw new Error('marker out of order: ' + parts[i].at); });
if (pos[0] !== 0) throw new Error('Index.html must start with <!DOCTYPE html>');

// ── 3. Build the shell and the partials ──
const body = {}, deferred = {};
let shell = '';
parts.forEach((p, i) => {
  const text = src.slice(pos[i], i + 1 < parts.length ? pos[i + 1] : src.length);
  if (!p.file) { shell += text; return; }
  if (p.deferred) { deferred[p.file] = (deferred[p.file] || '') + text; return; }
  if (!(p.file in body)) {
    shell += text.match(/^ */)[0] + "<?!= include('" + p.file + "'); ?>\n";
    body[p.file] = '';
  }
  body[p.file] += text;
});
Object.keys(deferred).forEach(f => {
  if (!(f in body)) throw new Error('deferred part has no main part: ' + f);
  body[f] += deferred[f];
});
body['frontend/css/Dashboard'] = DASHBOARD_CSS;
shell = shell.replace('</head>\n', "  <?!= include('frontend/css/Dashboard'); ?>\n</head>\n");

fs.mkdirSync('frontend', { recursive: true });
fs.writeFileSync('frontend/Index.html', shell);
Object.keys(body).forEach(f => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.html', body[f]);
});

// ── 4. Migration check (spec §6) ──
const assembled = assemblePage(process.cwd());

// (a) Same non-blank lines; the only additions are the css/Dashboard wrapper.
const count = t => t.split('\n').filter(l => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
const a = count(assembled), o = count(original);
const added = { '  <!-- DASHBOARD STYLE -->': 1, '  <style>': 1, '  </style>': 1 };
for (const line of new Set([...a.keys(), ...o.keys()])) {
  assert.equal((a.get(line) || 0) - (o.get(line) || 0), added[line] || 0, 'line count differs: ' + JSON.stringify(line));
}

// (b) Inline scripts identical, same order.
const scripts = t => [...t.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.deepEqual(scripts(assembled), scripts(original), 'inline scripts changed');

// (c) Element ids: same set; same order once the two moved blocks are set aside.
const ids = t => [...t.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const block = (start, end) => original.slice(once(original, start), once(original, end));
const moved = new Set([
  ...ids(block('    <!-- MOTORCYCLE PROFILE -->\n', '  </div>\n  <!-- END DASHBOARD SCREEN -->\n')),
  ...ids(block('    <!-- SALE REVIEW / CONFIRM MODAL (with countdown) -->\n', '    <!-- CANCEL PENDING TRANSFER MODAL (with countdown) -->\n'))
]);
assert.deepEqual([...ids(assembled)].sort(), [...ids(original)].sort(), 'id set changed');
const keep = list => list.filter(id => !moved.has(id));
assert.deepEqual(keep(ids(assembled)), keep(ids(original)), 'id order changed outside the moved blocks');
assert.doesNotMatch(assembled, /<\?/);

console.log('Wrote ' + (Object.keys(body).length + 1) + ' files; migration check passed (' +
  scripts(original).length + ' scripts, ' + ids(original).length + ' ids, ' + moved.size + ' ids in moved blocks).');
```

- [ ] **Step 2: Run the split**

Run: `node "<scratchpad>/split-index.js"` from the repo root.
Expected: `Wrote 18 files; migration check passed (…)` and these new files exist: `frontend/Index.html`, 4 in `frontend/css/`, 9 in `frontend/pages/`, 4 in `frontend/js/`. If it throws, nothing has been deleted — read the message (marker or check), fix the script, delete the generated `frontend/` folder and rerun.

- [ ] **Step 3: Inspect the shell**

Read `frontend/Index.html`. Expected: about 50 lines — doctype, `<head>` meta/title/CDN tags, 4 CSS include lines, `<body …>`, Login and Navbar includes, the `dashboardScreen` wrapper around 7 page includes, the 4 JS includes, `</body></html>`.

- [ ] **Step 4: Point the UI tests and preview at the assembled page**

In `tests/ui-syntax.test.js` replace

```js
  const html = fs.readFileSync(path.join(__dirname, '../Index.html'), 'utf8');
```

with

```js
  const html = require('./assemble').assemblePage();
```

and change the label `'Index.html inline script '` to `'assembled page inline script '`. If `fs` and `path` are then unused in that file, remove their `require` lines.

In `tests/ui/harness.js` replace

```js
const html = fs.readFileSync(path.join(__dirname, '../../Index.html'), 'utf8');
```

with

```js
const html = require('../assemble').assemblePage();
```

and change `{ filename: 'Index.html sales script' }` to `{ filename: 'frontend/js/Inventory.html sales script' }`.

In `tests/ui/build-preview.js` replace

```js
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
```

with

```js
const html = require('../assemble').assemblePage(root);
```

change the error text `'No <head> tag found in Index.html'` to `'No <head> tag found in the assembled page'`, and in the header comment change `(Index.html with the` to `(the assembled frontend/ page with the`.

In `tests/ui/README.md` change `Build a standalone preview from the current Index.html:` to `Build a standalone preview from the assembled frontend/ page:`.

- [ ] **Step 5: Delete the old page**

Run: `git rm -q Index.html`

- [ ] **Step 6: Run all tests**

Run: `node --test "tests/*.test.js"`
Expected: 74 PASS, 0 FAIL (70 existing + 4 structure tests).

- [ ] **Step 7: Rebuild the preview**

Run: `node tests/ui/build-preview.js`
Expected: `Wrote …\tests\ui\preview.html`.

- [ ] **Step 8: Commit**

```powershell
git add -A frontend tests
git commit -m @'
Split Index.html into frontend/ shell, css, pages and js partials

Pure restructure; the assembled page matches the old Index.html except the
documented moves (profile page, sale review modal, dashboard CSS rules).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Move the backend and switch doGet to the template

**Files:**
- Move (git mv): all root `*.js` → `backend/...`; `*FormTemplate.html` → `frontend/print/...` (spec §3)
- Modify: `backend/core/Code.js`, `backend/applications/CAS.js:297`, `backend/applications/CIR.js:315`, `backend/applications/CashSales.js:151`, `tests/harness.js`, `.claspignore`
- Test: `tests/backend-layout.test.js`

**Interfaces:**
- Produces: `include(filename) → string` (global server function); `doGet()` serves `frontend/Index`. Harness context gains `HtmlService` fake: `createHtmlOutputFromFile(name).getContent()`, `createTemplateFromFile(name)` → object whose `evaluate()` returns an output with chainable `setTitle`, `setXFrameOptionsMode`, `addMetaTag`, and `getContent()`; `XFrameOptionsMode.ALLOWALL`. Missing files throw `ENOENT`.

- [ ] **Step 1: Write the failing tests**

Create `tests/backend-layout.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness');
const { makeData } = require('./fixtures');

const ROOT = path.join(__dirname, '..');

test('no server files are left at the project root', () => {
  assert.deepEqual(fs.readdirSync(ROOT).filter(f => f.endsWith('.js')), []);
});

test('doGet serves frontend/Index', () => {
  const app = loadApp(makeData());
  const out = app.fn('doGet')({});
  assert.match(out.getContent(), /<\?!= include\('frontend\/css\/Base'\); \?>/);
});

test('include returns a frontend partial', () => {
  const app = loadApp(makeData());
  assert.match(app.run('include', 'frontend/css/Base'), /<!-- GLOBAL STYLING -->/);
});

test('print templates resolve', () => {
  const app = loadApp(makeData());
  for (const fn of ['getCasApplicationForm', 'getCIRForm', 'getCashSalesForm']) {
    assert.equal(typeof app.fn(fn)({}), 'string', fn);
  }
});
```

- [ ] **Step 2: Add the HtmlService fake to the harness and run the tests**

In `tests/harness.js`, inside the `context` object of `loadApp` (after `SpreadsheetApp: {…}`), add:

```js
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => {
        const content = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
        return { getContent: () => content };
      },
      createTemplateFromFile: name => {
        const content = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
        return {
          evaluate: () => {
            const out = {
              setTitle: () => out, setXFrameOptionsMode: () => out, addMetaTag: () => out,
              getContent: () => content
            };
            return out;
          }
        };
      }
    },
```

(A comma follows the preceding `SpreadsheetApp` entry.)

Run: `node --test "tests/*.test.js"`
Expected: 3 new tests FAIL — root `.js` files still exist; `doGet` looks for `Index.html` (deleted in Task 2); `include` is not defined. `print templates resolve` PASSES now (the templates are still at the root) and must still pass after the move. Other tests PASS.

- [ ] **Step 3: Move the files**

```powershell
New-Item -ItemType Directory -Force backend/core, backend/applications, backend/motorcycle, frontend/print | Out-Null
git mv Code.js backend/core/Code.js
git mv Config.js backend/core/Config.js
git mv Auth.js backend/core/Auth.js
git mv Utils.js backend/core/Utils.js
git mv DriveImages.js backend/core/DriveImages.js
git mv Branches.js backend/core/Branches.js
git mv ApplicationsCAS.js backend/applications/CAS.js
git mv ApplicationsCIR.js backend/applications/CIR.js
git mv CashSales.js backend/applications/CashSales.js
git mv Dashboard.js backend/applications/Dashboard.js
git mv MCInventory.js backend/motorcycle/Inventory.js
git mv MCReceiving.js backend/motorcycle/Receiving.js
git mv MCTransfers.js backend/motorcycle/Transfers.js
git mv MCSales.js backend/motorcycle/Sales.js
git mv MCHistory.js backend/motorcycle/History.js
git mv MCDatabase.js backend/motorcycle/Database.js
git mv MCTransactions.js backend/motorcycle/Transactions.js
git mv MCSalesRules.js backend/motorcycle/SalesRules.js
git mv MCSetup.js backend/motorcycle/Setup.js
git mv MCDiagnostics.js backend/motorcycle/Diagnostics.js
git mv CASFormTemplate.html frontend/print/CASForm.html
git mv CIRFormTemplate.html frontend/print/CIRForm.html
git mv CashSalesFormTemplate.html frontend/print/CashSalesForm.html
```

Then update the first comment line of each moved `.js` file to its new name, e.g. `// MCSales.js - …` → `// Sales.js - …`, `// ApplicationsCAS.js - …` → `// CAS.js - …` (files keeping their name need no change).

- [ ] **Step 4: Switch `doGet` to the template and add `include`**

Replace the whole content of `backend/core/Code.js` with:

```js
// Code.js - Web app entry point and HTML include helper.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// doGet
// =============================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('frontend/Index')
    .evaluate()
    .setTitle('IBMS — Integrated Branch Management System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Raw content of a frontend partial, for <?!= include('frontend/css/Base'); ?>
// lines in frontend/Index.html. Partials contain no scriptlets.
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

- [ ] **Step 5: Update the print template names**

- `backend/applications/CAS.js`: `createTemplateFromFile('CASFormTemplate')` → `createTemplateFromFile('frontend/print/CASForm')`
- `backend/applications/CIR.js`: `createTemplateFromFile('CIRFormTemplate')` → `createTemplateFromFile('frontend/print/CIRForm')`
- `backend/applications/CashSales.js`: `createTemplateFromFile('CashSalesFormTemplate')` → `createTemplateFromFile('frontend/print/CashSalesForm')`

- [ ] **Step 6: Load the backend recursively in the harness**

In `tests/harness.js` replace

```js
  fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  });
```

with

```js
  serverFiles(path.join(ROOT, 'backend')).forEach(f => {
    vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: path.relative(ROOT, f) });
  });
```

and add above `function loadApp`:

```js
// Every backend/**/*.js file, sorted by path (Apps Script shares one global scope).
function serverFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? serverFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  }).sort();
}
```

- [ ] **Step 7: Update `.claspignore`**

Replace its content with:

```
# clasp pushes only the Apps Script sources: the manifest, frontend HTML and
# backend JS. tests/, docs/ and everything else stay local.
**/**
!appsscript.json
!frontend/**/*.html
!backend/**/*.js
```

- [ ] **Step 8: Run all tests**

Run: `node --test "tests/*.test.js"`
Expected: 78 PASS, 0 FAIL.

- [ ] **Step 9: Verify the clasp push list**

Run: `clasp show-file-status`
Expected: exactly `appsscript.json`, the 18 `frontend/` page files, the 3 `frontend/print/` files and the 20 `backend/` files are listed to push; nothing from `tests/`, `docs/`, or the repo root besides `appsscript.json`. If clasp needs a login, note it and continue; this check must pass before any `clasp push`.

- [ ] **Step 10: Commit**

```powershell
git add -A backend frontend tests .claspignore
git commit -m @'
Move server code to backend/ and print templates to frontend/print

doGet now evaluates the frontend/Index template; include() serves partials.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Docs, browser smoke check, final verification

**Files:**
- Modify: `README.md`, `BACKEND_GUIDE.md`

- [ ] **Step 1: Update README**

Replace the "## Project structure" list in `README.md` with:

```markdown
## Project structure

- `frontend/Index.html` — page shell; pulls in the partials below with `<?!= include('…'); ?>`.
- `frontend/css/` — Base, Layout, Components, Dashboard styles.
- `frontend/pages/` — Login, Navbar, Dashboard, Applications, Inventory, Receiving, Transfers, Sales, History markup.
- `frontend/js/` — App (auth, navigation), Dashboard, Forms (CAS/CIR/Cash tables), Inventory (motorcycle screens).
- `frontend/print/` — printable CAS, CIR and Cash Sales forms.
- `backend/core/` — `doGet`/`include`, config, auth, shared helpers, branches, Drive images.
- `backend/applications/` — CAS, CIR, Cash Sales and dashboard data.
- `backend/motorcycle/` — inventory, receiving, transfers, sales (Unit Release), history, plus shared database, transaction, rules, setup and diagnostics files. See [BACKEND_GUIDE.md](BACKEND_GUIDE.md).
- `appsscript.json` — Apps Script manifest. `.clasp.json` maps to the existing Apps Script project; `.claspignore` limits pushes to `frontend/`, `backend/` and the manifest.

Apps Script server files share one global scope; folder names become part of each file's name (for example `backend/core/Code`).
```

- [ ] **Step 2: Update BACKEND_GUIDE**

In `BACKEND_GUIDE.md`, update every file link and mention to its new path, using the spec §3 table — for example `[Config.js](Config.js)` → `[core/Config.js](backend/core/Config.js)`, `[MCSales.js](MCSales.js)` → `[motorcycle/Sales.js](backend/motorcycle/Sales.js)`, `MCTransactions.js and MCDatabase.js` → `motorcycle/Transactions.js and motorcycle/Database.js`, `MCDiagnostics.js` → `motorcycle/Diagnostics.js`, `MCSetup.js` → `motorcycle/Setup.js`, `CASFormTemplate.html, CIRFormTemplate.html, and CashSalesFormTemplate.html` → `frontend/print/`, `The interface remains in Index.html` → `The interface lives in frontend/ (see README)`, and `inventory transaction handler in Index.html` → `inventory transaction handler in frontend/js/Inventory.html`. In "Updating the Apps Script project", add: `clasp push replaces the whole Apps Script project, so the old flat files are removed; update the web app deployment afterward.`

Run: `rg -n "MC[A-Z][a-zA-Z]+\.js|Applications(CAS|CIR)\.js|FormTemplate|\]\((Code|Config|Auth|Utils|DriveImages|Branches|CashSales|Dashboard)\.js\)|Index\.html" README.md BACKEND_GUIDE.md`
Expected: no matches.

- [ ] **Step 3: Browser smoke check**

Run `node tests/ui/build-preview.js`, serve `tests/ui/` on localhost (the browser tool blocks `file:`), open `preview.html`, clear localStorage, log in. Check: navbar centered with 3 menus; dashboard renders; Applications ▸ Customer Applications opens its table page; `openCreateSale()` shows Unit Release step 1 with ENG1001/ENG1002/ENG1004; the browser console has no errors other than the missing favicon. Stop the server and delete `.playwright-mcp/` afterwards.

- [ ] **Step 4: Final verification**

Run: `node --test "tests/*.test.js"` → 78 PASS, 0 FAIL.
Run: `git status -s` → clean except intended doc changes.

- [ ] **Step 5: Commit**

```powershell
git add README.md BACKEND_GUIDE.md
git commit -m @'
Document the frontend/backend layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

Do not run `git push` or `clasp push`.
