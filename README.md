# D:\Apps\traveller

> traveller project — gstack-installed, ZCode-ready, parallel-development worktree ready.

## What's here

- **`.gstack/`** — git submodule pointing at [`garrytan/gstack`](https://github.com/garrytan/gstack) (v1.58.3.0). The gstack engineering productivity stack: 53+ skills for office-hours, qa, review, ship, browse, design, plan-*, etc.
- **`.gitignore`** — excludes regenerable gstack state, archives, and OS / editor noise.
- **`.gitmodules`** — points `.gstack/` at upstream.

## gstack state (NOT tracked by git)

Per `.gitignore`, the following gstack state lives inside `.gstack/state/` but is **excluded** from the parent repo because it is regenerable, per-user, and ephemeral:

- `state/sessions/` — session mtime files (created by `office-hours` preamble).
- `state/analytics/` — `skill-usage.jsonl` event log.
- `state/.gstack/{sessions,analytics,projects,slug-cache}/` — same, but created by the newer gstack versions.
- `state/developer-profile.json` — accumulated founder signals.
- `state/.office-hours-e2e-evidence.log` — the human-readable office-hours evidence log.
- `state/.gstack-verify-final.{log,json}` — verifier audit output (34/34 PASS).
- `state/.archive/` — archived legacy task artifacts (oh-*.sh, sandbox-homes, .verify.log).
- `hooks/` — ZCode SessionStart hook (gstack bin/ gstack-state-root-override, gstack-redirect, etc.).
- `.verify.log` — script-level verification history (202 lines).
- `.zcode-discover.log` — plugin-loader simulation output.

**To regenerate after a fresh clone:**

```bash
git clone <this repo> traveller
cd traveller
git submodule update --init --recursive
# Optional: re-run the office-hours skill once to repopulate state/
# (or run any gstack skill, which writes to its own .gstack/state/)
```

## Branches & worktrees

Four worktrees, all branching from the same initial commit:

| Worktree | Branch | Purpose |
|---|---|---|
| `D:\Apps\traveller` (this) | `main` | stable / release / default |
| `D:\Apps\traveller.dev` | `dev` | integration / staging |
| `D:\Apps\traveller.feature-alpha` | `feature/alpha` | first parallel feature |
| `D:\Apps\traveller.feature-beta` | `feature/beta` | second parallel feature |

`git worktree list` shows the full set.

## Verification

The `gstack-verify-final.ps1` script (outside this repo, in `%TEMP%`) reads the
`gstack` plugin cache, the developer's `~/.claude/skills/` symlinks, and
`D:\Apps\traveller\.gstack\state\` to confirm:

- 51 gstack skills are discoverable from `~/.claude/skills/`
- 53 gstack skills are discoverable from the ZCode plugin cache
- 34/34 verification checks pass: Phase 2B Q1-Q6, Phase 4.5 signals, Phase 6
  closing, design doc sections, 4 gstack bin/ scripts executed, zero
  user-global pollution.

## Pollution contract

- `%USERPROFILE%\.gstack\` (Windows user-global) — **NOT created**.
- `/home/zhang/.gstack/` (WSL user-global) — **NOT modified** by any of our work.
- `/mnt/c/Users/zhang/.gstack/` (Windows-from-WSL) — **NOT modified**.
- All gstack state writes go to `D:\Apps\traveller\.gstack\state\`.

This was confirmed by `C30-C34` in the verifier audit.
