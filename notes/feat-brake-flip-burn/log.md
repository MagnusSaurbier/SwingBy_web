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
