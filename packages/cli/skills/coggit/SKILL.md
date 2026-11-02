---
name: coggit
description: Invoke by name to set up CogGit in a project or drive its cognition loop (orient / author / maintain) from a CLI host; no auto-trigger on the word coggit; not for developing coggit itself.
# Frontmatter ownership (the refresh reconciliation taxonomy; contract in the
# Payload section below):
#   tool-owned        = name, description, plus keys declared tool-owned here
#                       → follow the new tree on refresh
#   operator-reserved = every other top-level key (host policy keys such as
#                       disable-model-invocation / user-invocable, and every
#                       undeclared key) → belong to the host, survive refresh
#   metadata.*        = extension namespace, writable by both sides; the
#                       installing agent's bookkeeping key (payload-version)
#                       lives here. The shipped tree carries no version of its
#                       own — the announce (`coggit skills`) is the version
#                       source, and the stamp is what the installer records.
metadata:
  author: coggit
---

# coggit · dispatch SOP for the `coggit` CLI

Use when asked to set up CogGit in a project, or to drive its cognition loop
(orient / author / maintain) from a CLI agent host. This file owns the
command *sequences* and nothing else — three things deliberately do not live
here and are printed by the tool itself:

- **Stance** (how to behave inside a CogGit project): `coggit entry` prints
  it; installing that output is the end of the set-up dance below.
- **Command mechanics** (flags, arguments): `coggit --help` and
  `coggit <command> --help`.
- **Authoring rules** for a cognition document: `coggit handbook <kind>`.

Once a project carries the entry guidance, this skill is nearly inert — the
installed block carries the working stance; come back here only for the
sequences.

## Decision points

| Decision | Clause |
|---|---|
| Is this already a CogGit project? | `coggit status` — the header names the source and cognition roots. A non-project fails loud → run the set-up dance. |
| Set up (install dance) | 1. `coggit init` (defaults: source root `src`, cognition root `<source-root>_cognition`; `--source-root` / `--cognition-root` override). 2. Install the guidance: `coggit entry --kind standard --format block >> AGENTS.md` on first install; on update, replace the whole marked block instead of appending — the first line inside the block states this rule. A repo that hosts tool-entry commands (e.g. an any-nav `commands` declaration) can declare `coggit entry --kind standard` there instead of pasting a block. 3. Hosts that speak MCP: `coggit mcp install`. 4. Verify: `coggit status` now prints the roots. |
| Orient inside a project | The installed entry block is the orientation; `coggit status <path>` names one file's paired cognition document, `coggit snapshot` is the coverage overview. Nothing further here. |
| Author a cognition document | `coggit add <path>` (kind `auto`: file → leaf, folder → skeleton) → fill it following `coggit handbook <kind>` → `coggit status <path>` to verify the pair. Independent source paths are subagent-sized: brief each with its path, the kind, and the handbook text. |
| Maintain after a code change | `coggit status <path>` → update the paired document → `coggit status <path>` again. `coggit resolve <path>` clears a registered issue after re-verification; `coggit orphans` lists cognition whose source is gone. |
| Refresh the guidance after an upgrade | Re-run the command named in the installed block's first line and replace the whole block (markers included). |

**Payload & reconciliation.** The directory containing this file is the whole install unit — copy or link the subtree as-is; sibling files (e.g. `references/`) ride along. Method and destination are the installing agent's choice; the announce subcommand only locates this tree and never writes an agent directory. When installing a copy, stamp it with the announced version (frontmatter `metadata.payload-version`; update the stamp on refresh). On refresh, everything in the subtree follows this tree — body, files, and tool-owned frontmatter (`name`, `description`, plus any keys the author declares tool-owned) — except operator-reserved frontmatter keys (invocation policy such as `disable-model-invocation`, and every key not declared tool-owned), which belong to the host and survive refresh. A tool-owned key that differs while `metadata.payload-version` equals the announced version was changed locally: ask the operator; if you cannot ask (unattended dispatch), stop and report without writing. Re-run the announce after an upgrade and compare before reconciling.

## Scope

Drives the published `coggit` CLI only. The VS Code extension and the MCP
server inject their own guidance and need none of this. Out of scope: working
on the coggit codebase itself — that is a development task, not a dispatch.
