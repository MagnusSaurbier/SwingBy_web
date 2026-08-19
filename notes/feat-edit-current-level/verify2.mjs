// feat/edit-current-level — browser verification, parts 3 and 4 (hotkey + pause-menu entry).
// Run out-of-tree; playwright is the global install, not a repo dependency.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BUILTIN_LEVELS = JSON.parse(
  readFileSync("/root/work/swingby/packages/core/src/levels.json", "utf8"),
);
const BASE = "http://localhost:5173";
const OUT = "/root/work/verify/shots";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

const OPT_CMD_E = "Alt+Meta+KeyE";
const lvl7 = BUILTIN_LEVELS[7];

async function startFlight() {
  await page.goto(`${BASE}/play/builtin-07`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start Flight" }).click();
  await page.waitForTimeout(400);
}

// --- 1. hotkey during flight -------------------------------------------------------------------
await startFlight();
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(400);
check("opt+cmd+E during flight opens the editor for that level", page.url().endsWith("/editor/builtin-07"), `url = ${page.url()}`);
const n1 = await page.locator(".editor-screen input[type='text']").first().inputValue();
check("  ...seeded with the played level", n1 === lvl7.name, `panel name = ${JSON.stringify(n1)}`);
await page.screenshot({ path: `${OUT}/5-hotkey-to-editor.png` });

// --- 2. hotkey on the pre-flight Ready panel ---------------------------------------------------
await page.goto(`${BASE}/play/builtin-03`, { waitUntil: "networkidle" });
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(300);
check("opt+cmd+E on the Ready panel also works", page.url().endsWith("/editor/builtin-03"), `url = ${page.url()}`);

// --- 3. REFUSALS ---------------------------------------------------------------------------------
await startFlight();
for (const [combo, why] of [
  ["Control+Alt+Meta+KeyE", "an extra modifier held"],
  ["Alt+KeyE", "a missing modifier"],
  ["KeyE", "no modifiers at all"],
  ["Alt+Meta+KeyD", "the wrong key (the original ⌥⌘D request)"],
]) {
  await page.keyboard.press(combo);
  await page.waitForTimeout(200);
  check(`REFUSES ${why} (${combo})`, page.url().includes("/play/"), `url = ${page.url()}`);
}

// --- 4. the teardown check — the one the orchestrator wants run for real ------------------------
await startFlight();
await page.getByRole("button", { name: "Menu" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Main menu" }).click();
await page.waitForTimeout(400);
check("navigated away from Play to the main menu", page.url().endsWith("/") || !page.url().includes("/play/"), `url = ${page.url()}`);
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(400);
check("LISTENER TEARDOWN: the hotkey is inert after leaving Play", !page.url().includes("/editor"), `url after pressing the hotkey on the menu = ${page.url()}`);

// also from Level Select and Settings, i.e. two more screens downstream
for (const path of ["/levels", "/settings"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.keyboard.press(OPT_CMD_E);
  await page.waitForTimeout(250);
  check(`  ...and on ${path}`, page.url().endsWith(path), `url = ${page.url()}`);
}

// --- 5. does not steal keys from a text field ---------------------------------------------------
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.locator("#settings-username").click();
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(250);
check("typing in the username field never triggers a navigation", page.url().endsWith("/settings"), `url = ${page.url()}`);

// --- 6. the pause-menu entry point ---------------------------------------------------------------
await startFlight();
await page.getByRole("button", { name: "Menu" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/6-pause-menu.png` });
const editBtn = page.getByRole("button", { name: "Edit this level" });
check("the pause menu shows 'Edit this level'", (await editBtn.count()) === 1);
await editBtn.click();
await page.waitForTimeout(400);
check("  ...and it performs the identical navigation", page.url().endsWith("/editor/builtin-07"), `url = ${page.url()}`);

// --- 7. Settings rebind row ------------------------------------------------------------------------
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const row = page.locator(".control-row", { hasText: "Open level in editor" });
check("Settings shows the editor hotkey row", (await row.count()) === 1);
const label0 = await row.locator("button").innerText();
check("  ...labelled for this platform", label0 === "Alt+Meta+E" || label0 === "⌥⌘E", `label = ${JSON.stringify(label0)}`);

// rebind to Ctrl+Shift+KeyB
await row.locator("button").click();
await page.keyboard.press("Control+Shift+KeyB");
await page.waitForTimeout(250);
const label1 = await row.locator("button").innerText();
check("  ...rebinds to a new chord", label1 === "Ctrl+Shift+B" || label1 === "⌃⇧B", `label = ${JSON.stringify(label1)}`);
await page.screenshot({ path: `${OUT}/7-settings-rebind.png` });

// survives a reload
await page.reload({ waitUntil: "networkidle" });
const label2 = await page.locator(".control-row", { hasText: "Open level in editor" }).locator("button").innerText();
check("  ...and the rebind survives a reload", label2 === label1, `label after reload = ${JSON.stringify(label2)}`);

// the NEW binding works and the OLD one does not
await startFlight();
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(300);
check("  ...the OLD default no longer fires", page.url().includes("/play/"), `url = ${page.url()}`);
await page.keyboard.press("Control+Shift+KeyB");
await page.waitForTimeout(400);
check("  ...the NEW binding fires", page.url().endsWith("/editor/builtin-07"), `url = ${page.url()}`);

// --- 8. the 11 existing rebindings still work (regression on the shared state machine) -----------
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const boostRow = page.locator(".control-row", { hasText: "Boost engine" });
check("existing rebind: Boost still shows its default", (await boostRow.locator("button").innerText()) === "Space");
await boostRow.locator("button").click();
await page.keyboard.press("KeyQ");
await page.waitForTimeout(200);
check("  ...rebinds to Q", (await boostRow.locator("button").innerText()) === "Q");
// Escape still cancels an existing-binding rebind
const brakeRow = page.locator(".control-row", { hasText: "Brake" });
const brakeBefore = await brakeRow.locator("button").innerText();
await brakeRow.locator("button").click();
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("  ...Escape still cancels", (await brakeRow.locator("button").innerText()) === brakeBefore);

// reset restores BOTH the 11 and the hotkey
await page.getByRole("button", { name: "Reset all controls to default" }).click();
await page.waitForTimeout(250);
check("  ...Reset restores Boost to Space", (await boostRow.locator("button").innerText()) === "Space");
const hotkeyAfterReset = await page.locator(".control-row", { hasText: "Open level in editor" }).locator("button").innerText();
check("  ...and Reset restores the editor hotkey too", hotkeyAfterReset === label0, `label = ${JSON.stringify(hotkeyAfterReset)}`);

// --- 9. Escape cancels a CHORD rebind, leaving the binding untouched ------------------------------
const hkRow = page.locator(".control-row", { hasText: "Open level in editor" });
await hkRow.locator("button").click();
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape cancels a chord rebind without changing it", (await hkRow.locator("button").innerText()) === label0);

// --- 10. shared level: no button, hotkey inert ----------------------------------------------------
await page.goto(`${BASE}/l/nonexistent`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(300);
check("a shared level's route keeps the hotkey inert", !page.url().includes("/editor"), `url = ${page.url()}`);

// --- 11. mobile: the pause menu at 390x844, portrait and landscape --------------------------------
for (const [w, h, name] of [[390, 844, "portrait"], [844, 390, "landscape"]]) {
  const mctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/play/builtin-07`, { waitUntil: "networkidle" });
  await mp.getByRole("button", { name: "Start Flight" }).tap();
  await mp.waitForTimeout(400);
  await mp.getByRole("button", { name: "Menu" }).tap();
  await mp.waitForTimeout(300);
  const btn = mp.getByRole("button", { name: "Edit this level" });
  const visible = await btn.isVisible().catch(() => false);
  const box = await btn.boundingBox().catch(() => null);
  const inViewport = box ? box.y >= 0 && box.y + box.height <= h : false;
  await mp.screenshot({ path: `${OUT}/8-pause-mobile-${name}.png` });
  check(`mobile ${name} ${w}x${h}: 'Edit this level' is visible`, visible);
  check(`  ...and fully within the viewport (no panel-height regression)`, inViewport, `box = ${JSON.stringify(box)}, viewport h = ${h}`);
  if (visible) {
    await btn.tap();
    await mp.waitForTimeout(400);
    check(`  ...and opens the editor`, mp.url().endsWith("/editor/builtin-07"), `url = ${mp.url()}`);
  }
  await mctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log("FAILED:\n" + failed.map((f) => "  - " + f.name).join("\n"));
process.exit(failed.length ? 1 : 0);
