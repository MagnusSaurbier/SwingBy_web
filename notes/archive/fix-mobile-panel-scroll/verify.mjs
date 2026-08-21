// Full panel x viewport verification. Every scroll here is a REAL touch drag
// (CDP Input.dispatchTouchEvent), never a programmatic scrollTo, and the bottom-most control is
// required to be inside the viewport BEFORE it is tapped — Playwright's locator.tap() would
// otherwise silently scrollIntoView() and report success on a control a finger could never reach.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const PREVIEW = "http://localhost:4173";
const DEV = "http://localhost:5173";

const VIEWPORTS = [
  { name: "360x640", w: 360, h: 640 },
  { name: "360x480", w: 360, h: 480 },
  { name: "740x360", w: 740, h: 360 },
  { name: "1280x800", w: 1280, h: 800 },
];

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

/** Repeated real touch flicks in one direction until nothing moves any more. */
async function touchScrollToEnd(page, client, vp, dir, sel) {
  const read = () =>
    page.evaluate(
      (s) => {
        const el = s ? document.querySelector(s) : null;
        return (el && el.scrollHeight > el.clientHeight ? el : document.scrollingElement).scrollTop;
      },
      sel,
    );
  let last = await read();
  for (let i = 0; i < 25; i++) {
    const amount = Math.round(vp.h * 0.55) * dir;
    await drag(client, Math.round(vp.w / 2), Math.round(vp.h * 0.62), amount);
    await page.waitForTimeout(220);
    const now = await read();
    if (Math.abs(now - last) < 1) return now;
    last = now;
  }
  return last;
}

const PANELS = [
  {
    name: "Main menu (/)",
    base: PREVIEW,
    scroller: null,
    panel: ".menu-card",
    bottom: ".menu-nav .btn:last-child",
    async open(p) {
      await p.goto(PREVIEW + "/");
      await p.waitForSelector(".menu-card");
    },
  },
  {
    name: "Level select (/levels)",
    base: PREVIEW,
    scroller: null,
    panel: ".screen-shell",
    bottom: ".screen-footer a",
    async open(p) {
      await p.goto(PREVIEW + "/levels");
      await p.waitForSelector(".level-grid");
    },
  },
  {
    name: "Workshop (/workshop)",
    base: PREVIEW,
    scroller: null,
    panel: ".screen-shell",
    bottom: ".screen-footer a",
    async open(p) {
      await p.goto(PREVIEW + "/workshop");
      await p.waitForSelector(".workshop-layout");
    },
  },
  {
    name: "Settings screen (/settings)",
    base: PREVIEW,
    scroller: null,
    panel: ".screen-shell",
    bottom: ".screen-footer a",
    async open(p) {
      await p.goto(PREVIEW + "/settings");
      await p.waitForSelector(".settings-toggles");
    },
  },
  {
    name: "Credits (/credits)",
    base: PREVIEW,
    scroller: null,
    panel: ".credits-card",
    bottom: ".credits-card a, .screen-footer a",
    async open(p) {
      await p.goto(PREVIEW + "/credits");
      await p.waitForSelector(".credits-card");
    },
  },
  {
    name: "Play ready gate",
    base: PREVIEW,
    scroller: null,
    panel: ".play-ready",
    bottom: ".play-ready-actions .btn",
    async open(p) {
      await p.goto(PREVIEW + "/play/builtin-01");
      await p.waitForSelector(".play-ready");
    },
  },
  {
    name: "In-game pause panel",
    base: PREVIEW,
    scroller: ".sb-pause-root .overlay",
    panel: ".sb-pause-root .dialog",
    bottom: ".sb-pause-root .dialog-actions .btn:last-child",
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
    name: "In-game settings tab",
    base: PREVIEW,
    scroller: null,
    panel: ".screen-shell",
    bottom: ".screen-footer a",
    async open(p) {
      await p.goto(PREVIEW + "/play/builtin-01");
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
  },
  {
    name: "Completion panel",
    base: DEV,
    scroller: ".sb-complete-overlay",
    panel: ".sb-complete-panel",
    bottom: ".sb-complete-actions .btn:last-child",
    async open(p) {
      await p.goto(DEV + "/src/hud/hud-dev.html");
      await p.waitForSelector("#stage .sb-hud");
      await p.evaluate(() => window.__gauge.completeNewBest());
      await p.waitForSelector(".sb-complete-panel");
    },
  },
  {
    name: "Editor side panel (/editor)",
    base: PREVIEW,
    scroller: ".editor-panel",
    panel: ".editor-panel",
    bottom: ".editor-panel .control-row:last-of-type .btn",
    async open(p) {
      await p.goto(PREVIEW + "/editor");
      await p.waitForSelector(".editor-panel");
    },
  },
  {
    name: "Editor confirm dialog",
    base: PREVIEW,
    scroller: ".overlay",
    panel: ".overlay .dialog",
    bottom: ".overlay .dialog-actions .btn:last-child",
    async open(p) {
      await p.goto(PREVIEW + "/editor");
      await p.waitForSelector(".editor-toolbar");
      await p
        .locator(".editor-toolbar .btn", { hasText: /back/i })
        .first()
        .tap();
      await p.waitForSelector(".overlay .dialog");
    },
  },
  {
    name: "Editor errors dialog",
    base: PREVIEW,
    scroller: ".overlay",
    panel: ".overlay .dialog",
    bottom: ".overlay .dialog-actions .btn:last-child",
    async open(p) {
      await p.goto(PREVIEW + "/editor");
      await p.waitForSelector(".editor-toolbar");
      await p
        .locator(".editor-toolbar .btn", { hasText: /^save/i })
        .first()
        .tap();
      await p.waitForSelector(".overlay .dialog");
    },
  },
  {
    name: "Not found (/nope)",
    base: PREVIEW,
    scroller: null,
    panel: ".placeholder-screen",
    bottom: ".placeholder-screen a",
    async open(p) {
      await p.goto(PREVIEW + "/nope");
      await p.waitForSelector(".placeholder-screen");
    },
  },
];

const browser = await chromium.launch();
const rows = [];

for (const panel of PANELS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    const client = await ctx.newCDPSession(page);
    const row = { panel: panel.name, vp: vp.name };
    try {
      await panel.open(page);
      await page.waitForTimeout(250);

      const geom = async () =>
        page.evaluate(
          ([ps, ss]) => {
            const el = document.querySelector(ps);
            const r = el.getBoundingClientRect();
            const sc = ss ? document.querySelector(ss) : null;
            const de = document.scrollingElement;
            const scroller =
              sc && sc.scrollHeight > sc.clientHeight ? sc : de;
            return {
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              scrollTop: scroller.scrollTop,
              scrollH: scroller.scrollHeight,
              clientH: scroller.clientHeight,
              docScrollW: de.scrollWidth,
              docClientW: de.clientWidth,
              bodyTA: getComputedStyle(document.body).touchAction,
            };
          },
          [panel.panel, panel.scroller],
        );

      const g0 = await geom();
      row.overflows = g0.scrollH > g0.clientH + 1;
      row.hOverflow = g0.docScrollW > g0.docClientW + 1;
      row.bodyTA = g0.bodyTA;

      // 1. Top of the panel reachable? (never above the viewport at the top scroll position)
      row.topReachable = g0.top >= -1;
      row.topAt = g0.top;

      // 2. Scroll to the very bottom with real touch flicks
      await touchScrollToEnd(page, client, vp, 1, panel.scroller);
      const g1 = await geom();
      row.scrolledBy = g1.scrollTop - g0.scrollTop;
      row.scrolls = row.overflows ? row.scrolledBy > 0 : "n/a (fits)";
      row.reachedBottom = g1.scrollTop >= g1.scrollH - g1.clientH - 2;

      // 3. Bottom-most control must now be INSIDE the viewport, then tappable
      const loc = page.locator(panel.bottom).last();
      if ((await loc.count()) === 0) {
        row.bottomControl = "n/a (none)";
      } else {
        const box = await loc.boundingBox();
        const inView = box && box.y >= -1 && box.y + box.height <= vp.h + 1;
        row.bottomInView = !!inView;
        if (!inView) {
          row.bottomControl = `UNREACHABLE (y=${box ? Math.round(box.y) : "?"}, vp=${vp.h})`;
        } else {
          try {
            await loc.tap({ timeout: 3000 });
            row.bottomControl = "reached + tapped";
          } catch (e) {
            row.bottomControl = "in view but UNTAPPABLE";
          }
        }
      }

      // 4. Scroll back up: top must still be reachable
      await touchScrollToEnd(page, client, vp, -1, panel.scroller);
      const g2 = await geom().catch(() => null);
      row.topReachableAfter = g2 ? g2.top >= -1 : "panel gone (navigated)";

      row.ok = true;
    } catch (e) {
      row.ok = false;
      row.error = String(e).split("\n")[0].slice(0, 110);
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await browser.close();
writeFileSync("verify-results.json", JSON.stringify(rows, null, 2));
