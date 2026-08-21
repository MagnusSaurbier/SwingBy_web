# Agent status

Snapshot collected from each agent's own `notes/agent-status/<branch>.md`, self-reported at the
point each was interrupted. **Not live** - re-collect from the branches once work resumes.

`Head (self)` is the SHA the agent named in its own file; `Head (actual)` is the branch tip now.
They differ where the agent committed its status file after writing it - expected, not a fault.

| Branch | State | Head (self) | Head (actual) | Building |
|---|---|---|---|---|
| [`feat/edit-current-level`](./agent-status/edit-current-level.md) | ready for review | `c2d73d6` | `c8bc009` | Open the currently played level in the level editor, via a rebindable modifier-chord hotkey (default ⌥⌘E) and an "Edit this level" button in the paused in-game menu. |
| [`feat/editor-canvas-interaction`](./agent-status/editor-canvas-interaction.md) | blocked | `ab2486e` | `f16359c` | Editor canvas interaction — size handle follows the cursor, and the placement ghost appears from the moment a Place tool is armed. |
| [`chore/agent-status-orchestrator`](./agent-status/orchestrator.md) | implementing (coordinating; three workers live) | `e078c44` | `24af3e1` | Orchestrator - reviews worker plans, gates them, re-runs all gates, merges to main. |
| [`feat/brake-flip-burn`](./agent-status/brake-flip-burn.md) | surveying | `5982dda` | `1b64dc1` | Make braking count toward the boost highscore, and make the brake an instant flip-and-burn (ship flips, boost flame shows, boost sound plays). |
| [`feat/remove-gravity-softening`](./agent-status/remove-gravity-softening.md) | surveying | `24208d2` | `e9dbd35` | Remove the Plummer gravity-softening term rho from the physics core entirely, per the owner's request. |

Full detail per agent in [`notes/agent-status/`](./agent-status/).

