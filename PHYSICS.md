# PHYSICS.md — the update step as implemented

This document states, in mathematical notation, **what the code currently does**. It is not a model
of what the simulation ought to be, and it is not orbital mechanics. Every equation carries a
`file:line` citation; if an equation and the cited line disagree, the line is right and this document
is wrong.

Paths are relative to the repository root. The physics core is
[`packages/core/src/physics.ts`](packages/core/src/physics.ts); the frame-to-tick driver is
[`packages/web/src/game/loop.ts`](packages/web/src/game/loop.ts); constants come from
[`packages/core/src/constants.ts`](packages/core/src/constants.ts) (FROZEN).

Where the port deliberately diverges from the Godot reference
(`reference/godot/scripts/PhysicsEngine.gd`, read-only), the divergence appears **in the maths**, not
only in prose. Section [§11](#11-departures-approximations-and-oddities) collects them.

---

## 1. Symbols

Every symbol used below, defined once. Vectors are 2-vectors in world space; components are written
$x$ and $y$ where the code is componentwise (which is most of it — `Body` stores loose scalars, not
vectors: `types.ts:58-78`).

| Symbol                              | Meaning                                               | Code                                       |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| $\mathbf{r}_i = (x_i, y_i)$         | position of body $i$                                  | `Body.x`, `Body.y`                         |
| $\mathbf{v}_i = (v_{x,i}, v_{y,i})$ | velocity of body $i$                                  | `Body.xVel`, `Body.yVel`                   |
| $\mathbf{a}_i = (a_{x,i}, a_{y,i})$ | accumulated acceleration of body $i$ this substep     | `Body.xAcc`, `Body.yAcc`                   |
| $\mu_j$                             | gravitational parameter of body $j$ (**not** a mass)  | `Body.gravity`, `types.ts:26`              |
| $s_i$                               | body radius, used for rendering only (not gravity)    | `Body.size`                                |
| $\theta_i$                          | visual rotation angle (never read by physics)         | `Body.angle`, `types.ts:71`                |
| $\omega_i$                          | visual spin, degrees per tick                         | `Body.turnSpeed`, `types.ts:73`            |
| $N$                                 | substeps in the current tick                          | `substeps`, `physics.ts:384`               |
| $\sigma = 1/N$                      | substep scale                                         | `stepScale`, `physics.ts:385`              |
| $\Delta t$                          | tick interval, $1/144$ s                              | `TICK_INTERVAL`, `constants.ts:12`         |
| $\beta$                             | boost strength, $0.005$                               | `BOOST_STRENGTH`, `constants.ts:21`        |
| $\tau$                              | side thrust, $0.0$                                    | `SIDE_THRUST`, `constants.ts:23`           |
| $\mathbf{u} = (u_x, u_y)$           | raw directional input, each component in $\{-1,0,1\}$ | `InputState.thrustX/Y`, `input.ts:369-372` |
| $b, k \in \{0,1\}$                  | boost held, brake held                                | `InputState.boost`, `InputState.brake`     |
| $\epsilon$                          | degenerate-distance guard, $10^{-6}$                  | `EPS_DIST_SQ`, `physics.ts:52`             |
| $A$                                 | frame-time accumulator, seconds                       | `accumulator`, `loop.ts:187`               |
| $\varepsilon_A$                     | accumulator drain tolerance, $10^{-9}$                | `TICK_EPSILON`, `loop.ts:159`              |
| $R(x,y)$                            | bounds ratio                                          | `boundsRatio`, `bounds.ts:51-56`           |
| $W$                                 | bounds warning level in $[0,1]$                       | `boundsWarningLevel`, `bounds.ts:63-68`    |
| $T_w$                               | out-of-bounds grace timer, seconds                    | `BoundsState.warningTimer`, `bounds.ts:30` |

Indices: $i$ is always the **target** body being integrated, $j$ the **source** of gravity.

## 2. Units and conventions

- **Coordinates.** $+x$ right, $+y$ **down** (Godot screen convention, `PROJECT.md §4`). All 33
  built-in levels lie in $x \in [180, 1660]$, $y \in [100, 820]$.
- **Time.** The simulation's time unit is the **tick**, not the second. The position update is
  $\mathbf{r} \mathrel{+}= \mathbf{v}\sigma$ (`physics.ts:282-283`) summed over $N$ substeps, so
  one tick advances position by $\mathbf{v}$ when $\mathbf{v}$ is constant. Therefore
  $[\mathbf{v}] = \text{units}/\text{tick}$, $[\mathbf{a}] = \text{units}/\text{tick}^2$ and
  $[\mu] = \text{units}^3/\text{tick}^2$. The tick interval $\Delta t = 1/144\ \mathrm{s}$ never
  enters the integrator; it appears **only** inside `substepCount` (`physics.ts:98`,
  `physics.ts:103`), where it is dimensionally inconsistent with the above — see §4.1.
- **Numerics.** Only $+ - \times \div \sqrt{\cdot}$ appear in the physics path; $u^{3/2}$ is written
  $u\sqrt{u}$ (`physics.ts:93`, `physics.ts:138`) because the JS power builtin is not required to be
  correctly rounded. This is exact under IEEE 754, so it is not an approximation — it is a
  reproducibility measure (`PROJECT.md §4`).
- **Mutation.** `simulateTick` mutates `world.bodies` in place; `predict` operates on a shallow copy
  (`physics.ts:443`).

## 3. Frame → tick: the fixed-timestep accumulator

Physics is driven only from `runTicks` (`loop.ts:293-349`), which is called only when
`status === "playing"` (`loop.ts:493-495`). Given a raw wall-clock frame delta $\delta$ in seconds:

$$
\delta' = \min\bigl(\max(\delta, 0),\ M \Delta t\bigr), \qquad M = 8 \quad
\text{(`loop.ts:467`, `loop.ts:125`, `loop.ts:131`)}
$$

$$
A \mathrel{+}= \delta' \quad \text{(`loop.ts:294`)}
$$

Then ticks are drained while

$$
A \ge \Delta t - \varepsilon_A \quad\text{and}\quad n_{\text{frame}} < M
\qquad \text{(`loop.ts:297-300`)}
$$

each iteration doing $A \mathrel{-}= \Delta t$ (`loop.ts:316`). $\varepsilon_A = 10^{-9}$ exists
because $8\Delta t$ accumulated and then drained by eight subtractions of $\Delta t$ lands
$\approx 1.04\times10^{-17}$ short, draining 7 ticks instead of 8 (`loop.ts:145-159`). It is a
float-noise correction, not a physical tolerance.

**Consequence:** simulated time is _dropped_, not caught up, whenever a frame exceeds $8\Delta t
\approx 55.6\ \mathrm{ms}$ (`loop.ts:123-124`). $A$ is also zeroed on pause/resume
(`loop.ts:433`, `loop.ts:440`) and on reset (`loop.ts:246`).

Everything from [§4](#4-one-tick) on is _inside_ one iteration of that drain loop, i.e. one call to
`simulateTick(world, input, {allowInput: true, firstBoostFired})` (`loop.ts:306-309`). The replay
verifier calls the identical function with the identical options, one call per taped tick, with no
accumulator at all (`replay.ts:247-255`).

## 4. One tick

### 4.1 Substep count

Computed **once per tick, from pre-step state, before any substep runs** (`physics.ts:384`); never
recomputed mid-tick. For every body $i$ with $\texttt{type} \ne \texttt{sun}$ and every source
$j \ne i$ with $\mu_j \ne 0$ (`physics.ts:77`, `physics.ts:85`):

$$
d_{ij}^2 = \max\bigl(\lVert \mathbf{r}_i - \mathbf{r}_j \rVert^2,\ \epsilon\bigr), \qquad
  d_{ij} = \sqrt{d_{ij}^2} \quad \text{(`physics.ts:91-96`)}
$$

$$
\alpha_{ij} = \frac{\mu_j\, d_{ij}}{d_{ij}^2 \sqrt{d_{ij}^2}}
  \quad \text{(`physics.ts:96-97`)}
$$

$$
c_i = \lVert \mathbf{v}_i \rVert \quad \text{(`physics.ts:79`)}, \qquad
  B_i = L \quad \text{(`physics.ts:101-104`)}
$$

with $L = \texttt{MIN\_TRAVEL\_RESOLUTION} = 10$ (`constants.ts:18`) now used directly as the travel
budget — it is no longer scaled by a softening radius. Then

$$
N = \operatorname{clamp}\left(
  \max\left(
    N_{\min},\
    \max_{i,j} \left\lceil \frac{\alpha_{ij}\,\Delta t}{G} \right\rceil,\
    \max_{i} \left\lceil \frac{c_i\,\Delta t}{B_i} \right\rceil
  \right),\ N_{\min},\ N_{\max}\right)
  \quad \text{(`physics.ts:87-108`)}
$$

with $N_{\min} = 4$, $N_{\max} = 12$ (`constants.ts:13-14`) and
$G = \texttt{MAX\_GRAVITY\_DV\_PER\_SUBSTEP} = 0.045$ (`constants.ts:17`).

#### The $\Delta t$ in `substepCount` is not a unit conversion

$\alpha_{ij}$ has units $\text{units}/\text{tick}^2$ (§2), so the actual velocity change per substep
is $\alpha_{ij}\sigma = \alpha_{ij}/N$, **not** $\alpha_{ij}\Delta t$. Likewise the distance a body
covers in one substep is $c_i/N$, not $c_i \Delta t$. The implemented criterion is therefore

$$
N \ge \left\lceil \frac{\alpha_{ij}}{144\,G} \right\rceil
  \quad\text{and}\quad
  N \ge \left\lceil \frac{c_i}{144\,B_i} \right\rceil,
$$

i.e. the thresholds behave as if scaled by $1/144$ and are independent of $N$ — the quantity compared
against $G$ is not a per-substep $\Delta v$ in the sim's own units despite the constant's name. This
is a faithful port of `PhysicsEngine.gd:23-26`, which does the same. **It is not a bug to be fixed
here**: $N$ feeds $\sigma$, which scales every body's motion, so changing it changes every
trajectory and invalidates all 33 hand-verified levels (`constants.ts:1-7`). Flagged, not corrected.

#### Anchored bodies still drive $N$

The outer loop of `substepCount` skips **only** suns — it does **not** skip anchored bodies
(`physics.ts:77`), unlike the substep integrator which skips both (`physics.ts:258`). So an anchored
planet, which by construction never moves, still contributes its $c_i$ and its felt $\alpha_{ij}$ to
the maximum, raising $N$ for every other body. Deliberate and documented at `physics.ts:64-69`;
matches `PhysicsEngine.gd:8`.

### 4.2 The substep loop

$$
\text{for } s = 0 \dots N-1:\quad \texttt{advanceRealSubstep}(\text{world}, \sigma)
  \quad \text{(`physics.ts:391-404`)}
$$

$\sigma = 1/N$ is fixed for the whole tick. There is no per-substep adaptivity and no error estimate.

## 5. One substep, in order

`advanceRealSubstep` (`physics.ts:244-294`) iterates bodies in **array index order** and mutates each
one before moving to the next. This is load-bearing: see [§5.6](#56-the-update-is-sequential-not-simultaneous).

For each body $i$ in index order:

### 5.1 Skip rule

$$
\text{skip } i \iff \texttt{type}_i = \texttt{sun} \ \lor\ \texttt{anchored}_i
  \quad \text{(`physics.ts:258`)}
$$

Skipped bodies do not even get their acceleration zeroed, so a sun or anchored planet retains
whatever $\mathbf{a}$ it was last given (in practice $\mathbf{0}$ from `hydrate`, `level.ts:136-137`).

### 5.2 Zero the accumulator

$$
\mathbf{a}_i \leftarrow \mathbf{0} \quad \text{(`physics.ts:260-261`)}
$$

Note the position: **inside** the per-substep body loop. Acceleration is zeroed $N$ times per tick,
not once.

### 5.3 Player input (player only, and only when `allowInput`)

`applyPlayerInput` (`physics.ts:162-220`) runs **before** gravity for that body, on **every substep**
(so $N$ times per tick). Let $c = \lVert \mathbf{v}_p \rVert$ (`physics.ts:174-176`) and

$$
\beta_\sigma = \beta\,\sigma \quad \text{(`physics.ts:177`)}.
$$

State flags, set unconditionally each substep (`physics.ts:171-172`):
$\texttt{isBoosting} \leftarrow b$, $\texttt{isBraking} \leftarrow k$.

**Boost and brake rescale speed; they do not add a vector.**

$$
\mathbf{v}_p \leftarrow
\begin{cases}
\dfrac{c + \beta_\sigma}{c}\,\mathbf{v}_p & b = 1,\ c > 0 \quad \text{(`physics.ts:182-184`)}\\[2ex]
\mathbf{v}_p + (\beta_\sigma, 0) & b = 1,\ c = 0 \quad \text{(`physics.ts:187`)}\\[1ex]
\dfrac{\max(0,\ c - \beta_\sigma)}{c}\,\mathbf{v}_p & b = 0,\ k = 1,\ c > 0 \quad \text{(`physics.ts:193-195`)}\\[2ex]
\mathbf{v}_p & \text{otherwise}
\end{cases}
$$

Three consequences that follow directly from these lines:

1. Direction is exactly preserved; the speed changes by exactly $\pm\beta_\sigma$ per substep. Since
   $\sum_{s} \beta_\sigma = N \cdot \beta/N = \beta$, one full tick of held boost adds exactly
   $\beta = 0.005$ units/tick to _speed_ — but interleaved with gravity, which changes both the
   speed and the direction that the next substep's boost preserves.
2. Braking is **clamped, not signed**: once $c \le \beta_\sigma$ the velocity becomes exactly
   $\mathbf{0}$, and every later braking substep is a no-op via the $c>0$ guard. The ship cannot be
   pushed backwards by braking.
3. Boost wins over brake — it is `else if` (`physics.ts:192`), never both.
4. The $c = 0$ boost branch is **asymmetric in $x$ and $y$** by construction: it adds $\beta_\sigma$
   to $v_x$ only and leaves $v_y$ untouched (`physics.ts:186-187`). A ship starting exactly at rest
   therefore always launches in $+x$. Faithful to `PhysicsEngine.gd:126`.

**Directional thrust.** With $\mathbf{u} = (u_x, u_y)$ and $\ell = \lVert \mathbf{u} \rVert$:

$$
\mathbf{a}_p \mathrel{+}= \tau\,\frac{\mathbf{u}}{\ell}
  \quad\text{if } \mathbf{u} \ne \mathbf{0} \ \land\ \ell > 0
  \quad \text{(`physics.ts:203-213`)}
$$

$\tau = 0.0$ (`constants.ts:23`), so **this term is identically zero today**. It is retained because
it still sets the `thrusting` flag:

$$
\texttt{thrusting} = b \lor k \lor (\mathbf{u} \ne \mathbf{0}) \quad \text{(`physics.ts:217`)}
$$

which is a HUD/audio signal, not a force. `firstBoostTriggered` fires on the first substep on which
$b=1$ while `firstBoostFired` is false (`physics.ts:189-191`), and is latched upward across substeps
inside the tick (`physics.ts:266-269`, `physics.ts:400-403`).

**Where $\mathbf{u}$ comes from** (`input.ts:369-372`):

$$
u_x = [\texttt{thrustRight}] - [\texttt{thrustLeft}], \qquad
  u_y = [\texttt{thrustDown}] - [\texttt{thrustUp}]
$$

with $[\cdot]$ the Iverson bracket on "key held". Keyboard only — touch zones are boost/brake
rectangles and never contribute (`input.ts:27-31`). During replay verification $\mathbf{u}$ is
hard-wired to $\mathbf{0}$ (`replay.ts:105-106`), which is sound _only because_ $\tau = 0$: the tape
format records no directional input at all.

### 5.4 Gravity accumulation

For every source $j \ne i$ with $\mu_j \ne 0$ (`physics.ts:272-278`), `applyGravityAcceleration`
(`physics.ts:129-141`) accumulates

$$
\mathbf{d}_{ij} = \mathbf{r}_i - \mathbf{r}_j \quad \text{(`physics.ts:132-133`)}, \qquad
  d_{ij}^2 = \lVert \mathbf{d}_{ij} \rVert^2 \quad \text{(`physics.ts:134`)}
$$

If $d_{ij}^2 \le \epsilon$ the function returns without touching $\mathbf{a}_i$
(`physics.ts:135`) — see the guard note below. Otherwise:

$$
\boxed{\ \mathbf{a}_i \mathrel{-}= \frac{\mu_j\,\mathbf{d}_{ij}}{d_{ij}^2\,\sqrt{d_{ij}^2}}\ }
  \quad \text{(`physics.ts:137-140`)}
$$

The displacement points **away** from the source and the term is **subtracted**; that pair is what
makes this attraction (`physics.ts:118-123`). Magnitude:

$$
\lVert \mathbf{a}_{i \leftarrow j} \rVert = \frac{\mu_j}{d_{ij}^2}
$$

This is **pure inverse-square gravity** — $\mu/d^2$, not Plummer softening. There is no pair-dependent
softening radius and no dependence on $s_i$ or $s_j$ anywhere in the force law; `Body.size` is used
only for rendering (§10). There is no reciprocal reaction anywhere in the code: $\mathbf{a}_j$ is
untouched, so Newton's third law does not hold even in form.

Because there is no softening floor, $d_{ij}^2$ can be arbitrarily small, and the guard
`if (distSq <= EPS_DIST_SQ) return;` (`physics.ts:135`) is **load-bearing**, not vestigial: without
it, a body passing through a source's exact position divides by $0$ and produces `NaN`. A body
passing arbitrarily close (but not exactly through) a source receives an arbitrarily large
acceleration for that substep — there is still no collision response (§10), so trajectories through
near-zero distance are effectively chaotic, bounded only by `MAX_GRAVITY_DV_PER_SUBSTEP`'s effect on
`substepCount` (§4.1), not by any cap on the force itself.

The guard $\mu_j = 0 \Rightarrow$ no-op appears twice — in the caller loop (`physics.ts:276`) and
inside the function (`physics.ts:130`). The inner one is a port addition required by the frozen
interface; Godot has only the caller's. Mathematically a no-op either way.

In every built-in level the player has $\mu = 0$ (all 33; suns and planets all have $\mu \ne 0$), so
**the player attracts nothing**. That is a property of the data, not of the code — a custom level
giving the player a nonzero $\mu$ would make it a gravity source with no code change.

### 5.5 Integration

$$
\mathbf{v}_i \leftarrow \mathbf{v}_i + \mathbf{a}_i\,\sigma \quad \text{(`physics.ts:280-281`)}
$$

$$
\mathbf{r}_i \leftarrow \mathbf{r}_i + \mathbf{v}_i\,\sigma \quad \text{(`physics.ts:282-283`)}
$$

Velocity first, then position from the **new** velocity: **semi-implicit (symplectic) Euler**, first
order. It is not explicit Euler (which would use the old $\mathbf{v}$), not velocity-Verlet (no
half-kick, no second force evaluation), and not any RK scheme (one force evaluation per substep, no
stage weights). The scheme's usual symplectic guarantees do **not** transfer here, because the
system it integrates is not conservative in the required sense: forces are one-sided (§5.4), the
update is sequential (§5.6), and boost/brake rescale velocity mid-step (§5.3).

There is **no drag, no damping, and no friction term of any kind** anywhere in the integrator. There
is no mass: $\mathbf{a}$ is an acceleration and every body responds to it identically.

### 5.6 The update is sequential, not simultaneous

The body loop mutates $\mathbf{r}_i$ and $\mathbf{v}_i$ in place before iterating to $i+1$
(`physics.ts:255-291`), while the inner force loop reads `bodies[sourceIndex]` live
(`physics.ts:272-277`). Therefore body $i$ feels sources $j < i$ at their **already-advanced**
positions for this substep, and sources $j > i$ at their **pre-substep** positions:

$$
\mathbf{a}_i^{(s)} = -\sum_{j<i} \frac{\mu_j\bigl(\mathbf{r}_i^{(s)} - \mathbf{r}_j^{(s+1)}\bigr)}{(\cdot)^{3/2}}
  \;-\; \sum_{j>i} \frac{\mu_j\bigl(\mathbf{r}_i^{(s)} - \mathbf{r}_j^{(s)}\bigr)}{(\cdot)^{3/2}}
$$

This is a Gauss–Seidel sweep, not the Jacobi (simultaneous) update the notation
"$\mathbf{a}_i = \sum_j \dots$" would normally imply. **The result depends on the order of
`Level.objects` in the level JSON.** Faithful to `PhysicsEngine.gd:40-68`, which loops and mutates
the same way.

### 5.7 Planet spin (visual only)

$$
\theta_i \leftarrow \theta_i + \frac{\pi}{180}\,\omega_i\,\sigma
  \quad\text{if } \texttt{type}_i = \texttt{planet}
  \quad \text{(`physics.ts:288-290`, `physics.ts:50`)}
$$

Nothing reads $\theta$ back into a force or velocity (`types.ts:71`). $\omega_i$ itself is a port
divergence: Godot draws `randf_range(-3.0, -2.0)` per body per load, which `packages/core` may not do
(no RNG by contract), so it is replaced by the deterministic

$$
\omega_i = -2.0 - \bigl((0.37\,i) \bmod 1\bigr) \quad \text{(`level.ts:69-71`)}
$$

landing in the same $(-3, -2]$ band. Since nothing reads $\theta$, this cannot affect trajectories.

## 6. After the substep loop, still inside the tick

Evaluated once per tick, unconditionally, after all $N$ substeps (`physics.ts:406-421`):

$$
\texttt{reachedGoal} = \bigl\lVert \mathbf{r}_p - \mathbf{r}_g \bigr\rVert \le r_g
  \quad \text{(`physics.ts:413-416`)}
$$

with $r_g = \texttt{world.goalRange}$ from the level's `goal.range` (52–74 across the built-ins,
`level.ts:124-125`). This is a **plain circle test on the post-tick position** — there is no swept
test, so a sufficiently fast player can tunnel through the goal annulus between ticks without
triggering it.

$$
\texttt{outOfBounds} = |x_p| > X_{\max} \ \lor\ |y_p| > Y_{\max}
  \quad \text{(`physics.ts:418-420`)}
$$

with $X_{\max} = 2600$, $Y_{\max} = 1800$ (`constants.ts:36-37`).

**Documented divergence from Godot** (`physics.ts:342-349`): the reference measures bounds relative
to a `world_origin` that is reset to half the _viewport size_ every render frame — a
window-size-dependent quantity with no place in a browser-free module. This port treats
$X_{\max}, Y_{\max}$ as half-extents about the **fixed** origin $(0,0)$. Consequently the bounds box
is a fixed rectangle here and a viewport-dependent one in Godot; the two do not agree in general.

## 7. Per-tick work done by the loop, outside `simulateTick`

Inside the same drain iteration (`loop.ts:301-340`), in order:

1. `input.poll()` — one sample per tick, before the tick (`loop.ts:301`).
2. Tape recording, and $\texttt{boostTicks} \mathrel{+}= b$ (`loop.ts:303-304`).
3. `simulateTick` (§4–§6).
4. Player visual angle, from the **post-tick** velocity, via `rocketAngleFromVelocity`
   (`loop.ts:326`, `physics.ts:371-377`) — see the equation below the list.
5. Trail sampling, capped at `TRAIL_LENGTH` = 5000 (`loop.ts:328-331`).
6. Goal capture → `completeAttempt()` and `break` out of the drain loop (`loop.ts:333-336`).
7. Bounds warning arming, per simulated tick (`loop.ts:338-340`).

The angle in step 4:

$$
\theta_p = \begin{cases}
0 & v_{x,p}^2 + v_{y,p}^2 \le 10^{-6}\\
\operatorname{atan2}(v_{y,p}, v_{x,p}) + \dfrac{\pi}{2} & \text{otherwise}
\end{cases}
\quad \text{(`physics.ts:371-377`)}
$$

The $+\pi/2$ is because the sprite art points up: rotating $(0,-1)$ by
$\operatorname{atan2}(v_y,v_x) + \pi/2$ gives the unit velocity (`physics.ts:358-365`). The test is
on squared length, so the dead zone is $\lVert\mathbf{v}\rVert \le 10^{-3}$, not $10^{-6}$. It is
cosmetic, and callers that use `simulateTick` directly (e.g. `verifyReplay`) never set it.

## 8. Bounds warning and forced reset (mixed tick/frame rate)

$$
R(x,y) = \max\left(\frac{|x|}{X_{\max}},\ \frac{|y|}{Y_{\max}}\right) \quad \text{(`bounds.ts:51-56`)}
$$

$$
W(R) = \operatorname{clamp}\!\left(\frac{R - R_0}{1 - R_0},\ 0,\ 1\right),\quad R < R_0 \Rightarrow W = 0,
\qquad R_0 = 0.8 \quad \text{(`bounds.ts:63-68`, `constants.ts:38`)}
$$

Arming is per **simulated tick** (`loop.ts:339`, `bounds.ts:77-83`):

$$
R > 1 \ \land\ T_w \le 0 \ \Rightarrow\ T_w \leftarrow 0.65\ \mathrm{s}; \qquad
R \le 1 \ \Rightarrow\ T_w \leftarrow 0
$$

Decrement is per **rendered frame** with the clamped wall-clock $\delta'$ (`loop.ts:343-348`,
`bounds.ts:90-94`):

$$
T_w \leftarrow \max(0,\ T_w - \delta'), \qquad T_w \le 0 \Rightarrow \text{hard reset}
$$

The mixed rate is deliberate and mirrors Godot, where arming lives in `_physics_tick` and the
decrement in `_process` (`bounds.ts:14-18`). Re-arming while already counting is suppressed on
purpose, so the grace period is not extended by staying out.

**Asymmetry worth knowing:** the game loop never reads `TickResult.outOfBounds` at all (it is
consumed only by `verifyReplay`, `replay.ts:261-269`). In-game an excursion is survivable for 0.65 s;
during server-side verification the identical trajectory is rejected on the first tick outside the
box. Both use the same rectangle, so a run that legitimately dips out and returns is playable but
unverifiable.

## 9. Prediction (the trajectory overlay)

`predict` (`physics.ts:442-502`) never mutates the world: it shallow-copies every body
(`physics.ts:443`; sound because every `Body` field is a primitive). Let $m$ = count of non-sun
bodies and $q$ = count of planets (`physics.ts:447-450`).

$$
T = \begin{cases}
\lfloor P/2 \rfloor & m > 6\\
\lfloor 2P/3 \rfloor & 4 < m \le 6\\
P & m \le 4
\end{cases}
\qquad P = \texttt{PREDICTION\_TICKS} = 1000 \quad \text{(`physics.ts:452-458`, `constants.ts:45`)}
$$

Written in the code as two **independent** `if`s, not `if/else` — the $m>6$ case overwrites from the
constant rather than chaining off the $2/3$ result. The piecewise form above is what those two
statements compute; it matches `PhysicsEngine.gd:184-188`.

$$
\Sigma_{\text{planet}} = \Sigma \cdot (q > 2 \,?\, 2 : 1), \qquad \Sigma = \texttt{PREDICTION\_STRIDE} = 5
\quad \text{(`physics.ts:460`, `constants.ts:46`)}
$$

The shadow substep (`physics.ts:302-324`) is §5 with §5.3 and §5.7 removed: no input, no angle. $N$
is computed **once, from the initial shadow state** (`physics.ts:461`) and held fixed for all $T$
ticks — over a 1000-tick horizon the state can drift far from the configuration that chose $N$.
Samples are taken **after** advancing, so index $0$ of a track is the state one tick in, never the
current position:

$$
\text{player sample at ticks } t \equiv 0 \pmod{\Sigma} \quad \text{(`physics.ts:481-487`)}, \qquad
\text{planet samples at } t \equiv 0 \pmod{\Sigma_{\text{planet}}} \quad \text{(`physics.ts:489-498`)}
$$

The player sampler pushes one point per body of type `player` (`physics.ts:483-485`), so a level with
two players would interleave both into a single polyline. `hydrate` takes the first player as
`playerIndex` (`level.ts:119`) and does not forbid a second.

Prediction is recomputed at most every frame and skipped every other frame when $m > 3$
(`loop.ts:358-368`) — a rendering cadence, with no effect on the simulation.

## 10. What the engine does not contain

Stated explicitly because their absence is easy to mistake for an omission in this document:

- **No collision detection or response of any kind.** `grep -i collision packages/core/src` is empty,
  as is the equivalent search of the Godot reference. Bodies pass through one another; `Body.size`
  is used only for rendering. Nothing "bounces", and nothing is destroyed on contact. The only
  failure state is leaving the bounds rectangle (§8), and the only success state is the goal circle
  (§6). Combined with unsoftened gravity (§5.4), a body passing arbitrarily close to a source is not
  clamped, deflected, or destroyed — it simply receives an arbitrarily large kick.
- **No drag, damping, friction, or terminal-velocity clamp.** The only speed-modifying terms are
  gravity and boost/brake.
- **No mass, no momentum, no reaction forces.** $\mu$ is a gravitational parameter attached to a
  source (`types.ts:26`); a body's own $\mu$ never affects how it responds.
- **No conservation of anything.** Boost/brake inject and remove speed; forces are one-sided.
- **No wall-clock time in the simulation.** Only the accumulator (§3) and the bounds/flash timers
  (§8) read $\delta$; `packages/core` reads no clock and no RNG (`PROJECT.md §4`).

## 11. Departures, approximations, and oddities

Collected, each traceable to a line:

| #   | What                                                                                                                                                                           | Where                                       | Status                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| 1   | $\Delta t$ multiplies a per-tick² acceleration in `substepCount`; the compared quantity is not a per-substep $\Delta v$ and is $N$-independent                                 | `physics.ts:98`, `physics.ts:103`           | Faithful port of `PhysicsEngine.gd:23-26`; must not be "fixed" |
| 2   | Anchored bodies (which never move) still raise $N$ for everyone                                                                                                                | `physics.ts:77` vs `physics.ts:258`         | Faithful port, deliberate (`physics.ts:64-69`)                 |
| 3   | Sequential (Gauss–Seidel) body update ⇒ result depends on level object order                                                                                                   | `physics.ts:255-291`                        | Faithful port                                                  |
| 4   | Gravity is pure inverse-square ($\mu/d^2$), unsoftened; a body at exact overlap is guarded against `NaN`, but near-overlap kicks are unbounded, and there is no reaction force | `physics.ts:129-141`                        | Owner-directed departure from the Godot reference (S3's form)  |
| 5   | Boost/brake **rescale** speed rather than adding a vector; brake clamps at exactly $\mathbf{0}$                                                                                | `physics.ts:182-195`                        | Faithful port                                                  |
| 6   | Boost from exact rest pushes $+x$ only                                                                                                                                         | `physics.ts:186-187`                        | Faithful port                                                  |
| 7   | $\tau = 0$: WASD contributes no acceleration but still sets `thrusting`                                                                                                        | `constants.ts:23`, `physics.ts:217`         | Live in code, inert in effect                                  |
| 8   | Bounds measured from fixed origin $(0,0)$; Godot measures from a per-frame viewport centre                                                                                     | `physics.ts:342-349`, `bounds.ts:8-13`      | **Deliberate divergence**, documented in-source                |
| 9   | `turnSpeed` deterministic rather than `randf_range(-3,-2)`                                                                                                                     | `level.ts:53-71`                            | **Deliberate divergence** (determinism contract)               |
| 10  | Distance epsilon guard is reachable and load-bearing (no softening floor); prevents `NaN` at exact overlap                                                                     | `physics.ts:135`                            | Necessary consequence of removing softening                    |
| 11  | Second $\mu_j = 0$ guard inside `applyGravityAcceleration` that Godot lacks                                                                                                    | `physics.ts:130`                            | Port addition required by frozen interface; no-op              |
| 12  | Prediction's $N$ fixed from the initial state for up to 1000 ticks                                                                                                             | `physics.ts:461`                            | Faithful port                                                  |
| 13  | Prediction horizon written as two independent `if`s, not `if/else`                                                                                                             | `physics.ts:452-458`                        | Faithful port, deliberately noted in-source                    |
| 14  | Goal test is an unswept circle test on post-tick position ⇒ tunnelling possible                                                                                                | `physics.ts:413-416`                        | Faithful port                                                  |
| 15  | Loop ignores `TickResult.outOfBounds`; the verifier fails on it immediately                                                                                                    | `loop.ts:333-340` vs `replay.ts:261-269`    | Behavioural asymmetry between play and verification            |
| 16  | Accumulator drops simulated time past $8\Delta t$ per frame; $\varepsilon_A = 10^{-9}$ float-noise tolerance                                                                   | `loop.ts:125`, `loop.ts:159`, `loop.ts:297` | Port-local choice, documented in-source                        |
| 17  | Player `size` defaults to 10 for all types, where Godot defaults per type (sun 18, player 12)                                                                                  | `level.ts:87-93`, `constants.ts:32`         | Divergence with no effect on built-in data (see note)          |
| 18  | Rocket-angle dead zone is on squared speed, so the threshold is $10^{-3}$, not $10^{-6}$                                                                                       | `physics.ts:375`                            | Faithful port                                                  |

On #17: every built-in player object omits `size` and no sun or planet ever does, so on the shipped
data the divergence is unobservable. `Body.size` no longer feeds gravity at all (#4), so this
divergence is now purely cosmetic (rendering radius only) rather than physics-affecting.

## 12. Ambiguities — things this document will not clean up

- **Is `MAX_GRAVITY_DV_PER_SUBSTEP` meant to be a $\Delta v$?** The name says yes; the arithmetic
  (`physics.ts:98`) says the compared quantity is $\alpha\Delta t$, which is neither a per-substep
  nor a per-tick velocity change in the sim's units. Whether the original author intended velocity
  to be per-second (making $\Delta t$ correct and the integrator's $\sigma$ wrong) or per-tick
  (making $\Delta t$ a stray factor of $1/144$) cannot be determined from either source tree. Both
  readings reproduce identical numbers, so nothing observable depends on resolving it.
- **The $\epsilon$ floor in `substepCount`'s `distance`.** `physics.ts:93-96` clamps $d_{ij}^2$ to
  $\epsilon$ before both the numerator and the $d^3$ denominator, so (unlike before softening was
  removed) the two are now clamped consistently — this floor is what keeps the substep estimate
  finite at $d=0$, mirroring the load-bearing guard in `applyGravityAcceleration` (§5.4, #10).
- **`isBoosting`/`isBraking` are never cleared** when `allowInput` is false or for a body that stops
  being the player. They are set only inside `applyPlayerInput` (`physics.ts:171-172`). No consumer
  in this repo currently depends on that, but the fields are not guaranteed fresh.
- **`predict` with more than one player body** produces a single interleaved track
  (`physics.ts:483-485`). Whether that is a supported configuration is not stated anywhere; the
  editor and `hydrate` do not forbid it.
