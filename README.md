# SwingBy Web

A browser build of SwingBy, an orbital-mechanics puzzle game, hosted at
`swingby.magnussaurbier.de`. You pilot a spacecraft through a miniature solar system using only
gravity, an initial velocity, and boost/brake — see [docs/GAME.md](docs/GAME.md) for the full
picture.

## Quick start

```bash
npm install
npm run dev -w @swingby/web      # dev server on localhost:5173
npm test                          # all tests, all packages
npm run typecheck
npm run lint                      # prettier --check
npm run build -w @swingby/web
npm run size                      # bundle budget gate, fails over 250 KB gzipped
```

## Getting context for a task

Read this file, then follow the table below — open only what your task's trigger matches. Each
`docs/` file ends by naming the exact source files it describes, which is where to go next. Full
process (including when to split work across subsessions) is in [AGENTS.md](AGENTS.md).

| Doc                                        | Read this when...                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/GAME.md](docs/GAME.md)               | your task touches gameplay, mechanics, level content, package layout, or general repo conventions                                                                   |
| [docs/INTERFACES.md](docs/INTERFACES.md)   | you need the exact shape of a type/function/API contract, or which module owns a given file                                                                         |
| [docs/PHYSICS.md](docs/PHYSICS.md)         | you're touching gravity, integration, boost/brake math, bounds, or prediction — the physics core in full mathematical detail, every equation cited to a `file:line` |
| [docs/INFRA.md](docs/INFRA.md)             | you're touching the API, the database, deployment, or hosting                                                                                                       |
| [infra/DEPLOY.md](infra/DEPLOY.md)         | you're actually running the deploy steps, not just reading about the architecture                                                                                   |
| [infra/AUTOMATION.md](infra/AUTOMATION.md) | you need to know what's automated in CI vs. still manual                                                                                                            |

`packages/core/src/types.ts` and `constants.ts` are the shared type/constant contract read by both
packages — read them before writing code against anything in `docs/INTERFACES.md`.

`notes/archive/` holds working logs and specs for finished work. Not force-read — open it only
when tracing a specific past decision (grep a feature name).

## Standing constraints (apply regardless of task)

- **Bundle budget:** under 250 KB gzipped, gated by `npm run size`.
- **`packages/core` is zero-dependency** and runs in both the browser and Node — that's what
  makes server-side replay verification possible.
- **Never use `Math.pow` in the physics path** — see [docs/GAME.md §4](docs/GAME.md#4-conventions).
- **Touch is first-class**, not a desktop afterthought — this is a phone-playable game.
- Branch per task (`feat/<slug>` / `fix/<slug>`), push early and often — see
  [AGENTS.md](AGENTS.md).
