# Thought log - feat/brake-flip-burn

## 2026-08-20T22:52:38+00:00 - failing-first tests

Tests were written before production changes. Raw output is preserved in `notes/feat-brake-flip-burn/failing-first-raw.txt`.

Command:

```text
npm test -- packages/core/test/replay/verify.test.ts packages/web/test/loop.test.ts packages/web/src/render/bodies.test.ts
```

Observed output:

```text
❯ packages/web/test/loop.test.ts (20 tests | 2 failed) 253ms
   × end-to-end: physics, tape recording, and verification agree > counts brake-only ticks in the completion payload and server recomputation 25ms
     → expected +0 to be 347 // Object.is equality
   × braking uses the boost audio voice > sets boost for brake-only input without switching on the brake voice 2ms
     → expected [ 'setBoost:false', …(5) ] to include 'setBoost:true'

❯ packages/core/test/replay/verify.test.ts (114 tests | 2 failed) 457ms
   × braking contributes to the efficiency metric > counts ticks held only for braking 7ms
     → expected +0 to be 347 // Object.is equality
   × braking contributes to the efficiency metric > counts overlapping boost and brake ticks once 1ms
     → expected 7 to be 14 // Object.is equality

❯ packages/web/src/render/bodies.test.ts (6 tests | 1 failed) 7ms
   × drawPlayer > flips and draws the flame while braking, but refuses both while idle 3ms
     → expected 1.2 to be close to 4.341592653589793, received difference is 3.141592653589793, but expected 5e-13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯

Test Files  3 failed (3)
Tests  5 failed | 135 passed (140)
```

Before-change numbers shown by the failures:

- Brake-only replay: received `boostMs=0`, expected `347` for 50 brake ticks.
- Overlapping boost/brake replay: received `boostMs=7`, expected `14` for the two-tick union; the overlap must count once.
- Client completion payload: received `boostMs=0`, expected `347`.
- Brake audio: recorded `setBoost:false`; expected `setBoost:true`.
- Braking render: recorded rotation `1.2`; expected `4.341592653589793` (`1.2 + PI`).

## 2026-08-20T22:54:11+00:00 - implementation and verification

Production changes implemented in `packages/core/src/replay.ts`, `packages/web/src/game/loop.ts`, and `packages/web/src/render/bodies.ts`.

Focused tests after implementation:

```text
npm test -- packages/core/test/replay/verify.test.ts packages/web/test/loop.test.ts packages/web/src/render/bodies.test.ts

[loop.test] end-to-end capture: elapsedTicks=2110 timeMs=14653 boostMs=347 tape.ticks=2110 (source tape ticks=2110)
[loop.test] verifyReplay result: {"ok":true,"timeMs":14653,"boostMs":347,"ticks":2110}

Test Files  3 passed (3)
     Tests  140 passed (140)
```

The focused raw output is preserved in `notes/feat-brake-flip-burn/passing-focused-raw.txt`.

Requested gates:

```text
npm run typecheck
> typecheck
> tsc --build --force
```

Typecheck passed with exit code 0. Raw output: `typecheck-raw.txt`.

```text
npm test
Test Files  56 passed (56)
     Tests  852 passed | 1 skipped (853)
```

Full test baseline supplied by the owner: `847 passed, 1 skipped`. After this change: `852 passed, 1 skipped`, with five new tests and zero failures. The parity gate remains the existing one skipped test because no Godot traces are present.

```text
npm run lint
> lint
> prettier --check .

Checking formatting...
All matched files use Prettier code style!
```

Lint passed with exit code 0. Raw output: `lint-raw.txt`.

```text
npm run build -w @swingby/web
vite v5.4.21 building for production...
✓ 68 modules transformed.
✓ built in 681ms
```

Web build passed with exit code 0. The build reported `index-CWTFG3_F.js` at `108.80 kB`, gzip `36.21 kB`. Raw output: `build-raw.txt`.

Bundle size was measured against the parent commit before the production edits and after the final build:

```text
before: total gzip:  40.55 KB
before: size-check: PASS — 40.55 KB gzip, 209.45 KB under budget

after: total gzip:  40.58 KB
after: size-check: PASS — 40.58 KB gzip, 209.42 KB under budget
```

The before measurement temporarily built the three production files from `ad4cc94^`, then restored the working files and rebuilt the final version. Raw outputs: `size-before-raw.txt` and `size-after-final-raw.txt`.

Visual Playwright verification was not run per instruction. Audio hardware playback was not verified; the requested sink-call assertion passed (`setBoost:true` for brake-only input and no `setBrake:true`).
