// Real-browser verification for feat/edit-current-level, parts 1 and 2.
// Deliberately NOT committed to the repo: playwright is not a repo dependency (it is installed
// globally at /opt/node22/lib/node_modules) and adding one is T-14 LAUNCHPAD's call, not this
// feature's. Same pattern notes/T-04-AURORA and notes/T-08-BRIDGE record for their own passes.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
// Read the level data directly rather than importing level.ts — the core package's own `.js`
// specifiers do not resolve under node's type-stripping loader, and all this needs is the data.
const BUILTIN_LEVELS = JSON.parse(
  readFileSync("/root/work/swingby/packages/core/src/levels.json", "utf8"),
);

const BASE = process.env.SB_BASE ?? "http://localhost:5173";
const OUT = "/root/work/verify/shots";
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

async function panelText() {
  await page.waitForSelector(".editor-screen", { timeout: 5000 }).catch(() => null);
  return (await page.locator(".editor-screen").innerText().catch(() => "")) || "";
}
async function nameField() {
  const inputs = page.locator(".editor-screen input[type='text']");
  const n = await inputs.count();
  return n > 0 ? await inputs.first().inputValue() : null;
}

// --- 1. seeded editor: a built-in level -------------------------------------------------------
const lvl7 = BUILTIN_LEVELS[7];
await page.goto(`${BASE}/editor/builtin-07`, { waitUntil: "networkidle" });
const t1 = await panelText();
const n1 = await nameField();
await page.screenshot({ path: `${OUT}/1-seeded-builtin-07.png` });
check("/editor/builtin-07 mounts an editor", t1.length > 0 && (await page.locator("canvas.editor-canvas").count()) === 1);
check("  ...seeded with that level's name", n1 === lvl7.name, `panel name = ${JSON.stringify(n1)}, level.name = ${JSON.stringify(lvl7.name)}`);
check("  ...seeded with that level's object count", t1.includes(`${lvl7.objects.length} object`), `expected "${lvl7.objects.length} objects" in panel; panel says: ${JSON.stringify(t1.match(/\d+ objects?/)?.[0] ?? null)}`);

// --- 2. bare /editor is unchanged -------------------------------------------------------------
await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
const t2 = await panelText();
const n2 = await nameField();
await page.screenshot({ path: `${OUT}/2-blank-editor.png` });
check("/editor still opens a blank stage", t2.includes("0 objects"), `panel says: ${JSON.stringify(t2.match(/\d+ objects?/)?.[0] ?? null)}`);
check("  ...with the pre-existing default name", n2 === "Custom Stage", `panel name = ${JSON.stringify(n2)}`);

// --- 3. an unresolvable id REFUSES to mount an editor -----------------------------------------
await page.goto(`${BASE}/editor/does-not-exist`, { waitUntil: "networkidle" });
const canvases = await page.locator("canvas.editor-canvas").count();
const body3 = await page.locator("main").innerText();
await page.screenshot({ path: `${OUT}/3-not-found.png` });
check("/editor/<nonsense> mounts NO editor", canvases === 0, `editor canvases found: ${canvases}`);
check("  ...and renders the not-found panel naming the id", body3.includes("Level not found") && body3.includes("does-not-exist"));

// --- 4. a deeper path falls through to notFound ------------------------------------------------
await page.goto(`${BASE}/editor/builtin-07/extra`, { waitUntil: "networkidle" });
const body4 = await page.locator("main").innerText();
check("/editor/a/b falls through to the notFound screen", (await page.locator("canvas.editor-canvas").count()) === 0, `body: ${JSON.stringify(body4.slice(0, 60))}`);

// --- 5. existing routes undisturbed -----------------------------------------------------------
for (const [path, needle] of [["/", "SwingBy"], ["/levels", BUILTIN_LEVELS[0].name], ["/settings", "Settings"], ["/play/builtin-07", "Start Flight"]]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const txt = await page.locator("main").innerText();
  check(`${path} still renders`, txt.includes(needle), `looked for ${JSON.stringify(needle)}`);
}

// --- 6. the seeded editor round-trips through a real save --------------------------------------
await page.goto(`${BASE}/editor/builtin-07`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByRole("button", { name: "Save", exact: true }).last().click();
await page.waitForURL("**/levels", { timeout: 5000 }).catch(() => null);
const levelsTxt = await page.locator("main").innerText();
await page.screenshot({ path: `${OUT}/4-after-save.png` });
check("saving a seeded built-in navigates to /levels", page.url().endsWith("/levels"), `url = ${page.url()}`);
const customs = await page.evaluate(() => JSON.parse(localStorage.getItem("swingby:custom_levels") ?? "null"));
check("  ...and appends a custom level carrying the built-in's name", JSON.stringify(customs ?? "").includes(lvl7.name), `stored: ${JSON.stringify(customs)?.slice(0, 200)}`);

// --- 7. the fork is playable and its own editor URL round-trips --------------------------------
const forkLink = page.locator(`a[href^="/play/"]`);
check("the saved fork appears in Level Select", levelsTxt.includes(lvl7.name), `looked for ${JSON.stringify(lvl7.name)} on /levels`);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
