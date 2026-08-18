/**
 * Tests for infra/cloudflare-dns.mjs against a mock Cloudflare API.
 *
 * IMPORTANT SCOPE NOTE: this container's network policy blocks
 * api.cloudflare.com (verified — the agent proxy returns
 * `connect_rejected: gateway answered 403 to CONNECT`), so the script has NEVER
 * been run against the real API. What is tested here is everything that does not
 * require the real service: request shape, the `proxied: false` guarantee, drift
 * detection, idempotency, --dry-run, --verify, and error handling.
 *
 * That covers the failure this script exists to prevent. infra/DEPLOY.md calls
 * grey-cloud "the step that reliably goes wrong", and it goes wrong precisely
 * because a human forgets one toggle. Whether `proxied: false` is in the payload
 * is exactly what a mock can prove; whether Cloudflare accepts the token is not,
 * and is flagged as unverified in infra/AUTOMATION.md.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

type Record_ = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
};

interface MockState {
  records: Record_[];
  requests: { method: string; url: string; body: unknown }[];
  zoneLookupFails?: boolean;
}

let server: Server | null = null;

function startMock(state: MockState): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : null;
        state.requests.push({ method: req.method!, url: req.url!, body });
        const send = (payload: unknown, code = 200) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };

        if (req.url!.startsWith("/zones?name=")) {
          if (state.zoneLookupFails)
            return send(
              {
                success: false,
                errors: [{ code: 9109, message: "Unauthorized" }],
              },
              403,
            );
          return send({
            success: true,
            result: [{ id: "zone123", name: "magnussaurbier.de" }],
          });
        }
        if (req.url!.startsWith("/zones/zone123/dns_records?name=")) {
          return send({ success: true, result: state.records });
        }
        if (req.method === "POST" && req.url === "/zones/zone123/dns_records") {
          const rec = { id: "rec1", ...(body as object) } as Record_;
          state.records.push(rec);
          return send({ success: true, result: rec });
        }
        if (
          req.method === "PATCH" &&
          req.url!.startsWith("/zones/zone123/dns_records/")
        ) {
          const rec = { ...state.records[0], ...(body as object) } as Record_;
          state.records[0] = rec;
          return send({ success: true, result: rec });
        }
        send(
          { success: false, errors: [{ code: 404, message: "not found" }] },
          404,
        );
      });
    });
    server.listen(0, () =>
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`),
    );
  });
}

function run(
  base: string,
  args: string[] = [],
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["infra/cloudflare-dns.mjs", ...args], {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_API_BASE: base,
        CLOUDFLARE_ZONE: "magnussaurbier.de",
        SUBDOMAIN: "swingby",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

describe("cloudflare-dns.mjs", () => {
  it("creates the record DNS-only when none exists", async () => {
    const state: MockState = { records: [], requests: [] };
    const base = await startMock(state);
    const { code, out } = await run(base);

    expect(code).toBe(0);
    const post = state.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    // The single most important assertion in this file.
    expect((post!.body as Record_).proxied).toBe(false);
    expect((post!.body as Record_).type).toBe("CNAME");
    expect((post!.body as Record_).content).toBe("cname.vercel-dns.com");
    expect((post!.body as Record_).name).toBe("swingby.magnussaurbier.de");
    expect(out).toContain("verified: DNS-only");
  });

  it("un-proxies an existing orange-cloud record", async () => {
    const state: MockState = {
      records: [
        {
          id: "rec1",
          type: "CNAME",
          name: "swingby.magnussaurbier.de",
          content: "cname.vercel-dns.com",
          proxied: true,
        },
      ],
      requests: [],
    };
    const base = await startMock(state);
    const { code, out } = await run(base);

    expect(code).toBe(0);
    const patch = state.requests.find((r) => r.method === "PATCH");
    expect(patch).toBeDefined();
    expect((patch!.body as Record_).proxied).toBe(false);
    expect(out).toContain("THIS is what breaks the certificate");
    expect(state.records[0]!.proxied).toBe(false);
  });

  it("repairs a wrong CNAME target", async () => {
    const state: MockState = {
      records: [
        {
          id: "rec1",
          type: "CNAME",
          name: "swingby.magnussaurbier.de",
          content: "wrong.example.com",
          proxied: false,
        },
      ],
      requests: [],
    };
    const base = await startMock(state);
    const { code } = await run(base);
    expect(code).toBe(0);
    expect(state.records[0]!.content).toBe("cname.vercel-dns.com");
  });

  it("is idempotent — a correct record produces no write", async () => {
    const state: MockState = {
      records: [
        {
          id: "rec1",
          type: "CNAME",
          name: "swingby.magnussaurbier.de",
          content: "cname.vercel-dns.com",
          proxied: false,
        },
      ],
      requests: [],
    };
    const base = await startMock(state);
    const { code, out } = await run(base);

    expect(code).toBe(0);
    expect(out).toContain("already correct");
    expect(state.requests.filter((r) => r.method !== "GET").length).toBe(0);
  });

  it("--dry-run reports the change without writing", async () => {
    const state: MockState = { records: [], requests: [] };
    const base = await startMock(state);
    const { code, out } = await run(base, ["--dry-run"]);

    expect(code).toBe(0);
    expect(out).toContain("would CREATE");
    expect(state.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("--verify fails on a proxied record instead of silently fixing it", async () => {
    const state: MockState = {
      records: [
        {
          id: "rec1",
          type: "CNAME",
          name: "swingby.magnussaurbier.de",
          content: "cname.vercel-dns.com",
          proxied: true,
        },
      ],
      requests: [],
    };
    const base = await startMock(state);
    const { code, out } = await run(base, ["--verify"]);

    expect(code).toBe(1);
    expect(out).toContain("misconfigured");
    expect(state.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("fails loudly on an API error rather than reporting success", async () => {
    const state: MockState = {
      records: [],
      requests: [],
      zoneLookupFails: true,
    };
    const base = await startMock(state);
    const { code, out } = await run(base);

    expect(code).toBe(1);
    expect(out).toMatch(/9109|Unauthorized/);
  });

  it("refuses to run without a token", async () => {
    const state: MockState = { records: [], requests: [] };
    const base = await startMock(state);
    const child = await new Promise<{ code: number; out: string }>(
      (resolve) => {
        const c = spawn("node", ["infra/cloudflare-dns.mjs"], {
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: "",
            CLOUDFLARE_API_BASE: base,
          },
        });
        let out = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (out += d));
        c.on("close", (code) => resolve({ code: code ?? -1, out }));
      },
    );
    expect(child.code).toBe(1);
    expect(child.out).toContain("CLOUDFLARE_API_TOKEN is not set");
  });
});
