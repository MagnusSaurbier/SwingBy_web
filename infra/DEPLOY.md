# Deploy runbook — swingby.magnussaurbier.de

This is the step-by-step for taking the repo from "builds locally" to "live on the internet with
a certificate." Every step here requires an account/dashboard an agent container does not have
(no Vercel account, no Cloudflare access, no Neon account, no live domain) — treat any step you
haven't personally verified as unconfirmed until the "How to verify" section at the bottom goes
green for real.

None of this touches the personal site repo (`magnussaurbier/magnussaurbier`). SwingBy gets its
own repo, its own Vercel project, its own subdomain — see docs/INFRA.md §3 for why.

---

## 0. Prerequisites

- A GitHub repo for this project, pushed (`github.com/MagnusSaurbier/SwingBy_web`).
- A Vercel account with access to create a new project.
- Cloudflare access to the `magnussaurbier.de` zone (nameservers are already
  `wally.ns.cloudflare.com` / `neil.ns.cloudflare.com`).
- A Neon account (free tier is enough — see docs/INFRA.md §4).

---

## 1. Create the Vercel project

Dashboard: **Add New… → Project → Import Git Repository** → select `SwingBy_web`.

This repo is an npm-workspaces monorepo with the static site in `packages/web` and serverless
functions in `api/` at the repo root. Two settings matter more than usual because of that shape:

| Setting            | Value                           | Why                                                                                                                                                                         |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root Directory** | repo root (leave unset / `.`)   | `api/**` only deploys as functions if it's at the root the Vercel build sees. Setting Root Directory to `packages/web` would build the site fine but silently drop the API. |
| Build Command      | `npm run build -w @swingby/web` | already set in `vercel.json` — the dashboard should show it as inherited, don't override                                                                                    |
| Output Directory   | `packages/web/dist`             | already set in `vercel.json`                                                                                                                                                |
| Install Command    | `npm install`                   | already set in `vercel.json`                                                                                                                                                |
| Framework Preset   | Other / None                    | `vercel.json` sets `"framework": null` so Vercel doesn't guess and override the above                                                                                       |

`vercel.json` at the repo root already encodes buildCommand/outputDirectory/installCommand, the
SPA rewrite, and the cache headers — the dashboard fields above should just confirm what the file
says, not need hand entry. If they disagree, the file wins on the next deploy and the dashboard
was stale.

**Preview deploys on PRs** are automatic the moment the GitHub repo is connected this way — no
extra config. Vercel's GitHub App comments the preview URL directly on each PR.

---

## 2. Add the domain

Vercel dashboard → the SwingBy project → **Settings → Domains → Add** →
`swingby.magnussaurbier.de`.

Vercel will show a pending DNS instruction (a CNAME target, typically `cname.vercel-dns.com`) and
the domain will read "Invalid Configuration" until step 3 is done and has propagated.

---

## 3. Cloudflare DNS — the step that reliably goes wrong

Cloudflare dashboard → `magnussaurbier.de` zone → **DNS → Records → Add record**:

| Field        | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Type         | `CNAME`                                                                 |
| Name         | `swingby`                                                               |
| Target       | `cname.vercel-dns.com`                                                  |
| Proxy status | **DNS only (grey cloud)** — click the orange cloud icon to turn it grey |
| TTL          | Auto                                                                    |

**Do not leave this proxied (orange cloud).** Cloudflare in front of Vercel double-CDNs the
request and — critically — blocks Vercel's automatic ACME certificate issuance. The failure mode
is not "DNS broken" or "proxy detected"; it is an opaque TLS handshake failure that looks like a
generic certificate problem. If certificate issuance is stuck in the Vercel domain settings, this
is the first and most likely cause — check the cloud icon color before anything else.

Verify the record is grey-cloud in the Cloudflare dashboard itself (the icon is literally grey,
not orange, next to the record).

---

## 4. Wait for the certificate

Vercel issues the certificate automatically once the CNAME resolves and is not proxied. This is
usually minutes, not hours, once DNS has propagated. The Domains page in the dashboard shows
"Valid Configuration" with a certificate icon when it's done.

---

## 5. Neon — database for the leaderboard/level-sharing API

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Copy the connection string. Use the **pooled / HTTP-driver-compatible** connection string —
   `api/**` is written against `@neondatabase/serverless`'s HTTP driver specifically (see
   `api/package.json`) to avoid exhausting Postgres connections from serverless function
   concurrency; a raw TCP connection string works differently and is not what that driver
   expects.
3. In the Vercel project → **Settings → Environment Variables**, add:
   - `DATABASE_URL` = the Neon connection string
   - Scope: Production, Preview, and Development (the API routes need it in preview deploys
     too, since those are what PRs get reviewed against)
4. **Never commit this value.** `.gitignore` at the repo root already excludes `.env` /
   `.env.local`; this is an additional reminder that the only place the connection string should
   ever live is the Vercel dashboard's environment variable store.
5. Apply `infra/schema.sql` against the Neon database — via the Neon SQL editor in the dashboard,
   or `psql "$DATABASE_URL" -f infra/schema.sql` from a machine with `psql` and the connection
   string.

No COOP/COEP headers are needed anywhere in this deployment (`vercel.json` does not set them) —
this app has no WASM/threaded-runtime requirement. Do not add them "just in case"; they break
cross-origin embeds for no benefit here.

---

## 6. Link from the personal site (optional, reviewed PR only)

The **only** change the personal site repo should ever receive from this project is a one-line
link to the game, and it must go through a normal reviewed PR — **never a direct push to
`main`**, because every push to that repo's `main` deploys to production immediately. Suggested
change, for whoever opens that PR:

```diff
- <!-- wherever the site's nav/link list lives -->
+ <a href="https://swingby.magnussaurbier.de">SwingBy</a>
```

Adjust markup/placement to match that repo's actual `index.html` structure — this repo does not
contain a copy of it to diff against.

---

## How to verify (run these once the steps above are actually done)

**DNS and certificate:**

```bash
dig +short swingby.magnussaurbier.de
curl -sSI https://swingby.magnussaurbier.de | head -5
openssl s_client -connect swingby.magnussaurbier.de:443 -servername swingby.magnussaurbier.de \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

Certificate must cover the subdomain and be current. If issuance looks stuck, re-check step 3 —
the Cloudflare record is almost certainly still proxied.

**Deep links on cold load** (a fresh curl, not a click-through):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://swingby.magnussaurbier.de/play/builtin-07
```

Must be `200`. If it's `404`, the rewrite in `vercel.json` isn't taking effect — check that
Output Directory in the dashboard matches `packages/web/dist` and that the build actually
produced an `index.html` there.

**Cache headers:**

```bash
curl -sSI https://swingby.magnussaurbier.de/ | grep -i cache-control              # expect no-cache
curl -sSI https://swingby.magnussaurbier.de/assets/<hashed>.js | grep -i cache-control  # expect immutable
```

**Lighthouse**, once the site is live:

```bash
npx lighthouse https://swingby.magnussaurbier.de --view --preset=desktop
```

or Chrome DevTools → Lighthouse tab, against the live URL. Performance target is **≥ 90** on the
game route. Accessibility target for the menu and level select screens is **≥ 95** — a separate
run against `/`.

**Personal site untouched:**

```bash
git -C <path-to-magnussaurbier-checkout> log --oneline -5
```

Should show nothing from this project except the one reviewed link commit from step 6, if it's
been merged.
