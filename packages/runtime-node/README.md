# @coggit/runtime-node

CogGit Node runtime: local-filesystem, config, registry, lock, and URI
adapters for the [`@coggit/core`](../core/README.md) kernel, plus the Node
service composition root.

## Install

```sh
npm install @coggit/runtime-node
```

## Minimal usage

```ts
import { createNodeCoggitServices } from '@coggit/runtime-node';
import { statusOperation } from '@coggit/core';

// Local-filesystem adapters wired for you (fs, config, registry, locks).
const services = createNodeCoggitServices({ workspacePath: process.cwd() });

const result = await statusOperation(services, { sourcePath: 'src/main.ts' });
```

The individual adapters (`NodeFileSystem`, `NodeConfigProvider`,
`NodeProjectLockManager`, `NodeRegistryProviderFactory`) are also exported if
you need to assemble or extend the service graph yourself.

## Surface notes

- The `.` export is the public contract (see `src/public.ts`).
- `@coggit/runtime-node/internal` additionally exposes the watcher observer
  and watch-lease primitives; it is a trusted-consumer face used by the
  published `coggit` CLI and carries **no stability promise** for third
  parties. The v1 public surface is reconcile-on-read.

Architecture, concepts, and workflow docs live in the
[repository root](https://github.com/CatheadOwl/coggit#readme).
