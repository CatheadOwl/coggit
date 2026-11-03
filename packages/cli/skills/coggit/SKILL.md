---
name: coggit
description: manually — dispatch SOP for the `coggit` CLI
metadata:
  author: coggit
---

# coggit · dispatch SOP for the `coggit` CLI

Use when asked to set up CogGit in a project, or to drive its cognition loop
(orient / author / maintain) from a CLI agent host. This face owns the
everyday loop; the one-time operations — setting a project up, refreshing
the installed guidance after an upgrade — live in
[references/setup.md](references/setup.md). Three things deliberately do not
live anywhere in this tree and are printed by the tool itself:

- **Stance** (how to behave inside a CogGit project): `coggit entry` prints
  it; installing that output is the end of the set-up dance.
- **Command mechanics** (flags, arguments): `coggit --help` and
  `coggit <command> --help`.
- **Authoring rules** for a cognition document: `coggit handbook <kind>`.

Once a project carries the entry guidance, this skill is nearly inert — the
installed block carries the working stance; come back here only for the
sequences.

## Decision points

| Decision | Clause |
|---|---|
| Is this already a CogGit project? | `coggit status` — the header names the source and cognition roots. A non-project fails loud → [references/setup.md](references/setup.md). |
| Orient inside a project | The installed entry block is the orientation; `coggit status <path>` names one file's paired cognition document, `coggit snapshot` is the coverage overview. Nothing further here. |
| Author a cognition document | `coggit add <path>` (kind `auto`: file → leaf, folder → skeleton) → fill it following `coggit handbook <kind>` → `coggit status <path>` to verify the pair. Independent source paths are subagent-sized: brief each with its path, the kind, and the handbook text. |
| Maintain after a code change | `coggit status <path>` → update the paired document → `coggit status <path>` again. `coggit resolve <path>` clears a registered issue after re-verification; `coggit orphans` lists cognition whose source is gone. |

**Payload.** The directory containing this file is the whole install unit — copy or link the subtree as-is (never SKILL.md alone); the package never writes an agent directory. Install/refresh reconciliation contract (version stamps, tool-owned vs operator-reserved keys, conflict handling): [references/payload.md](references/payload.md).

## Scope

Drives the published `coggit` CLI only. The VS Code extension and the MCP
server inject their own guidance and need none of this. Out of scope: working
on the coggit codebase itself — that is a development task, not a dispatch.
