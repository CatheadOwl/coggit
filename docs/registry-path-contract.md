# Registry Path Contract

This document is the source of truth for path-like fields in CogGit registry
metadata and adapter-facing operation DTOs.

## Terms

| Term | Anchor | Meaning |
| --- | --- | --- |
| `registry key` | cognition root | Path-shaped identity derived from a tracked cognition file. It is the key in `RegistryFile.entries`, not a general source path. |
| `PathKeyRecord.sourcePath` | project root | Durable source binding stored in `.coggit/registry.json`, relative to the directory containing `.coggit/`. |
| `toolSourcePath` | source root | Source path suitable for CogGit tools and adapter DTOs, such as `coggit_status`, `coggit_add`, `statusOperation`, and `snapshotOperation`. |
| `cognitionPath` | cognition root | Path to a cognition Markdown file for operation DTOs and route entries. |

Do not collapse these fields into a generic `sourcePath` outside the narrow
context where the receiving API already defines its anchor.

## Registry Keys

Registry keys are cognition-root-derived identities:

- Leaf cognition `<path>/<file>.<ext>.md` maps to key `<path>/<file>.<ext>`.
- Folder cognition `<path>/README.md` maps to key `<path>/`.
- Root cognition `README.md` maps to key `/`.

The key preserves the mirrored cognition artifact name. It is path-shaped so it
sorts and reconciles naturally, but callers must not treat it as a filesystem
path or assume it equals a source lookup key.

## Registry Source Binding

`PathKeyRecord.sourcePath` stores the bound source file or folder as a
project-root-relative path.

This keeps registry metadata anchored to the `.coggit/registry.json` project
boundary. It also lets the registry preserve bindings when the configured
source root is not `.`.

Example when `.coggit/config.yaml` contains `sourceRoot: codebase`:

```json
{
  "entries": {
    "coggit/packages/core/src/registryTypes.ts": {
      "sourcePath": "codebase/coggit/packages/core/src/registryTypes.ts",
      "type": "leaf"
    }
  }
}
```

## Tool Paths

CogGit tools and operation DTOs should use source-root-relative paths. For the
example above, the tool-facing path is:

```text
coggit/packages/core/src/registryTypes.ts
```

Route DTOs that need both meanings must name both fields explicitly:

- `projectRelativeSourcePath` for raw registry storage.
- `toolSourcePath` for source-root-relative tool calls.

If a registry source binding cannot be converted to a source-root-relative tool
path, keep the registry value but do not emit tool-specific actions for that
entry.

## Maintenance Model

`PathKeyRecord.sourcePath` is the last known durable binding, not a live
filesystem truth.

- With a watcher runtime, source moves can update registry bindings
  incrementally.
- Without a watcher runtime, bindings are rechecked on demand during project
  reconciliation, route building, maintenance diagnostics, and explicit source
  resolution.

Maintenance diagnostics should report mismatches through the maintenance/status
surface instead of adding a parallel mismatch section to `RegistryFile`.

## Related

- `packages/core/src/registryTypes.ts` defines the persisted DTO shape.
- `packages/core/src/identity.ts` defines registry key syntax.
- `packages/core/src/cognitionRoutes.ts` projects registry bindings into
  `projectRelativeSourcePath` and `toolSourcePath`.
- `packages/core/src/project.ts` owns reconciliation and source-link recovery.
