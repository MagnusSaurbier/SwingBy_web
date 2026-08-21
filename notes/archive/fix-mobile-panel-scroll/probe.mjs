// Mobile panel-scroll probe. Drives a real Chromium with touch emulation, opens every panel in
// the app, and reports for each: whether the page/panel overflows, whether a REAL touch scroll
// gesture (CDP Input.synthesizeScrollGesture, gestureSourceType "touch" — the same path a finger
// takes, and it honours touch-action) actually moves anything, whether the top of the panel is
// reachable, and whether the bottom-most control can be tapped.

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = process.env.OUT ?? "probe-results.json";

const VIEWPORTS = [
  { name: "360x640", width: 360, height: 640 },
  { name: "360x480", width: 360, height: 480 },
  { name: "740x360", width: 740, height: 360 },
  { name: "1280x800", width: 1280, height: 800 },
];

/** Panels: each has a name and an `open(page)` that leaves the target panel on screen, plus a
 *  `scroller` CSS selector naming the element expected to scroll, and `bottomControl` selector. */
const PANELS = [
  {
    name: "menu (/)",
    async open(page) {
      await page.goto(`${BASE}/`);
      await page.waitForSelector(".menu-card");
    },
    scroller: ".menu-screen",
    bottomControl: ".menu-nav .btn:last-child",
  },
  {
    name: "level select (/levels)",
    async open(page) {
      await page.goto(`${BASE}/levels`);
      await page.waitForSelector(".level-grid");
    },
    scroller: ".screen",
    bottomControl: ".screen-footer a, .screen-footer .btn",
  },
  {
    name: "workshop (/workshop)",
    async open(page) {
      await page.goto(`${BASE}/workshop`);
      await page.waitForSelector(".workshop-layout");
    },
    scroller: ".screen",
    bottomControl: ".screen-footer a, .screen-footer .btn",
  },
  {
    name: "settings standalone (/settings)",
    async open(page) {
      await page.goto(`${BASE}/settings`);
      await page.waitForSelector(".settings-toggles");
    },
    scroller: ".screen",
    bottomControl: ".screen-footer a, .screen-footer .btn",
  },
  {
    name: "credits (/credits)",
    async open(page) {
      await page.goto(`${BASE}/credits`);
      await page.waitForSelector(".credits-card");
    },
    scroller: ".credits-screen",
    bottomControl: ".credits-card a, .screen-footer a",
  },
  {
    name: "play ready gate (/play/builtin-01)",
    async open(page) {
      await page.goto(`${BASE}/play/builtin-01`);
      await page.waitForSelector(".play-ready");
    },
    scroller: ".play-screen",
    bottomControl: ".play-ready-actions .btn",
  },
  {
    name: "in-game pause panel",
    async open(page) {
      await page.goto(`${BASE}/play/builtin-01`);
      await page.waitForSelector(".play-ready-actions .btn");
      await page.locator(".play-ready-actions .btn").tap();
      await page.waitForSelector("canvas.play-canvas");
      await page.waitForTimeout(400);
      await page.locator(".play-chrome .btn").tap();
      await page.waitForSelector(".sb-pause-root .overlay .dialog");
    },
    scroller: ".sb-pause-root .overlay",
    panel: ".sb-pause-root .dialog",
    bottomControl: ".sb-pause-root .dialog-actions .btn:last-child",
  },
  {
    name: "in-game settings tab (pause -> Settings)",
    async open(page) {
      await page.goto(`${BASE}/play/builtin-01`);
      await page.waitForSelector(".play-ready-actions .btn");
      await page.locator(".play-ready-actions .btn").tap();
      await page.waitForSelector("canvas.play-canvas");
      await page.waitForTimeout(400);
      await page.locator(".play-chrome .btn").tap();
      await page.waitForSelector(".sb-pause-root .dialog");
      await page
        .locator(".sb-pause-root .dialog-actions .btn", { hasText: "Settings" })
        .tap();
      await page.waitForSelector(".settings-toggles");
    },
    scroller: ".screen",
    bottomControl: ".screen-footer a, .screen-footer .btn",
  },
  {
    name: "editor (/editor)",
    async open(page) {
      await page.goto(`${BASE}/editor`);
      await page.waitForSelector(".editor-toolbar");
    },
    scroller: ".editor-panel",
    bottomControl: ".editor-panel .btn:last-of-type",
  },
  {
    name: "editor confirm dialog (Back)",
    async open(page) {
      await page.goto(`${BASE}/editor`);
      await page.waitForSelector(".editor-toolbar");
      const back = page.locator(".editor-toolbar .btn", { hasText: /back/i });
      await back.first().tap();
      await page.waitForSelector(".overlay .dialog");
    },
    scroller: ".overlay",
    panel: ".overlay .dialog",
    bottomControl: ".overlay .dialog-actions .btn:last-child",
  },
  {
    name: "editor errors dialog (Save empty level)",
    async open(page) {
      await page.goto(`${BASE}/editor`);
      await page.waitForSelector(".editor-toolbar");
      const save = page.locator(".editor-toolbar .btn", { hasText: /^save/i });
      await save.first().tap();
      await page.waitForSelector(".overlay .dialog");
    },
    scroller: ".overlay",
    panel: ".overlay .dialog",
    bottomControl: ".overlay .dialog-actions .btn:last-child",
  },
  {
    name: "not found (/nope)",
    async open(page) {
      await page.goto(`${BASE}/nope`);
      await page.waitForSelector(".placeholder-screen");
    },
    scroller: ".placeholder-screen",
    bottomControl: ".placeholder-screen a",
  },
];

/** Real touch scroll via CDP. Returns how far the page/scroller actually moved. */
async function touchScroll(page, client, dx, dy, x, y) {
  await client.send("Input.synthesizeScrollGesture", {
    x,
    y,
    xDistance: -dx,
    yDistance: -dy,
    gestureSourceType: "touch",
    speed: 4000,
    repeatCount: 0,
  });
  await page.waitForTimeout(250);
}

async function measure(page, sel) {
  return page.evaluate((s) => {
    const doc = document.scrollingElement;
    const el = s ? document.querySelector(s) : null;
    return {
      docScrollTop: doc.scrollTop,
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyTouchAction: getComputedStyle(document.body).touchAction,
      htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
      el: el
        ? {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            overflowY: getComputedStyle(el).overflowY,
            touchAction: getComputedStyle(el).touchAction,
            alignItems: getComputedStyle(el).alignItems,
          }
        : null,
    };
  }, sel);
}

async function run() {
  const browser = await chromium.launch();
  const results = [];

  for (const vp of VIEWPORTS) {
    for (const panel of PANELS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      const row = { viewport: vp.name, panel: panel.name };
      try {
        await panel.open(page);
        await page.waitForTimeout(150);

        const client = await ctx.newCDPSession(page);

        const before = await measure(page, panel.scroller);
        row.bodyTouchAction = before.bodyTouchAction;

        // Panel geometry relative to the viewport: is the TOP clipped above y=0?
        const panelSel = panel.panel ?? panel.scroller;
        const geo = await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        }, panelSel);
        row.panelTop = geo ? Math.round(geo.top) : null;
        row.panelBottom = geo ? Math.round(geo.bottom) : null;
        row.panelHeight = geo ? Math.round(geo.height) : null;
        row.viewportH = vp.height;

        // Does content overflow at all?
        const scrollerOverflows = before.el
          ? before.el.scrollHeight > before.el.clientHeight + 1
          : false;
        const docOverflows =
          before.docScrollHeight > before.docClientHeight + 1;
        row.overflows = scrollerOverflows || docOverflows;
        row.topClipped = geo ? geo.top < -1 : null;
        row.bottomOffscreen = geo ? geo.bottom > vp.height + 1 : null;

        // Horizontal overflow
        row.hOverflow = before.docScrollWidth > before.docClientWidth + 1;

        // Real touch drag upward (content moves up = scroll down)
        await touchScroll(
          page,
          client,
          0,
          Math.min(400, vp.height - 60),
          Math.round(vp.width / 2),
          Math.round(vp.height / 2),
        );
        const after = await measure(page, panel.scroller);
        row.scrolledBy =
          (after.docScrollTop - before.docScrollTop) +
          ((after.el?.scrollTop ?? 0) - (before.el?.scrollTop ?? 0));
        row.scrollerOverflowY = before.el?.overflowY ?? null;
        row.scrollerTouchAction = before.el?.touchAction ?? null;
        row.scrollerAlign = before.el?.alignItems ?? null;

        // Bottom-most control reachable + tappable?
        if (panel.bottomControl) {
          const loc = page.locator(panel.bottomControl).last();
          const n = await loc.count();
          if (n === 0) {
            row.bottomControl = "absent";
          } else {
            const box = await loc.boundingBox();
            row.bottomControlBox = box
              ? { y: Math.round(box.y), h: Math.round(box.height) }
              : null;
            try {
              await loc.tap({ timeout: 3000 });
              row.bottomControl = "tapped";
            } catch (e) {
              row.bottomControl = "UNTAPPABLE: " + String(e).split("\n")[0];
            }
          }
        }
        row.ok = true;
      } catch (e) {
        row.ok = false;
        row.error = String(e).split("\n").slice(0, 3).join(" | ");
      }
      results.push(row);
      console.log(JSON.stringify(row));
      await ctx.close();
    }
  }
  await browser.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
