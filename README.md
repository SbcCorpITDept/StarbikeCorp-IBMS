# IBMS - Integrated Branch Management System

Google Apps Script web application for customer credit applications, credit investigation reports, cash sales, motorcycle inventory, receiving reports, interbranch transfers, unit releases, and branch dashboards.

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

## Save changes to GitHub

After editing, review and save the changes:

```powershell
git status
git add .
git commit -m "Describe the change"
git push
```

Each push stores the committed project version on GitHub. Uncommitted local edits are not backed up. To restore on another computer, clone this repository.

## Update Google Apps Script

GitHub backups and Apps Script deployments are separate. With clasp installed and authenticated, upload the local source using:

```powershell
clasp push
```

Before pushing, run the local tests:

```powershell
node --test "tests/*.test.js"
```

`.claspignore` keeps `tests/` and `docs/` out of the Apps Script project. After the Unit Release change is deployed, follow the one-time setup in [BACKEND_GUIDE.md](BACKEND_GUIDE.md#unit-release-sales).

Then update the web app deployment in the Apps Script editor when ready to publish the changes. Login credentials and environment files are excluded from Git.
