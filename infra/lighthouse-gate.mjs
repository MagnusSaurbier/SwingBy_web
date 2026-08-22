#!/usr/bin/env node
// Lighthouse gate. Runs against any URL — a local `vite preview`, a Vercel
// preview deployment, or production — and fails the build when a category drops
// below its threshold.
//
// The thresholds are deliberate targets, not from taste:
//   performance   >= 90   on the game route
//   accessibility >= 95   on menu and level select
//
// This used to be a host-only step ("run Lighthouse against the live site"),
// which meant it ran approximately never. Pointed at a local preview build it
// needs no deployment, no domain and no human, so it can run on every PR.
//
// Usage:
//   node infra/lighthouse-gate.mjs                        # boots its own preview
//   node infra/lighthouse-gate.mjs --base https://…       # audits a deployment
//   node infra/lighthouse-gate.mjs --json out.json        # machine-readable summary

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";

const ROUTES = [
  { path: "/", label: "menu", performance: 90, accessibility: 95 },
  {
    path: "/levels",
    label: "level select",
    performance: 90,
    accessibility: 95,
  },
  { path: "/settings", label: "settings", performance: 90, accessibility: 95 },
  {
    path: "/play/builtin-00",
    label: "game route",
    performance: 90,
    accessibility: 95,
  },
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PREVIEW_PORT = Number(arg("port", "4173"));

/**
 * The preview is bound to, probed on, and audited at this one literal address.
 *
 * `vite preview` defaults to binding the hostname "localhost", which resolves to
 * whatever the host's resolver prefers: on a machine that answers with ::1 first,
 * vite listens on [::1]:4173 only, and a readiness probe against 127.0.0.1 gets
 * ECONNREFUSED forever ("port 4173 never opened"). Passing the literal IPv4
 * address to vite and using the same literal here and in the audited URL removes
 * the resolver from the loop entirely, so all three cannot disagree.
 */
const PREVIEW_HOST = "127.0.0.1";
const explicitBase = arg("base");
const jsonOut = arg("json");

/** Chromium ships with the container; Lighthouse needs to be told where. */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function waitForPort(port, host = PREVIEW_HOST, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = createConnection({ port, host });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline)
          reject(new Error(`${host}:${port} never opened`));
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

async function main() {
  let preview = null;
  let base = explicitBase;

  if (!base) {
    // No --base: build and serve locally, so this works with no deployment.
    console.log("no --base given, starting a local preview…");
    preview = spawn(
      "npx",
      [
        "vite",
        "preview",
        "--host",
        PREVIEW_HOST,
        "--strictPort",
        "--port",
        String(PREVIEW_PORT),
        "--outDir",
        "dist",
        "packages/web",
      ],
      // Keep the preview's own output: when it refuses to start (port taken,
      // missing build) its message is the only thing that says why, and
      // discarding it turns every such case into a bare readiness timeout.
      { stdio: ["ignore", "pipe", "pipe"], detached: false },
    );
    let previewLog = "";
    const capture = (chunk) => {
      previewLog += chunk;
    };
    preview.stdout.setEncoding("utf8");
    preview.stderr.setEncoding("utf8");
    preview.stdout.on("data", capture);
    preview.stderr.on("data", capture);
    preview.on("exit", (code) => {
      if (code !== 0 && code !== null) previewLog += `\nvite exited ${code}\n`;
    });

    try {
      await waitForPort(PREVIEW_PORT);
    } catch (err) {
      preview.kill("SIGTERM");
      throw new Error(
        `${err.message}\n--- vite preview output ---\n${previewLog.trim() || "(none)"}`,
      );
    }
    base = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
  }

  const chrome = chromePath();
  if (chrome) process.env.CHROME_PATH = chrome;
  console.log(`auditing ${base}`);
  console.log(`chrome: ${chrome ?? "(lighthouse default)"}\n`);

  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");

  const instance = await chromeLauncher.launch({
    chromePath: chrome ?? undefined,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  const rows = [];
  const failures = [];
  try {
    for (const route of ROUTES) {
      const result = await lighthouse(
        `${base}${route.path}`,
        { port: instance.port, output: "json", logLevel: "error" },
        undefined,
      );
      const cats = result.lhr.categories;
      const score = (k) => (cats[k] ? Math.round(cats[k].score * 100) : null);
      const row = {
        route: route.path,
        label: route.label,
        performance: score("performance"),
        accessibility: score("accessibility"),
        bestPractices: score("best-practices"),
        seo: score("seo"),
      };
      rows.push(row);

      for (const [key, min] of [
        ["performance", route.performance],
        ["accessibility", route.accessibility],
      ]) {
        if (row[key] !== null && row[key] < min) {
          failures.push(`${route.path} ${key} ${row[key]} < ${min}`);
        }
      }
    }
  } finally {
    await instance.kill();
    if (preview) preview.kill("SIGTERM");
  }

  const pad = (v, n) => String(v ?? "-").padStart(n);
  console.log("route          perf  a11y    bp   seo");
  for (const r of rows) {
    console.log(
      `${r.route.padEnd(15)}${pad(r.performance, 4)}${pad(r.accessibility, 6)}${pad(r.bestPractices, 6)}${pad(r.seo, 6)}`,
    );
  }

  if (jsonOut) {
    mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    writeFileSync(
      path.resolve(jsonOut),
      JSON.stringify({ base, rows, failures }, null, 2),
    );
    console.log(`\nwrote ${jsonOut}`);
  }

  if (failures.length) {
    console.error(`\nlighthouse-gate: FAIL\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nlighthouse-gate: PASS — every route meets its thresholds");
}

main().catch((err) => {
  console.error(`lighthouse-gate: ERROR ${err.message}`);
  process.exit(1);
});
