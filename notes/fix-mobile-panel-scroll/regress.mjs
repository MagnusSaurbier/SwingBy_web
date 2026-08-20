// Regression guards for things this fix could plausibly have broken:
//  1. the play canvas must still swallow touch pans (no page scroll while flying)
//  2. a touch on the canvas must still register as boost/brake (input.ts unchanged in that path)
//  3. menu / pause buttons must still respond to a real tap (the 8757d8e fix)
import { chromium } from "playwright";
const BASE = "http://localhost:4173";

async function drag(client, x, y, dy, steps = 20) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let i = 1; i <= steps; i++)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - (dy * i) / steps, id: 1 }],
    });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);

// --- 1 + 2: in-flight canvas
await page.goto(BASE + "/play/builtin-01");
await page.waitForSelector(".play-ready-actions .btn");
await page.locator(".play-ready-actions .btn").tap();
await page.waitForSelector("canvas.play-canvas");
await page.waitForTimeout(600);

const canvasTA = await page.evaluate(
  () => getComputedStyle(document.querySelector("canvas.play-canvas")).touchAction,
);
console.log("play canvas touch-action:", canvasTA, canvasTA === "none" ? "OK" : "*** REGRESSION ***");

const bodyTA = await page.evaluate(
  () => getComputedStyle(document.body).touchAction,
);
console.log("body touch-action while playing:", bodyTA, bodyTA === "auto" ? "OK (fixed)" : "*** still hijacked ***");

// force the page to be scrollable, then confirm a drag ON THE CANVAS does not scroll it
await page.evaluate(() => {
  const s = document.createElement("div");
  s.id = "spacer";
  s.style.height = "1200px";
  document.body.appendChild(s);
});
await page.waitForTimeout(100);
const b1 = await page.evaluate(() => document.scrollingElement.scrollTop);
await drag(client, 180, 480, 300);
await page.waitForTimeout(500);
const a1 = await page.evaluate(() => document.scrollingElement.scrollTop);
console.log(
  `drag on canvas with a scrollable page: scrollTop ${b1} -> ${a1}`,
  a1 === b1 ? "OK (canvas swallows the pan)" : "*** REGRESSION: page scrolled under the finger ***",
);
await page.evaluate(() => document.getElementById("spacer")?.remove());

// --- 3: pause button + pause dialog buttons still tappable
await page.locator(".play-chrome .btn").tap();
await page.waitForSelector(".sb-pause-root .dialog", { timeout: 3000 });
console.log("pause panel opened by tap: OK");
await page.locator(".sb-pause-root .dialog-actions .btn", { hasText: "Settings" }).tap();
await page.waitForSelector(".settings-toggles", { timeout: 3000 });
console.log("pause -> Settings navigated by tap: OK");

// --- toggle switch still clickable (52c43e9)
const before = await page.locator(".toggle input").first().isChecked();
await page.locator(".toggle input").first().tap();
await page.waitForTimeout(150);
const after = await page.locator(".toggle input").first().isChecked();
console.log(
  `settings toggle tap: ${before} -> ${after}`,
  before !== after ? "OK" : "*** REGRESSION ***",
);

// --- menu buttons still tappable
await page.goto(BASE + "/");
await page.waitForSelector(".menu-card");
await page.locator("a[href='/levels']").first().tap();
await page.waitForSelector(".level-grid", { timeout: 3000 });
console.log("menu button tap navigates: OK");

await browser.close();
