# CLAUDE.md

Agent behaviour for this repo. `AGENTS.md` governs _what_ work happens and how it is
reviewed; this file governs _how agents write and respond_. Both apply.

## Token-efficiency profiles

Behaviour reference: <https://github.com/drona23/claude-token-efficient>

Vendored here so every agent reads the same text without a network fetch:

| File                                   | Applies to                                      |
| -------------------------------------- | ----------------------------------------------- |
| `.claude/profiles/CLAUDE.universal.md` | everyone, as the base                           |
| `.claude/profiles/CLAUDE.coding.md`    | the orchestrator and every coding worker        |
| `.claude/profiles/CLAUDE.analysis.md`  | the interactive session that talks to the owner |

**Profile assignment is fixed:**

- **Coding profile** - the orchestrator and all coding/worker agents. Code first,
  explanation only when non-obvious. Simplest working solution, no speculative features,
  no abstractions for single-use operations, read before editing. Reviews state the bug,
  show the fix, stop - no compliments, no out-of-scope suggestions. Never speculate about
  a bug without reading the code.
- **Analysis profile** - the interactive session reporting to the owner. Lead with the
  finding. Tables and bullets over prose. Never state a number without a source or
  derivation; if data is missing, say so rather than estimating silently.

**Whoever spawns an agent must feed it its profile file(s) at spawn time.** An agent does
not inherit a profile from its parent.

## Formatting (both profiles)

- No em dashes, smart quotes, or decorative Unicode. Plain hyphens and straight quotes.
- Accented letters and other natural-language characters are fine when content needs them.
- Code output must be copy-paste safe.

## Precedence

Owner instructions override this file. `AGENTS.md` rules on branching, the plan gate,
verification and honesty are not relaxed by any profile: brevity is about wording, never
about skipping a gate, a test, or a disclosure of what was not verified.
