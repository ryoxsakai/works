# Five whole-app checks — cloud checkpoint

These correspond to the five global checkboxes in `full-parity-plan.md`. None is declared universally certified before exact-head browser CI.

| Check | Cloud evidence prepared/performed | Remaining |
|---|---|---|
| All nine modules, original/deep URLs, current selection, Back/Forward/reload | Source route inventory; new cross-module browser suite visits nine modules and mapping history, direct reload and history traversal; existing native module suites retained | Run20 browser suites in CI; authenticated production navigation |
| Authentication lifecycle/scopes/private cleanup/single initialization | Existing auth unit coverage passes within118 app tests; browser fixture checks one initialization; mapping route browser-token, Origin and method tests pass | Full browser regressions; real login/callback/logout/cross-tab production QA |
| Theme/assets/licenses/keyboard/dialog/resize/safe-area/print | Existing assets/dependencies preserved; cross-module suite checks light/dark,320/390/768/1440 widths, drawer Escape/focus and print suppression; native mapping suite extended | Browser execution; actual iPhone keyboard/safe-area and physical output; supplied-image pixels |
| Loading/empty/failure/retry/mount/unmount/no duplicate writes | Unit tests pass for frozen mapping queues, stale responses and stopped writes; browser suite adds module failure/recovery and zero-write assertions | Browser execution, production read-only observation |
| Original controls remain discoverable, no extra sharing/permissions | Existing module inventories retained; mapping adds explicit administration without machine grants or data copying; synthetic atomicity and original API regressions pass | Browser discoverability certification; source-to-user screenshot comparison |

Local results:118 app units,7 mapping Worker tests,1 exact migration test and22 existing linked/planning Worker regressions pass. Browser code is prepared, not executed locally because Chromium is unavailable. Do not interpret prepared assertions as observed passes. No real tasks/files/workflows/student records were mutated for QA.
