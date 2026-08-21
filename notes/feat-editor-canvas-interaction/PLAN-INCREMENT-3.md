# Plan increment 3 — resting distance measured against `3 × drawn size`

Supersedes increment 2's units section (k = 10). **No code written for the resting position.** The
three separately-approved pieces are being built and land in their own commit.

---

## 0. Correction — I overstated "unclickable", including in what you relayed to the owner

In increment 2 I wrote that a handle within 20 px of another button is "unclickable", and you
carried that to the owner as "a feature that breaks its own control". **That is too strong and I
want it corrected before the owner decides anything on it.**

`hitTestButtons` returns the first button within 20 px scanning move → velocity → resize → delete.
So the handle's **centre** selects the earlier button — but a click on the far edge of the resize
disc can still be > 20 px from the earlier button and ≤ 20 px from resize. Precisely:

| Centre distance `D` between resize and the button ahead of it | Reality |
|---|---|
| `D = 0` (exactly concentric) | genuinely ungrabbable — every point in resize's disc is also in the other's |
| `0 < D < 20` | grabbable **only by clicking the far edge**; the centre selects the other button |
| `20 ≤ D < 32` | centre works; still visually overlapping |
| `D ≥ 32` | clean |

Re-measured against the velocity collision from the spike (resize at x≈275, velocity at x≈293, move
at x≈249, all y≈366): the set of points that hit resize and neither of the others is
**x ∈ (269, 273) — a 4 px sliver**. So the honest statement is "the grab target collapses to about
4 px", not "unclickable". Still a serious usability failure, still worth the owner's decision, but
the accurate wording matters when he is choosing whether to accept it.

---

## 1. The measurements — `k × drawnRadius`, per body type

`drawnRadius` from `render/bodies.ts`, read directly:

| Type | Drawn radius | Scales with `size`? |
|---|---|---|
| Sun | `size · zoom` (`drawSun`, core) | yes, ratio **1.0** |
| Planet | `max(6, size · 2.3 · zoom)` (`drawPlanet`) | yes above the floor, ratio **2.3** |
| Player | `ROCKET_SCALE(0.17) · zoom` × sprite, half-height ≈ **20.8 · zoom** | **no — independent of `size`** |

Screen distance `D = k · drawnRadius`. `!` = centre-unclickable (< 20 px), `:` = visual overlap
(< 32 px), `X` = off a 1020 px-wide canvas.

**k = 3.0 (the owner's number)**

| | sun s4 | sun s10 | sun s18 | sun s40 | planet s4 | planet s10 | planet s40 | player (any size) |
|---|---|---|---|---|---|---|---|---|
| zoom 0.12 | 1.4 ! | 3.6 ! | 6.5 ! | 14.4 ! | 18.0 ! | 18.0 ! | 33.1 | 7.5 ! |
| zoom 0.5 | 6.0 ! | 15.0 ! | 27.0 : | 60.0 | 18.0 ! | 34.5 | 138.0 | 31.2 : |
| zoom 1.0 | 12.0 ! | 30.0 : | 54.0 | 120.0 | 27.6 : | 69.0 | 276.0 | 62.5 |
| zoom 2.0 | 24.0 : | 60.0 | 108.0 | 240.0 | 55.2 | 138.0 | 552.0 X | 125.0 |
| zoom 5.0 | 60.0 | 150.0 | 270.0 | 600.0 X | 138.0 | 345.0 | 1380.0 X | 312.4 |

**k = 4.0** — same cells, the ones that change category: planet floor **18 → 24** (clears
centre-unclickable at every zoom); sun s10@z1 **30 → 40** (clears visual overlap); sun s4@z2
**24 → 32**; player@z0.5 **31.2 → 41.7**. Nothing that was fine becomes unfine. (k = 3.5 lifts the
planet floor only to 21.0 — one pixel over the line, too fragile to be worth deviating for.)

### Chosen factor: **4.0**, and why

You delegated this with "if 3.0 measures badly and 3.5 or 4 is clean, take it and say why".

1. It removes the only **constant** failure in the table. A planet's floor makes `D` independent of
   both size and zoom at the bottom of the range; at k = 3.0 that constant is 18 px, permanently
   inside move's hit radius. At k = 4.0 it is 24 px and always centre-clickable.
2. It nearly eliminates the release jump for the most common body type — see §2: planets go from a
   31 % jump to **8 %**, because 4.0 sits close to the planet's jump-free factor of 4.35.
3. It costs nothing at the top: every cell that was off-canvas at 3.0 was already off-canvas.

Everything else in the table is inherent to the no-floor rule, not to the factor — see §3.

---

## 2. The release jump — reported, not engineered around

Your prediction was right. With `D ∝ drawnRadius` rather than `∝ 1/SIZE_DRAG_SENSITIVITY`, the drag
and the rest position move at different rates, so releasing snaps the handle radially. The fraction
is **`1 − k · ratio · 0.1`** of the screen drag distance, and it is **zoom-independent**:

| | k = 3.0 | k = 4.0 | jump-free k |
|---|---|---|---|
| Sun (ratio 1.0) | **70 % inward** | 60 % inward | 10.0 |
| Planet (ratio 2.3) | 31 % inward | **8 % inward** | 4.35 |

Concretely at k = 4.0: drag a sun's handle out 200 px and on release it snaps 120 px back toward the
body; the same drag on a planet snaps back 16 px. **The sun case is large and will be visible.** No
single factor fixes both, because the fix is per-type (`1/(0.1·ratio)`) and the owner asked for one
factor keyed to drawn size. I am not engineering around it; it is his to accept or revisit.

---

## 3. Conflicts to hand back — I am not resolving these

**(a) "size zero sits in the centre" is unreachable, so it is definitional — confirmed, not
assumed.** `size` clamps to 4–40 in *both* mutation paths: the drag (`clampNum(..., 4, 40)`) and the
panel (`setSelectedSize`, same clamp), and `makeDefaultBody` never produces 0. So no editor action
can reach size 0. Your read is right: it defines the rule as linear through the origin. **No floor
implemented, no clamp lowered, `render/bodies.ts` untouched.**

**(b) The planet floor still contradicts it geometrically.** `max(6, …)` means a planet's drawn
radius never goes below 6, so `D` never goes below `4 × 6 = 24 px` however small `size` gets. The
rule's origin behaviour is therefore unreachable for planets even in principle. Reporting, not
fixing, exactly as you instructed.

**(c) The player breaks the rule outright, and this one is new.** The player's drawn size **does not
depend on `body.size` at all** — it is `ROCKET_SCALE · zoom` times a sprite. So for a player:
"3× the drawn size" never varies with size, and "size zero sits in the centre" cannot hold at any
factor. Two sub-decisions the owner should make rather than me:
- Which quantity is the player's "drawn size"? The sprite's half-height (≈ 20.8·zoom, what you
  actually see) or the HUD glow circle (`44 · ROCKET_SCALE · zoom` ≈ 7.5·zoom, much smaller)?
- Since it cannot scale with `size`, should the player instead keep today's fixed compass offset?
  That would be self-consistent — the rule is "distance follows drawn size", and the player's drawn
  size is constant.

There is also a mechanical obstacle: the sprite's natural dimensions are only known at runtime
inside the renderer's async-loaded `SpriteSet`, which `overlay.ts` has no access to. Any player
number has to be a constant in `overlay.ts` with a comment pointing at `bodies.ts`. Flagging that
now because it makes option "keep the fixed offset for players" the cheaper as well as the more
coherent answer.

---

## 4. Verification scope

Dropping the 360×740 row per your instruction — desktop and large screens only. The matrix keeps
the three body types × the size/zoom corners above, the flip across the centre, the degenerate case,
and a re-drag *after* a snap.

---

## 5. Open with the owner

1. Factor **4.0** instead of 3.0 — confirm, with §1's reasoning.
2. The **sun's 60 % release jump** (§2) — accept, or revisit the "keyed to drawn size" rule?
3. The **player** (§3c) — which drawn quantity, or keep the fixed offset for players?
4. Already with him: the collision (now correctly stated as a ~4 px grab sliver, not unclickable)
   and near-centre jitter.

**Status: resting position still awaiting GO.** The three approved pieces are being built now.
