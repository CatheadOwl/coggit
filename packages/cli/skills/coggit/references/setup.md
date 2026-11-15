---
description: One-time coggit operations — the project set-up dance (init, entry guidance install, MCP install, verify) and the paste-once contract for the installed guidance
---

# Set-up & paste-once guidance (one-time)

Cold operations, consulted once per project; the
everyday loop (orient / author / maintain) lives on the face
(`../SKILL.md`).

## Set up a project (install dance)

1. `coggit init` — defaults: source root `src`, cognition root
   `<source-root>_cognition`; `--source-root` / `--cognition-root`
   override.
2. Install the guidance: `coggit entry --format block >> AGENTS.md` —
   paste once. The block is invariant-shaped: stance evolution reaches
   agents through the fetch pointer inside it (`coggit entry --kind
   standard`), never through re-pasting. A repo that hosts tool-entry
   commands can declare `coggit entry --kind standard` there instead —
   tool-entry hosts get the full stance fresh every session.
3. Hosts that speak MCP: `coggit mcp install`.
4. Verify: `coggit status` now prints the roots.

## The installed block does not need refreshing

The paste-once layer carries invariant content only (the contract is owned
by core's `systemPrompt.ts` and test-pinned), so stance wording evolution
never touches the block. Re-run `coggit entry --kind minimal --format
block` and replace the whole block (markers included) only if that
contract itself changes — architecture-level events, expected rare. A
standard-shaped block from an older install keeps working; replacing it
with the minimal block is optional and can happen at any time.
