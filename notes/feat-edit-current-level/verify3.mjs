// Closes two gaps in the earlier passes:
//   (a) the CUSTOM-level path through the editor route and the hotkey — earlier runs only ever
//       used built-in ids, though resolveLevel handles both and is unit-tested both ways;
//   (b) running against the PRODUCTION build (minified) rather than the vite dev server. main
//       deploys straight to production with no staging gate, so "it works unbundled" is not the
//       claim that matters.
import { chromium } from "playwright";
const BASE = process.env.SB_BASE ?? "http://localhost:5173";
const results = [];
const check = (n, p, d) => { results.push({ n, p }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
const OPT_CMD_E = "Alt+Meta+KeyE";

console.log(`--- against ${BASE} ---`);

// Author a custom level by forking a built-in, so we have a real content-derived custom id.
await page.goto(`${BASE}/editor/builtin-02`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByRole("button", { name: "Save", exact: true }).last().click();
await page.waitForURL("**/levels", { timeout: 8000 });

// Play it: the Custom tab's card links to /play/<customLevelId>.
const customHref = await page.evaluate(() => {
  const raw = localStorage.getItem("swingby:custom_levels");
  if (!raw) return null;
  const n = JSON.parse(raw).levels.length;
  const links = Array.from(document.querySelectorAll('a[href^="/play/"]')).map((a) => a.getAttribute("href"));
  // custom ids are slug-hash, never "builtin-NN"
  return { n, custom: links.filter((h) => !/\/play\/builtin-\d\d$/.test(h)) };
});
check("a custom level exists and has a non-builtin play link", !!customHref && customHref.custom.length >= 1, JSON.stringify(customHref));
const playPath = customHref.custom[0];
const customId = playPath.replace("/play/", "");

await page.goto(`${BASE}${playPath}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start Flight" }).click();
await page.waitForTimeout(400);
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(500);
check("hotkey while playing a CUSTOM level opens its own editor URL",
  decodeURIComponent(page.url()).endsWith(`/editor/${decodeURIComponent(customId)}`), `url = ${page.url()}`);
const nm = await page.locator(".editor-screen input[type='text']").first().inputValue();
check("  ...seeded with that custom level", nm.length > 0, `panel name = ${JSON.stringify(nm)}`);

// Cold deep-link straight to the custom editor URL (no prior navigation in this page load).
const page2 = await ctx.newPage();
await page2.goto(`${BASE}/editor/${customId}`, { waitUntil: "networkidle" });
const nm2 = await page2.locator(".editor-screen input[type='text']").first().inputValue().catch(() => null);
check("cold deep-link to /editor/<customLevelId> seeds the editor", nm2 === nm, `panel name = ${JSON.stringify(nm2)}`);
await page2.close();

// And the pause-menu button on a custom level.
await page.goto(`${BASE}${playPath}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start Flight" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Menu" }).click();
await page.waitForTimeout(250);
const eb = page.getByRole("button", { name: "Edit this level" });
check("pause menu offers 'Edit this level' on a custom level too", (await eb.count()) === 1);
await eb.click();
await page.waitForTimeout(400);
check("  ...and it navigates to the custom editor URL",
  decodeURIComponent(page.url()).endsWith(`/editor/${decodeURIComponent(customId)}`), `url = ${page.url()}`);

// Core refusals again, in this environment.
await page.goto(`${BASE}/play/builtin-07`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start Flight" }).click();
await page.waitForTimeout(400);
await page.keyboard.press("Control+Alt+Meta+KeyE");
await page.waitForTimeout(300);
check("REFUSES an extra modifier here too", page.url().includes("/play/"), `url = ${page.url()}`);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.keyboard.press(OPT_CMD_E);
await page.waitForTimeout(300);
check("listener teardown holds here too", !page.url().includes("/editor"), `url = ${page.url()}`);
await page.goto(`${BASE}/editor/does-not-exist`, { waitUntil: "networkidle" });
check("unresolvable id still mounts no editor", (await page.locator("canvas.editor-canvas").count()) === 0);

await browser.close();
const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
