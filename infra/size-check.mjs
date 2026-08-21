#!/usr/bin/env node
/**
 * Bundle size gate.
 *
 * Measures the gzipped weight of the built @swingby/web output and fails the process (exit 1)
 * if it exceeds the budget. This is `npm run size` (docs/GAME.md §2) — a hard gate, not a
 * warning: a dependency that silently adds 300 KB erases the reason this project exists.
 *
 * Scope: JS + CSS emitted into the build output directory (default `packages/web/dist`), i.e.
 * the code weight of the initial route. Static binary assets (rocket sprites, etc., T-04 AURORA)
 * are not code and are not part of this budget — they're fetched lazily/independently and don't
 * block "instant load" the way a bloated JS bundle does. index.html itself is included for
 * completeness but is negligible.
 *
 * Configurable via environment variables purely so this script can be exercised in CI/locally
 * without hand-editing it for a demo:
 *   SIZE_CHECK_DIR        directory to scan (default: packages/web/dist, resolved from repo root)
 *   SIZE_CHECK_BUDGET_KB  budget in KB, gzipped (default: 250)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const budgetKb = Number(process.env.SIZE_CHECK_BUDGET_KB ?? 250);
const targetDir = process.env.SIZE_CHECK_DIR
  ? join(repoRoot, process.env.SIZE_CHECK_DIR)
  : join(repoRoot, "packages/web/dist");

const COUNTED_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html"]);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (COUNTED_EXTENSIONS.has(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

if (!existsSync(targetDir)) {
  console.error(
    `size-check: build output not found at ${relative(repoRoot, targetDir)}`,
  );
  console.error(`size-check: run \`npm run build -w @swingby/web\` first.`);
  process.exit(1);
}

const files = walk(targetDir).sort();

if (files.length === 0) {
  console.error(
    `size-check: no .js/.mjs/.css/.html files found under ${relative(repoRoot, targetDir)}`,
  );
  process.exit(1);
}

let totalRaw = 0;
let totalGzip = 0;
const rows = [];

for (const file of files) {
  const raw = readFileSync(file);
  const gzip = gzipSync(raw, { level: 9 });
  totalRaw += raw.byteLength;
  totalGzip += gzip.byteLength;
  rows.push({
    file: relative(repoRoot, file),
    raw: raw.byteLength,
    gzip: gzip.byteLength,
  });
}

const budgetBytes = budgetKb * 1024;

const fmtKb = (bytes) => (bytes / 1024).toFixed(2);

console.log(`size-check: ${relative(repoRoot, targetDir)}`);
console.log("");
for (const row of rows) {
  console.log(
    `  ${row.file}  raw ${fmtKb(row.raw)} KB  gzip ${fmtKb(row.gzip)} KB`,
  );
}
console.log("");
console.log(`  total raw:   ${fmtKb(totalRaw)} KB`);
console.log(`  total gzip:  ${fmtKb(totalGzip)} KB`);
console.log(`  budget:      ${budgetKb.toFixed(2)} KB gzip`);
console.log("");

if (totalGzip > budgetBytes) {
  console.error(
    `size-check: FAIL — ${fmtKb(totalGzip)} KB gzip exceeds the ${budgetKb.toFixed(2)} KB budget ` +
      `by ${fmtKb(totalGzip - budgetBytes)} KB`,
  );
  process.exit(1);
}

console.log(
  `size-check: PASS — ${fmtKb(totalGzip)} KB gzip, ${fmtKb(budgetBytes - totalGzip)} KB under budget`,
);
