# IBMS - Integrated Branch Management System

Google Apps Script web application for customer credit applications, credit investigation reports, cash sales, motorcycle inventory, receiving reports, interbranch transfers, unit releases, and branch dashboards.

## Project structure

- Index.html: login, navigation, dashboards, and operation screens.
- Code.js: Apps Script web app entry point.
- Backend JavaScript files: grouped services and operations; see [BACKEND_GUIDE.md](BACKEND_GUIDE.md).
- CASFormTemplate.html, CIRFormTemplate.html, CashSalesFormTemplate.html: printable forms.
- appsscript.json: Apps Script manifest.
- .clasp.json: mapping to the existing Apps Script project; contains no login token.

Apps Script server files share a global scope. Local .js files upload as server scripts with clasp.

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
