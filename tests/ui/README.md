# Unit Release UI verification

Build a standalone preview from the current Index.html:

~~~powershell
node tests/ui/build-preview.js
~~~

Open tests/ui/preview.html in a browser. Internet access is needed for the existing CDN styles, icons and fonts. The preview loads mock-gas.js before application code: all google.script.run calls use fake data, with no spreadsheet writes. Sign in with any email-shaped value and any nonempty password. To start with fresh login state, use a private browser window.

Automated checks:

~~~powershell
node --test "tests/*.test.js"
~~~

release-ui.test.js executes the real sales script with the same mock-gas.js and a minimal DOM. It checks data rendering strings and state transitions, not browser layout, native event order, focus or screenshots.

## Manual rendered checks

1. Open Unit Releases (Sales) from the Motorcycle Movement menu, then New Unit Release. As the default restricted user, only ENG1001, ENG1002 and ENG1004 appear. Branch is hidden in the selection table; the Demo type is red and cannot be selected.
2. Search 1002, clear the search, select ENG1001 and Continue. Verify read-only Transaction ID/Branch, the full motorcycle details, Brand-New badge, ATR and SI fields, and hidden RCI. Check desktop and narrow mobile widths for clipping.
3. Search for ana in the customer picker. Select SANTOS with a mouse, then repeat with ArrowDown/Enter. With an empty search, ArrowUp should highlight the last option; confirm that the highlight is visible. Escape closes the list. Contact/address fill and are read-only. Typing again clears the customer selection and details. Verify the options stay clickable and visually readable.
4. Use Change unit, choose ENG1002, and Continue. The Transaction ID and customer stay the same; RCI replaces ATR. Verify Account, RCI and SI required-field messages.
5. Enter ACC-9, RCI-9 and SI-9 and open Review & Release. Check one unit, all identifiers, documents and branch. The five-second countdown must visibly finish before Confirm is enabled. At a small viewport, scroll to confirm/cancel; check the backdrop and alert stacking.
6. Before confirming, use the browser console to simulate a server rejection:
   ~~~js
   window.__nextRelease = { success: false, message: 'SI No. SI-9 is already used by SALE-SI-9.' };
   ~~~
   Confirm, acknowledge the alert, and check that the form values remain. Confirm again for success. Check the toast and sales row, then search by SI, sale number, name, account and engine. A new release must exclude ENG1002 and SANTOS.
7. For an ALL-branch user, open the preview in a fresh private window. Before login, run:
   ~~~js
   window.__mockUser = Object.assign({}, window.__mockUser, {
     role: 'Admin', branch: 'ALL', branchScope: 'ALL', restricted: false
   });
   ~~~
   Log in and open a release. The Branch column and ENG2001 are visible. Choose ENG2001: only REYES is eligible. Change to ENG1001: customer selection clears and Naga customers load. Verify there is no editable branch selector.

Optional transport-error simulation (set before the relevant action):

~~~js
window.__nextFailure = { method: 'createUnitRelease', message: 'Connection lost' };
~~~

Inspect window.__gasCalls to see fake requests. Unexpected callback errors are recorded in window.__gasErrors; unrelated dashboard endpoints are not implemented by this focused mock. Reloading resets fake sales and units. Generated preview.html is gitignored and all tests/docs are excluded from Apps Script.
