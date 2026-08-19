import { chromium } from "playwright";
const PREVIEW = "http://localhost:4173";
const DEV = "http://localhost:5173";

async function drag(client, x, y, dy, steps = 15) {
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

console.log("=== Editor screen: is the side panel reachable, and does it scroll? ===");
for (const vp of [
  { w: 360, h: 640 },
  { w: 360, h: 480 },
  { w: 740, h: 360 },
  { w: 1280, h: 800 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.goto(PREVIEW + "/editor");
  await page.waitForSelector(".editor-panel");
  await page.waitForTimeout(350);

  const m = await page.evaluate(() => {
    const p = document.querySelector(".editor-panel");
    const de = document.scrollingElement;
    const r = p.getBoundingClientRect();
    return {
      panelTop: Math.round(r.top),
      panelBottom: Math.round(r.bottom),
      panelScrollH: p.scrollHeight,
      panelClientH: p.clientHeight,
      docScrollH: de.scrollHeight,
      docClientH: de.clientHeight,
      docScrollW: de.scrollWidth,
      docClientW: de.clientWidth,
    };
  });
  const pageOverflows = m.docScrollH > m.docClientH + 1;
  const panelOverflows = m.panelScrollH > m.panelClientH + 1;

  // If the page overflows, scroll it with a real drag from a point NOT on the canvas
  // (the canvas legitimately eats pans). The toolbar is a safe grab point.
  let pageScrolled = 0;
  if (pageOverflows) {
    const b = await page.evaluate(() => document.scrollingElement.scrollTop);
    for (let i = 0; i < 6; i++) await drag(client, Math.round(vp.w / 2), 30, 200);
    await page.waitForTimeout(400);
    pageScrolled =
      (await page.evaluate(() => document.scrollingElement.scrollTop)) - b;
  }

  // Panel internal scroll, dragging from a point genuinely inside its visible area
  let panelScrolled = 0;
  if (panelOverflows) {
    const box = await page.locator(".editor-panel").boundingBox();
    const visTop = Math.max(box.y, 0);
    const visBot = Math.min(box.y + box.height, vp.h);
    const y = Math.round(visTop + (visBot - visTop) * 0.5);
    const x = Math.round(box.x + box.width / 2);
    const b = await page.evaluate(
      () => document.querySelector(".editor-panel").scrollTop,
    );
    await drag(client, x, y, Math.round((visBot - visTop) * 0.6));
    await page.waitForTimeout(400);
    panelScrolled =
      (await page.evaluate(
        () => document.querySelector(".editor-panel").scrollTop,
      )) - b;
  }

  console.log(
    `${vp.w}x${vp.h}: panel rect top=${m.panelTop} bottom=${m.panelBottom} | panel ${m.panelScrollH}/${m.panelClientH} ${panelOverflows ? `overflows -> touch-scrolled ${panelScrolled}px` : "fits"} | page ${m.docScrollH}/${m.docClientH} ${pageOverflows ? `overflows -> touch-scrolled ${pageScrolled}px` : "fits"} | hOverflow=${m.docScrollW > m.docClientW + 1}`,
  );
  await ctx.close();
}

console.log(
  "\n=== Completion panel with the HARNESS's own fixed #controls bar hidden ===",
);
for (const vp of [
  { w: 360, h: 640 },
  { w: 360, h: 480 },
  { w: 740, h: 360 },
  { w: 1280, h: 800 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.goto(DEV + "/src/hud/hud-dev.html");
  await page.waitForSelector("#stage .sb-hud");
  // #controls is dev-harness chrome (position:fixed; bottom:0; z-index:50) and is NOT part of the
  // shipped app — it is what was intercepting taps, not anything in the panel under test.
  await page.addStyleTag({ content: "#controls{display:none !important}" });
  await page.evaluate(() => window.__gauge.completeNewBest());
  await page.waitForSelector(".sb-complete-panel");
  await page.waitForTimeout(300);

  const g = () =>
    page.evaluate(() => {
      const o = document.querySelector(".sb-complete-overlay");
      const p = document.querySelector(".sb-complete-panel");
      const r = p.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        scrollTop: o.scrollTop,
        scrollH: o.scrollHeight,
        clientH: o.clientHeight,
      };
    });
  const g0 = await g();
  const overflows = g0.scrollH > g0.clientH + 1;
  if (overflows)
    for (let i = 0; i < 6; i++)
      await drag(client, Math.round(vp.w / 2), Math.round(vp.h * 0.6), 200);
  await page.waitForTimeout(400);
  const g1 = await g();

  const loc = page.locator(".sb-complete-actions .btn").last();
  const box = await loc.boundingBox();
  const inView = box.y >= -1 && box.y + box.height <= vp.h + 1;
  let tap = "not attempted";
  if (inView) {
    try {
      await loc.tap({ timeout: 3000 });
      tap = "tapped";
    } catch (e) {
      tap = "UNTAPPABLE";
    }
  }
  console.log(
    `${vp.w}x${vp.h}: panel top=${g0.top} ${overflows ? `overflows (${g0.scrollH}/${g0.clientH}) -> touch-scrolled ${g1.scrollTop - g0.scrollTop}px` : "fits"} | topReachable=${g0.top >= -1} | bottom btn y=${Math.round(box.y)} inView=${inView} ${tap}`,
  );
  await ctx.close();
}
await browser.close();
