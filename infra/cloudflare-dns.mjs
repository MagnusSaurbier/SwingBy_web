#!/usr/bin/env node
// Creates (or repairs) the `swingby` CNAME in Cloudflare, and — the whole point —
// guarantees it is DNS-only rather than proxied.
//
// infra/DEPLOY.md calls the grey-cloud setting "the step that reliably goes
// wrong", and it is a bad one to get wrong by hand: proxying Cloudflare in front
// of Vercel blocks ACME certificate issuance, and the symptom is an opaque TLS
// handshake error that never mentions proxying. As a dashboard click it is a
// coin-flip nobody verifies; as an API call it is one boolean, `proxied: false`,
// that a script can also assert afterwards.
//
// Idempotent: creates the record if absent, patches it if it exists with the
// wrong target or is proxied, and no-ops if it is already correct. Safe to run on
// every deploy.
//
// Env:
//   CLOUDFLARE_API_TOKEN   scoped token, permission: Zone → DNS → Edit
//   CLOUDFLARE_ZONE        zone name (default: magnussaurbier.de)
//   SUBDOMAIN              record name (default: swingby)
//   CNAME_TARGET           default: cname.vercel-dns.com
//
// Flags: --dry-run  print what would change, touch nothing
//        --verify   exit non-zero unless the record already exists and is correct

const API = "https://api.cloudflare.com/client/v4";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = process.env.CLOUDFLARE_ZONE || "magnussaurbier.de";
const SUBDOMAIN = process.env.SUBDOMAIN || "swingby";
const TARGET = process.env.CNAME_TARGET || "cname.vercel-dns.com";
const FQDN = `${SUBDOMAIN}.${ZONE_NAME}`;

const DRY_RUN = process.argv.includes("--dry-run");
const VERIFY_ONLY = process.argv.includes("--verify");

const BASE = process.env.CLOUDFLARE_API_BASE || API; // overridable for tests

async function cf(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(
      `${init.method || "GET"} ${pathname} returned non-JSON (HTTP ${res.status})`,
    );
  }
  if (!res.ok || body.success === false) {
    const detail = (body.errors || [])
      .map((e) => `${e.code} ${e.message}`)
      .join("; ");
    throw new Error(
      `${init.method || "GET"} ${pathname} failed (HTTP ${res.status}): ${detail || "unknown"}`,
    );
  }
  return body.result;
}

function fail(msg) {
  console.error(`cloudflare-dns: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!TOKEN) fail("CLOUDFLARE_API_TOKEN is not set");

  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones[0];
  if (!zone) fail(`zone ${ZONE_NAME} not found, or the token cannot see it`);
  console.log(`zone ${ZONE_NAME} → ${zone.id}`);

  const existing = (
    await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(FQDN)}`)
  )[0];

  const desired = {
    type: "CNAME",
    name: FQDN,
    content: TARGET,
    proxied: false,
    ttl: 1,
  };

  if (!existing) {
    if (VERIFY_ONLY)
      fail(`no record for ${FQDN} (run without --verify to create it)`);
    if (DRY_RUN) {
      console.log(
        `dry-run: would CREATE ${FQDN} CNAME → ${TARGET} (proxied: false)`,
      );
      return;
    }
    const made = await cf(`/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify(desired),
    });
    console.log(
      `created ${FQDN} CNAME → ${made.content} (proxied: ${made.proxied})`,
    );
    assertCorrect(made);
    return;
  }

  const drift = [];
  if (existing.type !== "CNAME") drift.push(`type ${existing.type} → CNAME`);
  if (existing.content !== TARGET)
    drift.push(`target ${existing.content} → ${TARGET}`);
  if (existing.proxied !== false)
    drift.push("proxied true → false (THIS is what breaks the certificate)");

  if (drift.length === 0) {
    console.log(
      `${FQDN} already correct: CNAME → ${existing.content}, proxied: false`,
    );
    return;
  }

  if (VERIFY_ONLY) fail(`${FQDN} is misconfigured: ${drift.join("; ")}`);
  if (DRY_RUN) {
    console.log(`dry-run: would PATCH ${FQDN}: ${drift.join("; ")}`);
    return;
  }

  const patched = await cf(`/zones/${zone.id}/dns_records/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify(desired),
  });
  console.log(`patched ${FQDN}: ${drift.join("; ")}`);
  assertCorrect(patched);
}

/** Read back what the API actually stored rather than trusting the request. */
function assertCorrect(record) {
  if (record.proxied !== false) {
    fail(
      `record was written but proxied is ${record.proxied} — certificate issuance will fail`,
    );
  }
  if (record.content !== TARGET) {
    fail(
      `record was written but target is ${record.content}, expected ${TARGET}`,
    );
  }
  console.log("verified: DNS-only (grey cloud), correct target");
}

main().catch((err) => fail(err.message));
