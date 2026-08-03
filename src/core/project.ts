import type { AcceptanceStore, CoggitProject, CoggitServices, ReviewUnchangedResult, SourcePathResolution, UriComponents } from './interfaces';
import type { CoggitLogger } from './logger';
import { warnLog } from './logger';
import type { AcceptedPair, CoggitSnapshot, CoggitTreeNode, CoggitWorkspaceRoot, PathKeyRecord } from './types';
import { cognitionPathToKey, keyToCognitionPath, sourcePathToKey } from './identity';
import { computeCognitionIdentity, computeSourceFactIdentity } from './hash';
import { joinUriPath, uriKey, uriRelativePath } from './uri-utils';
import {
  Registry,
  RegistryRevisionMismatchError,
} from './registry/index';
import { scanCognitionDirectory, reconcileRegistry } from './registry/reconcile';
import { discoverWorkspaceRoots } from './workspace';
import { buildMappingIndex, buildProjectSnapshot, computeFolderFingerprint, folderSourceKey } from './snapshot';
import { buildCognitionRoutes } from './cognitionRoutes';
import { noOpProjectLockManager } from './locks';
import {
  detectMisplacedCognitionEntries,
  detectOrphanedCognitionEntries,
  detectStrayCognitionEntries,
} from './maintenance';
import {
  inferSourceUriCandidatesFromCognitionUri,
  normalizeSourcePathInput,
  toCognitionFileUri,
  toCognitionFolderReadmeUri,
  toRelativeUriPath,
} from './mapping';
import { loadGitignoreRules, isIgnoredByGitignoreRules } from './gitignore';
import { directoryEntryFingerprint } from './directoryEntrySourceFact';
import { isIgnoredSourceStructureEntry } from './sourceStructureIgnore';
import {
  addCognition,
  getCognitionHandbook,
  getCognitionTemplate,
} from './cognition';
import {
  applyRegistrySourceRelocations,
  type RegistrySourceRelocation,
} from './registry/sourceRelocation';
import { projectContextFromRoot } from './projectContext';
import { acceptCurrentPair } from './acceptance';

interface ProjectRuntime {
  readonly registry: Registry | null;
  readonly acceptance: AcceptanceStore | null;
}

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export type RegistryInitFailurePolicy = 'degrade' | 'throw';

export interface CoggitProjectDiscoveryOptions {
  /** How project-open registry reconciliation failures are surfaced. */
  readonly registryInitFailure?: RegistryInitFailurePolicy;
  /** Host-local ordering evidence reused across project runtime rebuilds. */
  readonly runtimeEvidence?: (root: CoggitWorkspaceRoot) => RuntimeAcceptanceEvidence;
}

interface PendingSourceEvidence {
  readonly generation: number;
  readonly identity: AcceptedPair['source'] | null;
}

interface RuntimeEvidenceRecord {
  readonly source: PendingSourceEvidence | null;
  readonly cognitionGeneration: number | null;
}

export class RuntimeAcceptanceEvidence {
  private readonly records = new Map<string, RuntimeEvidenceRecord>();
  private fallbackGeneration = 0;

  normalizeGeneration(generation: number | undefined): number {
    if (generation === undefined) {
      return ++this.fallbackGeneration;
    }
    this.fallbackGeneration = Math.max(this.fallbackGeneration, generation);
    return generation;
  }

  beginSource(key: string, generation: number): void {
    const current = this.records.get(key);
    if (current?.source && current.source.generation > generation) {
      return;
    }
    this.records.set(key, {
      source: { generation, identity: null },
      cognitionGeneration: current?.cognitionGeneration ?? null,
    });
  }

  completeSource(
    key: string,
    generation: number,
    identity: AcceptedPair['source'],
  ): boolean {
    const current = this.records.get(key);
    if (!current?.source || current.source.generation !== generation) {
      return false;
    }
    this.records.set(key, {
      ...current,
      source: { generation, identity },
    });
    return true;
  }

  recordCognition(key: string, generation: number): void {
    const current = this.records.get(key) ?? {
      source: null,
      cognitionGeneration: null,
    };
    if (current.cognitionGeneration !== null
      && current.cognitionGeneration > generation) {
      return;
    }
    this.records.set(key, {
      ...current,
      cognitionGeneration: generation,
    });
  }

  hasSourceBeforeCognition(key: string, pair: AcceptedPair): boolean {
    const current = this.records.get(key);
    return current?.source?.identity === pair.source
      && current.cognitionGeneration !== null
      && current.source.generation < current.cognitionGeneration;
  }

  clear(key: string): void {
    this.records.delete(key);
  }
}

export function createCoggitServices(services: CoggitServices): CoggitServices;
export function createCoggitServices(
  fs: CoggitServices['fs'],
  config: CoggitServices['config'],
  registry?: CoggitServices['registry'],
  logger?: CoggitLogger,
  locks?: CoggitServices['locks'],
): CoggitServices;
export function createCoggitServices(
  fsOrServices: CoggitServices | CoggitServices['fs'],
  config?: CoggitServices['config'],
  registry?: CoggitServices['registry'],
  logger?: CoggitLogger,
  locks?: CoggitServices['locks'],
): CoggitServices {
  if (isCoggitServices(fsOrServices)) {
    return fsOrServices;
  }
  if (!config) {
    throw new Error('Coggit config provider is required');
  }
  return { fs: fsOrServices, config, registry, logger, locks };
}

export async function discoverCoggitProjects(
  services: CoggitServices,
  options: CoggitProjectDiscoveryOptions = {},
): Promise<CoggitProject[]> {
  const roots = await discoverWorkspaceRoots(services.fs, services.config, services.logger);
  return Promise.all(roots.map((root) => openCoggitProject(services, root, options)));
}

export async function openCoggitProject(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  options: CoggitProjectDiscoveryOptions = {},
): Promise<CoggitProject> {
  const runtimeEvidence = options.runtimeEvidence?.(root) ?? new RuntimeAcceptanceEvidence();
  let runtime = await createProjectRuntime(services, root, runtimeEvidence, options);
  const listRegistryMaintenance = async <Entry>(
    detect: (
      root: CoggitWorkspaceRoot,
      fs: CoggitServices['fs'],
      entries: Record<string, PathKeyRecord>,
    ) => Promise<Entry[]>,
  ): Promise<Entry[]> => {
    if (!runtime.registry) {
      return [];
    }

    return detect(root, services.fs, runtime.registry.getAllEntries());
  };

  return {
    root,
    ensureFresh: async () => {
      if (!services.registry) {
        return;
      }
      runtime = await reconcileProjectRuntime(
        services,
        root,
        'project.ensure-fresh',
        runtimeEvidence,
      );
    },
	buildSnapshot: async () => withProjectWriteLock(
		services,
		root,
		'project.build-snapshot',
		async () => {
			let snapshot = await buildProjectSnapshot(root, services.fs, {
				acceptance: runtime.acceptance,
			});
			try {
				await runtime.registry?.flush();
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				snapshot = await buildProjectSnapshot(root, services.fs, {
					acceptance: runtime.acceptance,
				});
				await runtime.registry?.flush();
			}
			return snapshot;
		},
	),
    buildCognitionRoutes: async (options) =>
      buildCognitionRoutes(
        root,
        services.fs,
        runtime.registry,
        projectContextFromRoot(root),
        options,
      ),
	addCognition: async (sourcePath, options) => withProjectWriteLock(
		services,
		root,
		'project.add-cognition',
		async () => {
			try {
				return await addCognition(root, services.fs, runtime.registry, sourcePath, options);
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				return addCognition(root, services.fs, runtime.registry, sourcePath, options);
			}
		},
	),
    getCognitionHandbook,
    getCognitionTemplate,
	getNode: async (sourcePath) => withProjectWriteLock(
		services,
		root,
		'project.get-node',
		async () => {
			try {
				return (await resolveProjectNode(root, services.fs, runtime, sourcePath)).node;
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				return (await resolveProjectNode(root, services.fs, runtime, sourcePath)).node;
			}
		},
	),
	resolveSourcePath: async (sourcePath) => withProjectWriteLock(
		services,
		root,
		'project.resolve-source-path',
		async () => {
			try {
				return await resolveProjectNode(root, services.fs, runtime, sourcePath);
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				return resolveProjectNode(root, services.fs, runtime, sourcePath);
			}
		},
	),
	listUntracked: async () => withProjectWriteLock(
		services,
		root,
		'project.list-untracked',
		async () => {
			let snapshot = await buildProjectSnapshot(root, services.fs, {
				acceptance: runtime.acceptance,
			});
			try {
				await runtime.registry?.flush();
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				snapshot = await buildProjectSnapshot(root, services.fs, {
					acceptance: runtime.acceptance,
				});
				await runtime.registry?.flush();
			}
			return snapshot.allNodes.filter((node) =>
				node.kind === 'file'
				&& node.ownStatus?.observedStatus === undefined
				&& node.ownStatus?.coverage?.ownCognition === 'missing',
			);
		},
	),
    listOrphanedCognition: async () => listRegistryMaintenance(detectOrphanedCognitionEntries),
    listMisplacedCognition: async () => listRegistryMaintenance(detectMisplacedCognitionEntries),
    listStrayCognition: async () => listRegistryMaintenance(detectStrayCognitionEntries),
    moveCognitionToExpected: async (entry) => withProjectWriteLock(
      services,
      root,
      'project.move-cognition',
      async () => {
      if (!runtime.registry) {
        return 'Registry not available';
      }

      const registryEntry = runtime.registry.getEntry(entry.registryKey);
      if (!registryEntry) {
        return `Registry entry "${entry.registryKey}" not found`;
      }

      // Check target does not already exist
      const targetExists = await services.fs.exists(entry.expectedCognitionUri);
      if (targetExists) {
        return `Target file already exists: ${entry.expectedCognitionPath}`;
      }

      try {
        // Read content from current location
        const content = await services.fs.readFile(entry.actualCognitionUri);

        // Ensure target parent directory exists
        const parentDir = parentUri(entry.expectedCognitionUri);
        await services.fs.createDirectory(parentDir);

        // Write to expected location
        await services.fs.writeFile(entry.expectedCognitionUri, content);

        // Remove old file
        await services.fs.delete(entry.actualCognitionUri);

        const expectedCognitionRootPath = uriRelativePath(
          root.cognitionRootUri,
          entry.expectedCognitionUri,
        );
        if (expectedCognitionRootPath === undefined) {
          return `Target file is outside cognition root: ${entry.expectedCognitionPath}`;
        }

        const expectedKey = cognitionPathToKey(expectedCognitionRootPath);
        if (!runtime.registry.renameKey(entry.registryKey, expectedKey, 'move-misplaced')) {
          runtime.registry.setEntry(entry.registryKey, registryEntry, 'move-misplaced.rollback');
        }
        await runtime.registry.flush();

        return undefined; // success
      } catch (err) {
        if (err instanceof RegistryRevisionMismatchError && services.registry) {
          // The filesystem move has already happened, but the registry base
          // used by this runtime is obsolete.  Never keep or flush that stale
          // object; reconcile from the provider so the next status/read sees
          // the moved cognition through the normal stale workflow.
          runtime = { registry: null, acceptance: null };
          const recovered = await tryReconcileProjectRuntimeInLock(
            services,
            root,
            runtimeEvidence,
          );
          if (recovered) {
            runtime = recovered;
            return undefined;
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        return `Move failed: ${message}`;
      }
      },
    ),
    applySourceRename: async (oldUri, newUri) => withProjectWriteLock(
      services,
      root,
      'project.source-rename',
      async () => {
      if (!runtime.registry) {
        return false;
      }

      const oldRelativeToSource = uriRelativePath(root.sourceRootUri, oldUri);
      const newRelativeToSource = uriRelativePath(root.sourceRootUri, newUri);
      if (oldRelativeToSource === undefined || newRelativeToSource === undefined) {
        return false;
      }

      const oldSourcePath = uriRelativePath(root.projectRootUri, oldUri);
      const newSourcePath = uriRelativePath(root.projectRootUri, newUri);
      if (oldSourcePath === undefined || newSourcePath === undefined) {
        return false;
      }

      try {
        const relocation = await inferRegistrySourceRelocation(
          services.fs,
          oldSourcePath,
          newSourcePath,
          newUri,
        );
        const updated = applyRegistrySourceRelocations(
          runtime.registry,
          [relocation],
          'source-rename',
        );
        if (updated) {
          await runtime.registry.flush();
          return true;
        }

        const parentRelocation = await inferRegistrySourceParentRelocation(
          services.fs,
          root,
          oldSourcePath,
          newSourcePath,
        );
        if (!parentRelocation) {
          return false;
        }

        const parentUpdated = applyRegistrySourceRelocations(
          runtime.registry,
          [parentRelocation],
          'source-rename.parent',
        );
        if (!parentUpdated) {
          return false;
        }

        await runtime.registry.flush();
        return true;
      } catch (error) {
        if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
          throw error;
        }

        // A watcher event may race with a writer that committed the complete
        // registry file.  Discard the mutated runtime and rebuild from the
        // current provider.  The filesystem is already authoritative for the
        // rename, so a successful reconcile is sufficient for this event.
        runtime = { registry: null, acceptance: null };
        const recovered = await tryReconcileProjectRuntimeInLock(
          services,
          root,
          runtimeEvidence,
        );
        if (!recovered) {
          return false;
        }
        runtime = recovered;
        return true;
      }
      },
    ),
    recordSourceChange: async (uri, generation) => {
      if (!runtime.registry) {
        return false;
      }

      const relativePath = uriRelativePath(root.sourceRootUri, uri);
      if (relativePath === undefined) {
        return false;
      }
      const stat = await services.fs.stat(uri);
      if (!stat || stat.isDirectory) {
        return false;
      }

      const sourceKey = sourcePathToKey(relativePath);
      const registryKey = findRegistryKeyBySourceKey(root, runtime.registry, sourceKey);
      if (!registryKey) {
        return false;
      }

      const eventGeneration = runtimeEvidence.normalizeGeneration(generation);
      runtimeEvidence.beginSource(registryKey, eventGeneration);
      const sourceContent = await services.fs.readFile(uri);
      return runtimeEvidence.completeSource(
        registryKey,
        eventGeneration,
        computeSourceFactIdentity('file-content', sourceContent),
      );
    },
    recordDirectoryEntryChange: async (uri, generation) => {
      const registry = runtime.registry;
      if (!registry) {
        return false;
      }

      const folderUri = parentUri(uri);
      const relativePath = uriRelativePath(root.sourceRootUri, folderUri);
      if (relativePath === undefined) {
        return false;
      }
      const sourceKey = folderSourceKey(relativePath);
      const registryKey = findRegistryKeyBySourceKey(root, registry, sourceKey);
      if (!registryKey) {
        return false;
      }

      const eventGeneration = runtimeEvidence.normalizeGeneration(generation);
      runtimeEvidence.beginSource(registryKey, eventGeneration);
      const fingerprint = await readDirectFolderFingerprint(
        root,
        services.fs,
        folderUri,
        relativePath === '' ? '.' : relativePath,
      );
      if (fingerprint === undefined) {
        return false;
      }
      return runtimeEvidence.completeSource(
        registryKey,
        eventGeneration,
        computeSourceFactIdentity(
          'directory-entry',
          fingerprint,
        ),
      );
    },
    recordCognitionChange: async (uri, generation) => {
      if (!runtime.registry) {
        return false;
      }
      const relativePath = uriRelativePath(root.cognitionRootUri, uri);
      if (relativePath === undefined || !relativePath.endsWith('.md')) {
        return false;
      }

      const registryKey = cognitionPathToKey(relativePath);
      if (!runtime.registry.getEntry(registryKey)) {
        return false;
      }
      runtimeEvidence.recordCognition(
        registryKey,
        runtimeEvidence.normalizeGeneration(generation),
      );
      // Passive acceptance commits durable registry state, so it requires the
      // registry provider before entering the project write lock.
      if (!services.registry) {
        return false;
      }

      return withProjectWriteLock(
        services,
        root,
        'project.record-cognition-change',
        async () => {
          try {
            runtime = await reconcileProjectRuntimeInLock(
              services,
              root,
              runtimeEvidence,
            );
            return await acceptPassiveCognitionChangeInLock(
              root,
              services.fs,
              runtime,
              registryKey,
            );
          } catch (error) {
            if (!(error instanceof RegistryRevisionMismatchError)) {
              throw error;
            }
            runtime = { registry: null, acceptance: null };
            const recovered = await tryReconcileProjectRuntimeInLock(
              services,
              root,
              runtimeEvidence,
            );
            if (recovered) {
              runtime = recovered;
            }
            return false;
          }
        },
      );
    },
    markReviewedUnchanged: async (sourcePath) => {
      if (!services.registry) {
        throw new Error('Registry not available');
      }

      return withProjectWriteLock(
        services,
        root,
        'project.review-unchanged',
        async () => {
          try {
            runtime = await reconcileProjectRuntimeInLock(
              services,
              root,
              runtimeEvidence,
            );
          } catch (error) {
            if (!(error instanceof RegistryRevisionMismatchError)) {
              throw error;
            }
            runtime = { registry: null, acceptance: null };
            const recovered = await tryReconcileProjectRuntimeInLock(
              services,
              root,
              runtimeEvidence,
            );
            if (recovered) {
              runtime = recovered;
            }
            throw new Error(
              'Registry changed during reviewed-unchanged acceptance; the acceptance was not committed. Review the current contents and retry.',
              { cause: error },
            );
          }
          const registry = runtime.registry;
          if (!registry) {
            throw new Error('Registry not available');
          }

          const before = await captureReviewedPair(
            root,
            services.fs,
            registry,
            sourcePath,
          );
          const after = await captureReviewedPair(
            root,
            services.fs,
            registry,
            sourcePath,
          );
          if (before.sourceKey !== after.sourceKey
            || before.accepted.source !== after.accepted.source
            || before.accepted.cognition !== after.accepted.cognition) {
            throw new Error(
              'Source or cognition changed during reviewed-unchanged acceptance; review the current contents and retry.',
            );
          }

          registry.recordAcceptance(after.sourceKey, after.accepted);
          try {
            await registry.flush();
          } catch (error) {
            if (!(error instanceof RegistryRevisionMismatchError)) {
              throw error;
            }

            runtime = { registry: null, acceptance: null };
            const recovered = await tryReconcileProjectRuntimeInLock(
              services,
              root,
              runtimeEvidence,
            );
            if (recovered) {
              runtime = recovered;
            }
            throw new Error(
              'Registry changed during reviewed-unchanged acceptance; the acceptance was not committed. Review the current contents and retry.',
              { cause: error },
            );
          }
          runtimeEvidence.clear(after.sourceKey);
          return {
            sourceKey: after.sourceKey,
            accepted: after.accepted,
            verificationTimeMs: Date.now(),
          };
        },
      );
    },
	refreshNode: (sourcePath) => withProjectWriteLock(
		services,
		root,
		'project.refresh-node',
		async () => {
			try {
				return (await resolveProjectNode(root, services.fs, runtime, sourcePath)).node;
			} catch (error) {
				if (!(error instanceof RegistryRevisionMismatchError) || !services.registry) {
					throw error;
				}
				runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
				return (await resolveProjectNode(root, services.fs, runtime, sourcePath)).node;
			}
		},
	),
	flush: async () => withProjectWriteLock(
		services,
		root,
		'project.flush',
		async () => {
			if (!runtime.registry) {
				return;
			}

			try {
				await runtime.registry.flush();
			} catch (error) {
				if (error instanceof RegistryRevisionMismatchError && services.registry) {
					runtime = await reconcileProjectRuntimeInLock(services, root, runtimeEvidence);
					return;
				}
				warnLog(services.logger, 'registry.io', 'Registry flush failed', {
					rootId: root.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	),
  };
}

async function withProjectWriteLock<T>(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const locks = services.locks ?? noOpProjectLockManager;
  return locks.withWriteLock(
    root.projectRootUri,
    {
      owner: 'core',
      operation,
      projectLabel: root.label,
    },
    fn,
  );
}

export async function buildSnapshotFromProjects(
  projects: readonly CoggitProject[],
): Promise<CoggitSnapshot> {
  const projectSnapshots = await Promise.all(
    projects.map((project) => project.buildSnapshot()),
  );
  const rootNodes = projectSnapshots.flatMap((snapshot) => snapshot.roots);
  const allNodes = projectSnapshots.flatMap((snapshot) => snapshot.allNodes);
  const nodeById = new Map<string, CoggitTreeNode>();
  const nodeBySourceUri = new Map<string, CoggitTreeNode>();

  for (const node of allNodes) {
    nodeById.set(node.id, node);
    nodeBySourceUri.set(uriKey(node.sourceUri), node);
  }

  return {
    roots: rootNodes,
    allNodes,
    nodeById,
    nodeBySourceUri,
    mappingIndex: buildMappingIndex(allNodes),
  };
}

async function createProjectRuntime(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  runtimeEvidence: RuntimeAcceptanceEvidence,
  options: CoggitProjectDiscoveryOptions,
): Promise<ProjectRuntime> {
  if (!services.registry) {
    return { registry: null, acceptance: null };
  }

  try {
    return await reconcileProjectRuntime(
      services,
      root,
      'project.open.reconcile',
      runtimeEvidence,
    );
  } catch (error) {
    if (options.registryInitFailure === 'throw') {
      throw error;
    }
    warnLog(services.logger, 'project.reconcile', 'Registry init failed', {
      rootId: root.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { registry: null, acceptance: null };
  }
}

/**
 * Shared reconcile boundary: acquire write lock, load a fresh registry from
 * disk, scan cognition state, reconcile, resolve source links, and flush.
 *
 * Returns a new ProjectRuntime with the reconciled registry. Callers swap
 * their runtime reference with the result.
 *
 * Used by both project-open (first reconcile) and ensureFresh (subsequent
 * reconciles). The write lock serializes concurrent MCP/CLI/VS Code sessions;
 * the fresh registry load inside the lock prevents stale-snapshot overwrites.
 */
async function reconcileProjectRuntime(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  operation: string,
  runtimeEvidence: RuntimeAcceptanceEvidence,
): Promise<ProjectRuntime> {
  return withProjectWriteLock(
    services,
    root,
    operation,
    () => reconcileProjectRuntimeInLock(services, root, runtimeEvidence),
  );
}

/** Reconcile assuming the caller already owns the project write lock. */
async function reconcileProjectRuntimeInLock(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  runtimeEvidence: RuntimeAcceptanceEvidence,
): Promise<ProjectRuntime> {
  const registryFactory = services.registry!;
  const provider = registryFactory.create(root.projectRootUri);
  const registry = await Registry.create(provider, { logger: services.logger });
  const scan = await scanCognitionDirectory(
    services.fs,
    root.cognitionRootUri,
  );
  await reconcileRegistry(registry, scan);
  await resolveRegistrySourceLinks(root, services.fs, registry);
  await registry.flush();
  return {
    registry,
    acceptance: createAcceptanceStore(root, registry, runtimeEvidence),
  };
}

/**
 * Best-effort recovery after a revision mismatch while the caller owns the
 * project write lock.  Failure remains conservative: callers report a failed
 * operation instead of retaining the stale, dirty Registry instance.
 */
async function tryReconcileProjectRuntimeInLock(
  services: CoggitServices,
  root: CoggitWorkspaceRoot,
  runtimeEvidence: RuntimeAcceptanceEvidence,
): Promise<ProjectRuntime | undefined> {
  try {
    return await reconcileProjectRuntimeInLock(
      services,
      root,
      runtimeEvidence,
    );
  } catch (error) {
    warnLog(services.logger, 'project.reconcile', 'Registry revision recovery failed', {
      rootId: root.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function resolveRegistrySourceLinks(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  registry: Registry,
): Promise<void> {
  for (const [key, entry] of Object.entries(registry.getAllEntries())) {
    if (entry.sourcePath !== null) {
      const sourceUri = joinRelativePath(root.projectRootUri, entry.sourcePath);
      if (await fs.stat(sourceUri)) {
        continue;
      }
    }

    const cognitionUri = joinUriPath(
      root.cognitionRootUri,
      ...keyToCognitionPath(key, entry.type).split('/'),
    );

    if (!(await fs.stat(cognitionUri))) {
      continue;
    }

    const candidates = inferSourceUriCandidatesFromCognitionUri(
      cognitionUri,
      root.sourceRootUri,
      root.cognitionRootUri,
    );

    let resolved = false;
    for (const candidate of candidates) {
      const sourceStat = await fs.stat(candidate);
      if (!sourceStat) {
        continue;
      }

      const sourcePath = uriRelativePath(root.projectRootUri, candidate);
      if (sourcePath === undefined) {
        continue;
      }

      registry.setEntry(key, {
        ...entry,
        sourcePath,
      }, 'resolve-source-links.mirror');
      resolved = true;
      break;
    }

    if (resolved) {
      continue;
    }

    const movedSourceUri = await findUniqueMovedSourceCandidate(root, fs, entry);
    if (!movedSourceUri) {
      continue;
    }

    const movedSourcePath = uriRelativePath(root.projectRootUri, movedSourceUri);
    if (movedSourcePath === undefined) {
      continue;
    }

    registry.setEntry(key, {
      ...entry,
      sourcePath: movedSourcePath,
    }, 'resolve-source-links.basename');
  }
}

async function findUniqueMovedSourceCandidate(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  entry: { sourcePath: string | null; type: 'leaf' | 'folder' },
): Promise<UriComponents | undefined> {
  if (entry.sourcePath === null) {
    return undefined;
  }

  const basename = entry.sourcePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  if (!basename) {
    return undefined;
  }

  const matches: UriComponents[] = [];
  await collectSourceBasenameMatches(root.sourceRootUri, fs, basename, entry.type, matches);

  return matches.length === 1 ? matches[0] : undefined;
}

async function collectSourceBasenameMatches(
  dirUri: UriComponents,
  fs: CoggitServices['fs'],
  basename: string,
  type: 'leaf' | 'folder',
  matches: UriComponents[],
): Promise<void> {
  let entries: Array<[string, number]>;
  try {
    entries = await fs.readDirectory(dirUri);
  } catch {
    return;
  }

  for (const [name, fileType] of entries) {
    const childUri = joinUriPath(dirUri, name);
    const isDirectory = (fileType & 2) !== 0;
    const isFile = (fileType & 1) !== 0;

    if ((type === 'folder' && isDirectory && name === basename)
      || (type === 'leaf' && isFile && name === basename)) {
      matches.push(childUri);
    }

    if (isDirectory) {
      await collectSourceBasenameMatches(childUri, fs, basename, type, matches);
    }
  }
}

async function inferRegistrySourceRelocation(
  fs: CoggitServices['fs'],
  oldSourcePath: string,
  newSourcePath: string,
  newUri: UriComponents,
): Promise<RegistrySourceRelocation> {
  const newStat = await fs.stat(newUri);
  return {
    kind: newStat?.isDirectory ? 'prefix' : 'exact',
    fromSourcePath: oldSourcePath,
    toSourcePath: newSourcePath,
  };
}

async function inferRegistrySourceParentRelocation(
  fs: CoggitServices['fs'],
  root: CoggitWorkspaceRoot,
  oldSourcePath: string,
  newSourcePath: string,
): Promise<RegistrySourceRelocation | undefined> {
  const oldParent = parentSourcePath(oldSourcePath);
  const newParent = parentSourcePath(newSourcePath);
  if (!oldParent || !newParent || oldParent === newParent) {
    return undefined;
  }

  const oldBasename = oldSourcePath.split('/').pop();
  const newBasename = newSourcePath.split('/').pop();
  if (oldBasename !== newBasename) {
    return undefined;
  }

  const oldParentExists = await fs.stat(joinRelativePath(root.projectRootUri, oldParent));
  const newParentExists = await fs.stat(joinRelativePath(root.projectRootUri, newParent));
  if (oldParentExists || !newParentExists?.isDirectory) {
    return undefined;
  }

  return {
    kind: 'prefix',
    fromSourcePath: oldParent,
    toSourcePath: newParent,
  };
}

function parentSourcePath(sourcePath: string): string | undefined {
  const normalized = sourcePath.replace(/\\/g, '/').replace(/\/+$/u, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : undefined;
}

function createAcceptanceStore(
  root: CoggitWorkspaceRoot,
  registry: Registry,
  runtimeEvidence: RuntimeAcceptanceEvidence,
): AcceptanceStore {
  return {
    getAcceptedPair(requestRootId, sourceKey) {
      if (requestRootId !== root.id) {
        return null;
      }
      const entry = registry.getEntry(sourceKey)
        ?? findRegistryEntryBySourceKey(root, registry, sourceKey);
      return entry?.accepted ?? null;
    },
    acceptPair(requestRootId, sourceKey, pair) {
      if (requestRootId !== root.id) {
        return;
      }
      const key = registry.getEntry(sourceKey)
        ? sourceKey
        : findRegistryKeyBySourceKey(root, registry, sourceKey);
      if (key) {
        registry.recordAcceptance(key, pair);
        runtimeEvidence.clear(key);
      }
    },
    hasSourceBeforeCognitionEvidence(requestRootId, sourceKey, pair) {
      if (requestRootId !== root.id) {
        return false;
      }
      const key = registry.getEntry(sourceKey)
        ? sourceKey
        : findRegistryKeyBySourceKey(root, registry, sourceKey);
      return key
        ? runtimeEvidence.hasSourceBeforeCognition(key, pair)
        : false;
    },
  };
}

async function captureReviewedPair(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  registry: Registry,
  sourcePath: string,
): Promise<{ sourceKey: string; accepted: AcceptedPair }> {
  const snapshot = await buildProjectSnapshot(root, fs);
  const normalizedPath = normalizeSourcePathInput(sourcePath, {
    projectRootUri: root.projectRootUri,
    sourceRootUri: root.sourceRootUri,
  });
  const node = normalizedPath === '.'
    ? snapshot.roots[0]
    : findNodeByPath(snapshot.allNodes, normalizedPath);
  if (!node) {
    throw new Error(`Path not found in CogGit project: ${sourcePath}`);
  }
  if (!node.cognitionUri || !(await fs.stat(node.cognitionUri))) {
    throw new Error('Cognition file is missing');
  }

  const sourceContent = node.kind === 'file'
    ? await fs.readFile(node.sourceUri)
    : computeFolderFingerprint(node.children ?? []);
  const cognitionContent = await fs.readFile(node.cognitionUri);
  return {
    sourceKey: sourceKeyForReviewedNode(root, registry, node),
    accepted: {
      source: computeSourceFactIdentity(
        node.kind === 'file' ? 'file-content' : 'directory-entry',
        sourceContent,
      ),
      cognition: computeCognitionIdentity(cognitionContent),
    },
  };
}

async function acceptPassiveCognitionChangeInLock(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  runtime: ProjectRuntime,
  registryKey: string,
): Promise<boolean> {
  const registry = runtime.registry;
  const acceptance = runtime.acceptance;
  if (!registry || !acceptance) {
    return false;
  }
  const entry = registry.getEntry(registryKey);
  if (!entry?.sourcePath) {
    return false;
  }

  const current = await captureCurrentPairForSourcePath(
    root,
    fs,
    registry,
    registryKey,
    entry.sourcePath,
    entry.type,
  );
  if (!current) {
    return false;
  }

  const result = acceptCurrentPair(
    acceptance,
    root.id,
    current.sourceKey,
    current.sourceIdentity,
    current.cognitionContent,
  );
  if (!result.changed) {
    return false;
  }

  await registry.flush();
  return true;
}

async function captureCurrentPairForSourcePath(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  registry: Registry,
  registryKey: string,
  sourcePath: string,
  entryType: 'leaf' | 'folder',
): Promise<{
  sourceKey: string;
  sourceIdentity: AcceptedPair['source'];
  cognitionContent: string;
} | undefined> {
  const normalizedPath = normalizeSourcePathInput(sourcePath, {
    projectRootUri: root.projectRootUri,
    sourceRootUri: root.sourceRootUri,
  });
  if (await isSourcePathIgnored(root, fs, normalizedPath)) {
    return undefined;
  }

  const sourceUri = normalizedPath === '.'
    ? root.sourceRootUri
    : joinRelativePath(root.sourceRootUri, normalizedPath);
  const sourceStat = await fs.stat(sourceUri);
  if (!sourceStat) {
    return undefined;
  }

  const cognitionUri = entryType === 'folder'
    ? toCognitionFolderReadmeUri(root.sourceRootUri, root.cognitionRootUri, sourceUri)
    : toCognitionFileUri(root.sourceRootUri, root.cognitionRootUri, sourceUri);
  if (!(await fs.stat(cognitionUri))) {
    return undefined;
  }

  if (entryType === 'leaf' && sourceStat.isDirectory) {
    return undefined;
  }
  if (entryType === 'folder' && !sourceStat.isDirectory) {
    return undefined;
  }

  const sourceContent = entryType === 'leaf'
    ? await fs.readFile(sourceUri)
    : await readDirectFolderFingerprint(root, fs, sourceUri, normalizedPath);
  if (sourceContent === undefined) {
    return undefined;
  }

  const cognitionContent = await fs.readFile(cognitionUri);
  return {
    sourceKey: registryKey,
    sourceIdentity: computeSourceFactIdentity(
      entryType === 'leaf' ? 'file-content' : 'directory-entry',
      sourceContent,
    ),
    cognitionContent,
  };
}

async function isSourcePathIgnored(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  normalizedPath: string,
): Promise<boolean> {
  if (normalizedPath === '.') {
    return false;
  }

  let rules = await loadSourceRootGitignoreRules(root, fs);
  let currentDir = root.sourceRootUri;
  for (const segment of normalizedPath.split('/')) {
    const childUri = joinRelativePath(currentDir, segment);
    const stat = await fs.stat(childUri);
    if (!stat) {
      return false;
    }
    if (isIgnoredSourceStructureEntry(segment, stat.isDirectory)) {
      return true;
    }
    if (isIgnoredByGitignoreRules(root.projectRootUri, rules, childUri, stat.isDirectory)) {
      return true;
    }
    if (stat.isDirectory) {
      currentDir = childUri;
      rules = await loadGitignoreRulesForDirectory(root, fs, currentDir, rules);
    }
  }
  return false;
}

async function readDirectFolderFingerprint(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  directoryUri: UriComponents,
  normalizedPath: string,
): Promise<string | undefined> {
  const stat = await fs.stat(directoryUri);
  if (!stat?.isDirectory) {
    return undefined;
  }

  const rules = await loadRulesThroughSourceDirectory(root, fs, normalizedPath);
  const entries = await fs.readDirectory(directoryUri);
  const items: Array<{ name: string; kind: 'file' | 'folder' }> = [];

  for (const [name, type] of entries) {
    const isDirectory = (type & FILE_TYPE_DIRECTORY) !== 0;
    const isFile = (type & FILE_TYPE_FILE) !== 0;
    if (!isDirectory && !isFile) {
      continue;
    }
    if (isIgnoredSourceStructureEntry(name, isDirectory)) {
      continue;
    }

    const childUri = joinRelativePath(directoryUri, name);
    if (isIgnoredByGitignoreRules(root.projectRootUri, rules, childUri, isDirectory)) {
      continue;
    }
    items.push({
      name,
      kind: isDirectory ? 'folder' : 'file',
    });
  }

  return directoryEntryFingerprint(items);
}

async function loadRulesThroughSourceDirectory(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  normalizedPath: string,
) {
  let rules = await loadSourceRootGitignoreRules(root, fs);
  if (normalizedPath === '.') {
    return rules;
  }

  let currentDir = root.sourceRootUri;
  for (const segment of normalizedPath.split('/')) {
    currentDir = joinRelativePath(currentDir, segment);
    const stat = await fs.stat(currentDir);
    if (!stat?.isDirectory) {
      return rules;
    }
    rules = await loadGitignoreRulesForDirectory(root, fs, currentDir, rules);
  }
  return rules;
}

async function loadSourceRootGitignoreRules(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
) {
  const rootRules = await loadGitignoreRulesForDirectory(
    root,
    fs,
    root.projectRootUri,
    { rules: [] },
  );
  return loadGitignoreRulesForDirectory(root, fs, root.sourceRootUri, rootRules);
}

function loadGitignoreRulesForDirectory(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  directoryUri: UriComponents,
  inheritedRules: Parameters<typeof loadGitignoreRules>[2],
) {
  return loadGitignoreRules(
    root.projectRootUri,
    directoryUri,
    inheritedRules,
    {
      readFile: (uri) => fs.readFile(uri),
      exists: (uri) => fs.exists(uri),
    },
  );
}

function sourceKeyForReviewedNode(
  root: CoggitWorkspaceRoot,
  registry: Registry,
  node: CoggitTreeNode,
): string {
  if (node.kind === 'root') {
    return '/';
  }
  if (node.kind === 'folder') {
    const sourceKey = folderSourceKey(node.relativePath);
    return findRegistryKeyBySourceKey(root, registry, sourceKey) ?? sourceKey;
  }
  const sourceKey = sourcePathToKey(node.relativePath);
  return findRegistryKeyBySourceKey(root, registry, sourceKey) ?? sourceKey;
}

function findRegistryEntryBySourceKey(
  root: CoggitWorkspaceRoot,
  registry: Registry,
  sourceKey: string,
) {
  const key = findRegistryKeyBySourceKey(root, registry, sourceKey);
  return key ? registry.getEntry(key) : undefined;
}

function findRegistryKeyBySourceKey(
  root: CoggitWorkspaceRoot,
  registry: Registry,
  sourceKey: string,
): string | undefined {
  const sourceRootName = root.sourceRootUri.path.split('/').filter(Boolean).pop();
  return Object.entries(registry.getAllEntries()).find(([, entry]) => {
    if (!entry.sourcePath) {
      return false;
    }
    if (
      sourceKey === '/'
      && sourceRootName
      && entry.sourcePath.replace(/\\/g, '/').replace(/\/+$/u, '') === sourceRootName
    ) {
      return true;
    }
    const sourceRootRelativePath = sourceRootName && entry.sourcePath.startsWith(`${sourceRootName}/`)
      ? entry.sourcePath.slice(sourceRootName.length + 1)
      : entry.sourcePath;
    return sourcePathToKey(sourceRootRelativePath) === sourceKey
      || folderSourceKey(sourceRootRelativePath.replace(/\/+$/u, '')) === sourceKey;
  })?.[0];
}

async function resolveProjectNode(
  root: CoggitWorkspaceRoot,
  fs: CoggitServices['fs'],
  runtime: ProjectRuntime,
  sourcePath: string,
): Promise<SourcePathResolution> {
  const snapshot = await buildProjectSnapshot(root, fs, {
    acceptance: runtime.acceptance,
  });
  await runtime.registry?.flush();
  const normalizedPath = normalizeSourcePathInput(sourcePath, {
    projectRootUri: root.projectRootUri,
    sourceRootUri: root.sourceRootUri,
  });

  if (normalizedPath === '.') {
    return { node: snapshot.roots[0], normalizedPath };
  }
  const node = findNodeByPath(snapshot.allNodes, normalizedPath);
  if (node) {
    return { node, normalizedPath };
  }
  return {
    node: undefined,
    normalizedPath,
    candidatePaths: snapshot.allNodes.map((candidate) => candidate.relativePath),
  };
}

/** Match a source-root-relative path against snapshot nodes. */
function findNodeByPath(
  nodes: readonly CoggitTreeNode[],
  normalizedPath: string,
): CoggitTreeNode | undefined {
  const sourceKey = sourcePathToKey(normalizedPath);
  return nodes.find((node) =>
    node.relativePath === normalizedPath
    || (node.kind === 'file' && sourcePathToKey(node.relativePath) === sourceKey),
  );
}

/** Return the parent URI (directory) of a given URI. */
export function parentUri(uri: UriComponents): UriComponents {
  const path = uri.path.replace(/\/+$/u, '');
  const idx = path.lastIndexOf('/');
  return {
    scheme: uri.scheme,
    authority: uri.authority,
    path: idx >= 0 ? path.slice(0, idx) || '/' : '/',
    query: uri.query,
    fragment: uri.fragment,
  };
}

function joinRelativePath(rootUri: UriComponents, relativePath: string): UriComponents {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) =>
    segment.length > 0 && segment !== '.',
  );
  return segments.length === 0
    ? rootUri
    : joinUriPath(rootUri, ...segments);
}

function isCoggitServices(value: CoggitServices | CoggitServices['fs']): value is CoggitServices {
  return 'fs' in value && 'config' in value;
}
