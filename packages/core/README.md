# @coggit/core

CogGit core kernel: source/cognition freshness semantics, registry, snapshot,
status, and operations. Runtime-agnostic — filesystem, config, and registry
access come in through port contracts you implement.

## Install

```sh
npm install @coggit/core
```

## Minimal usage

```ts
import { createCoggitServices, discoverCoggitProjects, statusOperation } from '@coggit/core';

// Assemble the kernel against your runtime's port implementations.
const services = createCoggitServices({
  fs: myFileSystem,        // implements the FileSystem port
  config: myConfig,        // implements the ConfigProvider port
  registry: myRegistry,    // RegistryProviderFactory
  logger: myLogger,        // optional
  locks: myLocks,          // optional
});

const projects = await discoverCoggitProjects(services);
const result = await statusOperation(projects, 'src/main.ts');
```

Node host? Use [`@coggit/runtime-node`](../runtime-node/README.md), which
ships ready-made local-filesystem adapters and
`createNodeCoggitServices`.

## Surface notes

- The `.` export is the public contract (see `src/public.ts`).
- `@coggit/core/internal` is a trusted-consumer face used by the published
  `coggit` CLI; it ships in the tarball but carries **no stability promise**
  for third parties.

Architecture, concepts, and workflow docs live in the
[repository root](https://github.com/CatheadOwl/coggit#readme).
