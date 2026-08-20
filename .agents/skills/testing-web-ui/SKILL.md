---
name: testing-web-ui
description: How to run and drive the SwingBy web app (packages/web) for end-to-end UI verification, including headed Playwright on this box, mobile touch emulation, and localStorage inspection.
---

# Testing the SwingBy web UI

## Run the app

```bash
npm run dev -w @swingby/web       # vite dev server on http://localhost:5173
```

Routing is the History API (`packages/web/src/ui/router.ts`), no hash and no base path, so
`http://localhost:5173/settings`, `/credits`, `/levels` etc. can be opened directly and vite's SPA
fallback serves them.

## Driving a real browser (Playwright)

`AGENTS.md` says browsers live at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and to never run
`playwright install`. On the Devin box that path may not exist and `PLAYWRIGHT_BROWSERS_PATH` may be
empty. Working setup found there:

- playwright module (v1.62): `/home/ubuntu/.npm/_npx/<hash>/node_modules/playwright/index.mjs`
  (find with `find /home/ubuntu/.npm/_npx -maxdepth 5 -type d -name playwright`)
- chromium binary: `/opt/.devin/playwright_browsers/chromium-1097/chrome-linux/chrome`
- The version-matched *headless shell* is absent, so `chromium.launch()` fails with
  "Executable doesn't exist at .../chromium_headless_shell-<rev>". Pass an explicit
  `executablePath` (and prefer `headless: false`, which is also what you want for a screen recording).

Persisted browser state does not survive across separate short scripts: contexts created by a
`chromium.connect()` client are closed when that client disconnects. For a multi-step, annotated
session, run ONE long-lived node process that reads step names from stdin (drive it with an
interactive shell + `write_to_process`) so screen annotations can be interleaved with steps.

Maximize the headed window before recording:
`wmctrl -i -r $(xdotool search --name "SwingBy" | head -1) -b add,maximized_vert,maximized_horz`.
Note that creating a context with a fixed `viewport` resizes the OS window, so a mobile context
makes the browser window small on screen; take page-level `page.screenshot()` for clean mobile
evidence and full-screen shots for desktop.

## Touch / mobile

Touch is a first-class requirement in this repo. Use
`browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: <android UA> })`
and interact with `locator.tap()`, not `click()`. Always check landscape (844x390) too, and assert
dialog/button bounding boxes lie inside `page.viewportSize()` to catch clipping.

## Local data / settings state

Persisted keys all live under the `swingby:` namespace: `swingby:settings`, `swingby:bests`,
`swingby:custom_levels` (`packages/web/src/storage/index.ts`) and `swingby:score_queue`
(`packages/web/src/net/queue.ts`). Seeding bests/custom levels/queue via
`page.evaluate(() => localStorage.setItem(...))` is much faster than gameplay. Settings changes
(player name field `#settings-username`, display toggles `#toggle-<key>`, clicked via
`label[for=...]`) are written to `swingby:settings` immediately.

For wipe/reset style features, dump keys AND values before and after
(`localStorage`/`sessionStorage` via `store.key(i)`), and always seed a non-`swingby:` key
(e.g. `theme=dark`) to prove foreign keys are not touched.

## Devin secrets needed

None. The feature set above needs no backend or credentials.
