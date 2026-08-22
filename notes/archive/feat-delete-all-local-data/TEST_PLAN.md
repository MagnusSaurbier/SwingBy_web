# Test plan — feat/delete-all-local-data (PR #5)

Environment: vite dev server at http://localhost:5173 (`npm run dev -w @swingby/web`).
Driver: Playwright 1.62 (npx cache module `/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright`)
launched **headed on :0** with `executablePath=/opt/.devin/playwright_browsers/chromium-1097/chrome-linux/chrome`
(no `playwright install`; `/opt/pw-browsers` does not exist on this box, `PLAYWRIGHT_BROWSERS_PATH` is empty,
and the version-matched headless shell is absent, so an explicit executablePath is required).

Code grounding:
- `packages/web/src/ui/screens/settings.ts:237-281` — `.btn-danger` "Delete all local data" inside
  `div.panel.controls-section` with `h2` "Local data", appended after `resetBtn` (line 302).
  Dialog copy incl. "Scores you have already submitted to the leaderboard and levels you have
  already shared stay online." (line 256), confirm label "Delete everything", cancel "Cancel".
- `packages/web/src/ui/dialog.ts:60-101` — `.overlay > .panel.dialog[role=dialog]`, Escape → cancel,
  `trapFocus(dialog)` after append.
- `packages/web/src/ui/localData.ts:100-154` — prefix sweep of `swingby:` over localStorage+sessionStorage;
  `requestDeleteAllLocalData` wipes and `window.location.assign("/")` only after `confirm` resolves true.
- Router is History-API (`packages/web/src/ui/router.ts:1-6`) so `/settings` is a real URL.
- Storage keys: `swingby:settings|bests|custom_levels` (`storage/index.ts:56-58`), `swingby:score_queue`
  (`net/queue.ts:36`).

## T1 — Settings screen shows the new Local data section (desktop 1280x800)
Steps: goto `/settings`, screenshot the region containing both "Reset all controls to default" and
the new section.
Pass: screenshot visibly shows heading "Local data", the description paragraph, and a red
"Delete all local data" button *below* the existing reset button.

## T2 — Seed real data
Type "Magnus" into Player name (blur to commit), click one display toggle, then
`localStorage.setItem` for `swingby:bests`, `swingby:custom_levels`, `swingby:score_queue`,
plus foreign keys `theme=dark` and `sessionStorage swingby:tmp` (to prove the sessionStorage sweep).
Record `Object.keys(localStorage)` + full values snapshot before and after.
Pass: snapshot contains `swingby:settings` with `"username":"Magnus"` and the flipped toggle,
plus the three injected keys and `theme`.

## T3 — Dialog appears with the right copy
Click "Delete all local data".
Pass: screenshot shows a modal titled "Delete all local data?" whose body text visibly contains
"stay online" sentence about already-submitted leaderboard scores and shared levels; buttons
"Delete everything" and "Cancel".

## T4 — Refusal case (the important one)
4a: with the dialog open, click "Cancel".
4b: reopen, press Escape.
After each: read full localStorage snapshot (keys AND values) + `location.pathname`.
Pass: snapshot **byte-identical** to the T2 post-seed snapshot both times; pathname still
`/settings`; overlay removed from DOM; status text "Nothing was deleted." visible.
Fail signal: any key missing/changed, or navigation to `/`.

## T5 — Focus trap sanity
Reopen the dialog. Assert `document.activeElement` is inside `.panel.dialog` on open, then press
Tab 3 times recording activeElement text each time.
Pass: initial focus inside dialog; the sequence cycles only between "Delete everything" and
"Cancel" (never the page behind).

## T6 — Confirm path
With dialog open, click "Delete everything".
Pass: after navigation, `location.pathname === "/"`, screenshot shows the main menu;
`Object.keys(localStorage)` contains **no** `swingby:` key, `theme` still `"dark"`,
sessionStorage `swingby:tmp` gone. Then navigate to `/settings` and screenshot: Player name field
empty/placeholder or "Guest", toggles back to defaults (compare with the T1 default screenshot).
Fail signal: any surviving `swingby:` key, missing `theme`, or still on `/settings`.

## T7 — Mobile, real taps (portrait 390x844 and landscape 844x390)
New context per orientation with `hasTouch: true, isMobile: true, deviceScaleFactor: 3`.
Seed the same keys, then in EACH orientation:
- `locator.tap()` the "Delete all local data" button → screenshot of dialog.
- Check dialog bounding box fits inside the viewport (top >= 0, bottom <= viewport height) and both
  buttons have non-zero box and are within viewport → report numbers.
- `locator.tap()` "Cancel" → assert dialog gone and storage unchanged (proves the tap registered, not
  a no-op).
- Reopen by tap, `locator.tap()` "Delete everything" → assert `/` and all `swingby:` keys gone.
Pass: taps trigger the handlers in both orientations (dialog opens/closes, wipe happens), dialog
not clipped in landscape.

Artifacts: screenshots under /home/ubuntu/screenshots/, one screen recording of the headed run.
