# Unit Release implementation and whole-branch review

Date: 2026-10-02
Status: Implemented locally; automated verification passed. Not deployed or pushed.

## Scope reviewed

Fresh final review of the full current branch relative to initial project commit 69faa14, including the existing branding change, approved design/plan, all modified server/UI files and all new test files. Implementation began at bf54cb1. The final pass covered data writes, validation and replay protection, CIR eligibility, schema setup, form lifecycle, callbacks, error recovery, generated preview exclusions and documentation. This was a fresh self-review, not a separate reviewer-agent audit.

The user's approved requirements govern the implementation. Later direction explicitly replaced interactive browser/computer-use checks with local tests, the fake google.script.run harness and a manual rendered-UI checklist. No git push, clasp push, deployment, live schema migration or live editor diagnostic was run.

## Task completion

| Plan task | Local result |
| --- | --- |
| 1. Harness and clasp ignore | Implemented; baseline RR/duplicate-number tests passed before refactoring. Root-source-only clasp status verified. |
| 2. Configuration and rules | Implemented; strict known UnitType values and CIR Applicant normalization covered. |
| 3. Transaction writer split | Implemented; receiving and transfer transitions preserved. Public SALE calls rejected. |
| 4. Schema setup | Implemented; idempotence, missing/empty SALES, blank-only type backfill and header-only CIR additions verified. |
| 5. Inventory and customers | Implemented; approved Maker eligibility, branch match and sold CID exclusion verified. |
| 6. Unit Release server | Implemented; validation, canonical IDs, issued-ID expiry/replay, document rules, one-lock writes and unchanged CIR verified. |
| 7. Sales list and legacy paths | Implemented; new/legacy sales join, branch filtering, blocked legacy calls and corrected Phase 2 diagnostic verified. |
| 8. Browser fake and sales list | Implemented; standalone preview generated and gitignored. |
| 9. Two-step UI | Implemented; read-only details, customer picker, type-dependent documents, review/countdown and success refresh covered by the local UI harness. |
| 10. Screen verification | User-approved substitution: automated UI state tests passed; rendered checks remain on the manual checklist. |
| 11. Diagnostics and docs | Implemented; editor helper produces 14 PASS checks against fake sheets, cleanup preserves CIR, setup docs updated. |

Changes remain uncommitted for inspection. The plan's per-task commits and co-author footer were not executed.

## Findings fixed before final sign-off

- MCID lookup in the sample code was case-sensitive despite the specified rule. Lookup now trims/case-folds and preserves the stored ID; ambiguous duplicate master IDs are rejected.
- The legacy inventory reader treated blank status as Available. The sale path now reads actual master status and rejects a blank status, without changing Receiving Report or transfer readers.
- The sample SALE writer rewrote identity/branch cells. SALE now changes only CurrentStatus and LastUpdated, preserving original cells and formulas.
- An existing empty SALES sheet was not initialized. Empty and missing sheets now receive the canonical header row; incompatible SALES layouts fail before release writes.
- Setup rewrote nonblank UnitType cells while backfilling. It now writes only blank cells on rows with an MCID.
- Late form-ID or customer responses could update a newer form. Form/request generations reject stale callbacks; failed customer loading can be retried.
- Closing a review left a confirmable payload, and a saving review could be replaced. Closing clears pending data; saving prevents closing/replacement and duplicate submissions.
- Added keyboard customer selection, associated labels and a scrollable review card. Browser rendering/focus behavior remains a manual check.
- Editor diagnostics now verify header, exactly one detail, exactly one movement and the complete CIR data snapshot, rather than just the projected customer fields.

## Final evidence

- node --test "tests/*.test.js": **70 passed, 0 failed** (58 server tests, 11 sales UI state tests, 1 inline-script/ID check).
- Initial task suites and regression tests for reproduced defects were observed failing before implementation or correction. Additional regression coverage was added during review; targeted suites passed after each implementation stage.
- node tests/ui/build-preview.js: preview generated successfully.
- clasp show-file-status: root Apps Script sources (including MCSalesRules.js) and appsscript.json tracked; tests/ and docs/ excluded.
- git diff --check: passed.
- MCReceiving.js and MCTransfers.js have no changes relative to the implementation baseline. Regression tests cover RR writes, IB-OUT/IB-IN receipt, cancellation and duplicate-number behavior.
- No unresolved implementation findings remained in the final code review.

## Limits and manual verification

The UI harness executes the real sales script with mock-gas.js and a minimal DOM. It verifies state and rendering strings, not CSS layout, native mouse/keyboard events, focus, scrolling, screenshots or the real Apps Script runtime. Interactive checks were skipped at the user's request.

Use [the manual preview checklist](../../../tests/ui/README.md). It covers restricted and ALL scopes, mobile/desktop layouts, picker mouse/keyboard behavior, document switching, countdown/alert stacking and the success/search flow.

The approved limitations remain: browser-supplied scope/CreatedBy is not session-verified; Sheets writes are not transactional and partial failures need reconciliation; CacheService can expire forms early. No live spreadsheet data was touched. Before any later deployment, follow [the setup guide](../../../BACKEND_GUIDE.md).

## Continuation check

The follow-up review found that ArrowUp initially selected the wrong customer option and keyboard selection lacked a visible highlight. A regression test reproduced the incorrect selection; navigation and highlighting were fixed. The complete suite passed with 70 tests, the fake preview was rebuilt, and git diff --check passed. No server or receiving/transfer behavior changed in this continuation. Browser-native rendering and focus remain covered by the manual checklist.
