// Evidence for the SECOND defect: .overlay / .sb-complete-overlay centre a child that can be
// taller than the viewport, with no scroll container. Measures the child's rect against the
// viewport and then tries a real touch drag inside the overlay.
import { chromium } from "playwright";

const PREVIEW = "http://localhost:4173";
const DEV = "http://localhost:5173";

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

const VPS = [
  { w: 740, h: 360, label: "740x360 landscape" },
  { w: 360, h: 480, label: "360x480" },
  { w: 360, h: 640, label: "360x640" },
  { w: 1280, h: 800, label: "1280x800" },
];

const CASES = [
  {
    name: "pause .overlay > .dialog",
    base: PREVIEW,
    overlay: ".sb-pause-root .overlay",
    child: ".sb-pause-root .dialog",
    async open(p) {
      await p.goto(PREVIEW + "/play/builtin-01");
      await p.waitForSelector(".play-ready-actions .btn");
      await p.locator(".play-ready-actions .btn").tap();
      await p.waitForSelector("canvas.play-canvas");
      await p.waitForTimeout(400);
      await p.locator(".play-chrome .btn").tap();
      await p.waitForSelector(".sb-pause-root .dialog");
    },
  },
  {
    name: "completion .sb-complete-overlay > .sb-complete-panel",
    base: DEV,
    overlay: ".sb-complete-overlay",
    child: ".sb-complete-panel",
    async open(p) {
      await p.goto(DEV + "/src/hud/hud-dev.html");
      await p.waitForSelector("#stage .sb-hud");
      await p.evaluate(() => window.__gauge.completeNewBest());
      await p.waitForSelector(".sb-complete-panel");
    },
  },
];

const browser = await chromium.launch();
for (const c of CASES) {
  for (const vp of VPS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    const client = await ctx.newCDPSession(page);
    try {
      await c.open(page);
      await page.waitForTimeout(200);
      const m = await page.evaluate(
        ([os, cs]) => {
          const o = document.querySelector(os);
          const ch = document.querySelector(cs);
          const r = ch.getBoundingClientRect();
          const cs2 = getComputedStyle(o);
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            h: Math.round(r.height),
            overflowY: cs2.overflowY,
            align: cs2.alignItems,
            oScrollH: o.scrollHeight,
            oClientH: o.clientHeight,
            oScrollTop: o.scrollTop,
          };
        },
        [c.overlay, c.child],
      );
      const before = m.oScrollTop;
      await drag(client, Math.round(vp.w / 2), Math.round(vp.h * 0.7), 200);
      await page.waitForTimeout(400);
      const after = await page.evaluate(
        (os) => document.querySelector(os).scrollTop,
        c.overlay,
      );
      const clippedTop = m.top < -1;
      const clippedBottom = m.bottom > vp.h + 1;
      console.log(
        `${c.name.padEnd(46)} ${vp.label.padEnd(18)} child ${String(m.h).padStart(4)}px  top=${String(m.top).padStart(5)} bottom=${String(m.bottom).padStart(5)}  overlay overflowY=${m.overflowY} align=${m.align} scrollH/clientH=${m.oScrollH}/${m.oClientH}  drag ${before}->${after}  ${clippedTop ? "TOP CLIPPED " : ""}${clippedBottom ? "BOTTOM OFFSCREEN " : ""}${!clippedTop && !clippedBottom ? "fits (slack " + Math.min(m.top, vp.h - m.bottom) + "px)" : after > before ? "but scrolls" : "AND CANNOT SCROLL"}`,
      );
    } catch (e) {
      console.log(c.name, vp.label, "ERR", String(e).split("\n")[0]);
    }
    await ctx.close();
  }
}
await browser.close();
