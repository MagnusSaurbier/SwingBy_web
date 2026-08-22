import { chromium } from "playwright";

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

const b = await chromium.launch();
for (const vp of [
  { w: 360, h: 640 },
  { w: 360, h: 480 },
  { w: 740, h: 360 },
  { w: 1280, h: 800 },
]) {
  const ctx = await b.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: true,
    isMobile: true,
  });
  const p = await ctx.newPage();
  const client = await ctx.newCDPSession(p);
  await p.goto("http://localhost:4173/editor");
  await p.waitForSelector(".editor-panel");
  await p.waitForTimeout(300);

  const controls = await p.evaluate(() => {
    const el = document.querySelector(".editor-panel");
    return Array.from(el.querySelectorAll("button,input,select,a")).map(
      (e) => e.tagName + "." + e.className,
    );
  });

  // scroll the PAGE to the bottom by dragging on the toolbar (not the canvas)
  for (let i = 0; i < 8; i++) await drag(client, Math.round(vp.w / 2), 25, 200);
  await p.waitForTimeout(400);
  // then scroll the panel's own overflow to its end
  const box = await p.locator(".editor-panel").boundingBox();
  if (box) {
    const visTop = Math.max(box.y, 0);
    const visBot = Math.min(box.y + box.height, vp.h);
    for (let i = 0; i < 6; i++)
      await drag(
        client,
        Math.round(box.x + box.width / 2),
        Math.round(visTop + (visBot - visTop) * 0.5),
        Math.round((visBot - visTop) * 0.6),
      );
    await p.waitForTimeout(300);
  }

  const loc = p.locator(".editor-panel button, .editor-panel input").last();
  const n = await loc.count();
  let res = "no controls";
  if (n) {
    const bb = await loc.boundingBox();
    const inView = bb && bb.y >= -1 && bb.y + bb.height <= vp.h + 1;
    res = `last control ${(await loc.evaluate((e) => e.tagName + "." + e.className)).slice(0, 40)} y=${bb ? Math.round(bb.y) : "?"} inView=${inView}`;
    if (inView) {
      try {
        await loc.tap({ timeout: 3000 });
        res += " tapped";
      } catch {
        res += " UNTAPPABLE";
      }
    }
  }
  console.log(
    `${vp.w}x${vp.h}: ${controls.length} controls in .editor-panel | ${res}`,
  );
  await ctx.close();
}
await b.close();
