# Project restructure review — 2026-10-02

Reviewed the complete local restructure against baseline commit `0f1111b` and the approved design. No remaining blocking findings were identified. Changes remain local and uncommitted; no push, deployment, or live spreadsheet operations were performed.

## Scope and preservation

- Moved 20 server files into backend/core, backend/applications, and backend/motorcycle, and three unchanged print templates into frontend/print.
- Split the original Index into the frontend shell and 17 CSS, page, and script partials. The original was removed only after the migration assertion passed.
- Compared LF-normalized assembled output with an independently transformed original containing exactly the three approved block moves. Exact equality passed. All 21 script blocks (17 inline and four external) retain their content and order; all 376 ID occurrences are retained.
- Baseline page SHA-256 (LF normalized): `4299501ec94e4da8954747cbd3242e36bb8fcf6634cd1971396becc8843a7cac`.
- Assembled page SHA-256 (LF normalized): `7ca8c8d6013294df94f516dbb74f93f16b0444f1dcacf5ba5874d187c73fac81`.
- Compared every moved backend file and print template with the originals. Only approved filename comments, doGet/include, and print-loader paths differ. Receiving Report, transfers, and Unit Release rules are preserved.
- The two preexisting duplicate markup IDs, pageHeaderTitle and pageHeaderSubtitle, remain explicitly allowlisted; this restructure does not change their behavior.

## Verification

- `node --test "tests/*.test.js"`: **79 passed, zero failed** (70 existing and nine added layout checks).
- Coverage includes partial completeness, scriptlet absence, existing duplicate-ID allowance, backend discovery, entrypoint/include/print resolution, and all literal HtmlService file references.
- The existing fake google.script.run tests now execute the assembled frontend. The standalone preview was rebuilt with `node tests/ui/build-preview.js`.
- `clasp show-file-status`: exactly 42 intended files (manifest, 20 backend JS, 21 frontend HTML); tests and docs excluded.
- Staged and unstaged `git diff --check` passed.
- README and BACKEND_GUIDE local Markdown links resolve. Doubled directory prefixes discovered during review were corrected.
- Historical plans, specs, and reviews were not edited.

## Verification limits and manual checks

At the user's direction, interactive computer/browser checks were skipped. The local HtmlService fake checks file resolution and API chaining; it does not implement Google's template engine. Automated DOM checks do not validate browser layout, focus, or native event ordering. No live Apps Script rendering was tested.

Open the generated tests/ui/preview.html in a browser with CDN access and a fresh login state. Check login, the centered navbar and three menus, dashboard rendering, Applications > Customer Applications, and Unit Release step 1. Check desktop and narrow widths, the motorcycle profile, and the sale review modal after their approved markup moves. The focused fake backend does not implement every unrelated dashboard endpoint.

See [the complete fake-preview checklist](../../../tests/ui/README.md) for Unit Release selection, keyboard interaction, review countdown, retry, and branch-scoping checks.
