/**
 * Regression tests for the two CI failures that landed on `main` with the parity
 * merge (runs 32426776009 and 32426776034).
 *
 * SCOPE NOTE: these assert on the source and workflow text, not on a GitHub run.
 * There is no Actions runner here, and the two bugs are both configuration: one
 * is which address `vite preview` is told to bind, the other is whether a job
 * runs at all when a secret is absent. `packages/web/test/ui-toggle-css.test.ts`
 * uses the same shape for CSS rules that no jsdom can evaluate here. What a
 * runner proves and this cannot is that the workflow YAML is accepted and the
 * skip is reported neutral; that is stated in the PR, and was watched on the
 * run itself.
 *
 * Both blocks fail against the pre-fix files: `lighthouse-gate.mjs` passed no
 * `--host` and audited `http://localhost:PORT`, and `deploy.yml` had no
 * `preflight` job and no `if:` on `deploy`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("infra/lighthouse-gate.mjs local preview address", () => {
  const src = read("infra/lighthouse-gate.mjs");

  it("binds the preview to one literal IPv4 address rather than the name 'localhost'", () => {
    // The bug: `vite preview` defaults to binding the hostname "localhost". On a host
    // whose resolver answers ::1 first, vite listened on [::1]:4173 only while the
    // readiness probe dialled 127.0.0.1, so the gate failed with
    // "port 4173 never opened" without ever auditing anything.
    expect(src).toMatch(/const PREVIEW_HOST = "127\.0\.0\.1";/);
    expect(src).toMatch(/"--host",\s*\n\s*PREVIEW_HOST,/);
  });

  it("probes, and then audits, that same address", () => {
    expect(src).toMatch(/createConnection\(\{ port, host \}\)/);
    expect(src).toMatch(/waitForPort\(port, host = PREVIEW_HOST/);
    expect(src).toMatch(
      /base = `http:\/\/\$\{PREVIEW_HOST\}:\$\{PREVIEW_PORT\}`/,
    );
    // No name-resolved host may reappear: three places have to agree, and the only
    // way they cannot disagree is by all naming the same literal.
    expect(src).not.toMatch(/localhost:\$\{PREVIEW_PORT\}/);
    expect(src).not.toMatch(/host: "localhost"/);
  });

  it("keeps the preview's own output so a startup failure is diagnosable", () => {
    // `stdio: "ignore"` turned "port already in use" into a bare 60s timeout.
    expect(src).not.toMatch(/stdio: "ignore"/);
    expect(src).toMatch(/vite preview output/);
  });
});

describe(".github/workflows/deploy.yml unprovisioned-secret behaviour", () => {
  const yml = read(".github/workflows/deploy.yml");

  it("gates the deploy job on a preflight secret-presence check", () => {
    // The bug: with no secrets set, `vercel --token=""` failed with
    // 'You defined "--token", but it is missing a value', reddening every push to main.
    // `secrets` is not addressable in a job-level `if:`, so presence is computed in a
    // step and published as a job output.
    expect(yml).toMatch(/^ {2}preflight:/m);
    expect(yml).toMatch(/vercel: \$\{\{ steps\.check\.outputs\.vercel \}\}/);
    expect(yml).toMatch(
      /cloudflare: \$\{\{ steps\.check\.outputs\.cloudflare \}\}/,
    );
    expect(yml).toMatch(/if: needs\.preflight\.outputs\.vercel == 'true'/);
  });

  it("checks the Cloudflare token separately from the Vercel triple", () => {
    expect(yml).toMatch(/needs\.preflight\.outputs\.cloudflare == 'true'/);
    expect(yml).toMatch(/needs: \[preflight, deploy\]/);
  });

  it("does not audit a deployment that never happened", () => {
    expect(yml).toMatch(/if: needs\.deploy\.result == 'success'/);
  });

  it("still deploys, with the same commands, once the secrets exist", () => {
    // The fix must not weaken the deploy itself.
    expect(yml).toMatch(
      /npx vercel@latest deploy --prebuilt \$prod --token="\$VERCEL_TOKEN"/,
    );
    expect(yml).toMatch(/node infra\/cloudflare-dns\.mjs --verify/);
    expect(yml).toMatch(/Smoke-test the deployment/);
  });

  it("never writes a secret value or a placeholder into the workflow", () => {
    // Presence checks only: the tokens appear as `secrets.*` references and as
    // `-n "$VAR"` tests, never as literals and never echoed.
    expect(yml).toMatch(/\[ -n "\$VERCEL_TOKEN" \]/);
    expect(yml).not.toMatch(/VERCEL_TOKEN: (?!\$\{\{ secrets)/);
    expect(yml).not.toMatch(/echo "\$VERCEL_TOKEN"/);
    expect(yml).not.toMatch(/echo "\$CLOUDFLARE_API_TOKEN"/);
  });
});
