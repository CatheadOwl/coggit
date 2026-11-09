---
description: One-time coggit operations — the project set-up dance (init, entry guidance install, MCP install, verify) and refreshing the installed guidance after an upgrade
---

# Set-up & refresh (one-time)

Cold operations, consulted once per project or once per upgrade; the
everyday loop (orient / author / maintain) lives on the face
(`../SKILL.md`).

## Set up a project (install dance)

1. `coggit init` — defaults: source root `src`, cognition root
   `<source-root>_cognition`; `--source-root` / `--cognition-root`
   override.
2. Install the guidance:
   `coggit entry --kind standard --format block >> AGENTS.md` on first
   install; on update, replace the whole marked block instead of
   appending — the first line inside the block states this rule. A repo
   that hosts tool-entry commands can declare `coggit entry --kind
   standard` there instead of pasting a block.
3. Hosts that speak MCP: `coggit mcp install`.
4. Verify: `coggit status` now prints the roots.

## Refresh the installed guidance after an upgrade

Re-run the command named in the installed block's first line and replace
the whole block (markers included).
