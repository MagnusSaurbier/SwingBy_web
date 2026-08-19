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
const cases = [
  [
    "/levels (no InputSource on body)",
    async (p) => {
      await p.goto(BASE + "/levels");
      await p.waitForSelector(".level-grid");
    },
  ],
  [
    "/settings (standalone)",
    async (p) => {
      await p.goto(BASE + "/settings");
      await p.waitForSelector(".settings-toggles");
    },
  ],
  [
    "/settings via in-game pause->Settings",
    async (p) => {
      await p.goto(BASE + "/play/builtin-01");
      await p.waitForSelector(".play-ready-actions .btn");
      await p.locator(".play-ready-actions .btn").tap();
      await p.waitForSelector("canvas.play-canvas");
      await p.waitForTimeout(400);
      await p.locator(".play-chrome .btn").tap();
      await p.waitForSelector(".sb-pause-root .dialog");
      await p
        .locator(".sb-pause-root .dialog-actions .btn", { hasText: "Settings" })
        .tap();
      await p.waitForSelector(".settings-toggles");
    },
  ],
  [
    "/credits AFTER visiting /play once",
    async (p) => {
      await p.goto(BASE + "/play/builtin-01");
      await p.waitForSelector(".play-ready-actions .btn");
      await p.locator(".play-ready-actions .btn").tap();
      await p.waitForSelector("canvas.play-canvas");
      await p.waitForTimeout(400);
      await p.locator(".play-chrome .btn").tap();
      await p.waitForSelector(".sb-pause-root .dialog");
      await p
        .locator(".sb-pause-root .dialog-actions .btn", { hasText: "Main menu" })
        .tap();
      await p.waitForSelector(".menu-card");
      await p.locator("a[href='/credits']").first().tap();
      await p.waitForSelector(".credits-card");
    },
  ],
];

for (const [name, open] of cases) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 480 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  try {
    await open(page);
    await page.waitForTimeout(200);
    const ta = await page.evaluate(
      () => getComputedStyle(document.body).touchAction,
    );
    const h = await page.evaluate(() => [
      document.scrollingElement.scrollHeight,
      document.scrollingElement.clientHeight,
    ]);
    const before = await page.evaluate(
      () => document.scrollingElement.scrollTop,
    );
    await drag(client, 180, 400, 300);
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      () => document.scrollingElement.scrollTop,
    );
    console.log(
      `${name.padEnd(40)} body.touch-action=${ta.padEnd(5)} scrollH=${h[0]} clientH=${h[1]}  scrollTop ${before} -> ${after}   ${after > before ? "SCROLLS" : "*** DOES NOT SCROLL ***"}`,
    );
  } catch (e) {
    console.log(name, "ERR", String(e).split("\n")[0]);
  }
  await ctx.close();
}
await browser.close();
