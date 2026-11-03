---
description: Install/refresh reconciliation contract for the coggit skill tree — the canon site the SKILL.md payload core points to; version stamps, frontmatter ownership, refresh precedence, conflict handling
---

# Payload & reconciliation

Canon site for this skill tree's install/refresh contract: the SKILL.md
payload core points here, and this file is the whole contract. The wording
is the cross-tool standard, adapted where this tree differs — the version
source is the announce (`coggit skills`), so the shipped tree carries no
version literal of its own.

**Payload & reconciliation.** The skill root — the directory containing
SKILL.md — is the whole install unit: copy or link the subtree as-is;
sibling files (e.g. `references/`) ride along. Method and destination are
the installing agent's choice; the announce subcommand only locates this
tree and never writes an agent directory. When installing a copy, stamp it
with the announced version (frontmatter `metadata.payload-version`; update
the stamp on refresh). On refresh, everything in the subtree follows this
tree — body, files, and tool-owned frontmatter (`name`, `description`, plus
any key declared tool-owned below) — except operator-reserved frontmatter
keys (invocation policy such as `disable-model-invocation`, and every key
not declared tool-owned), which belong to the host and survive refresh. A
tool-owned key that differs while `metadata.payload-version` equals the
announced version was changed locally: ask the operator; if you cannot ask
(unattended dispatch), stop and report without writing. Re-run the announce
after an upgrade and compare before reconciling.

## Frontmatter ownership

- tool-owned, follows this tree on refresh: `name`, `description`
- operator-reserved, belongs to the host and survives refresh: every other
  top-level key — invocation policy such as `disable-model-invocation`, and
  every undeclared key
- `metadata.*`: extension namespace, writable by both sides; the installing
  agent's bookkeeping key `payload-version` lives here

The SKILL.md frontmatter stays pure key-value with zero comments — the
ownership taxonomy lives here, not on the machine face.
