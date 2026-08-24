import type { CoggitSnapshot } from '../types';
import type { ConfigProvider, FileSystem } from '../interfaces';
import { createCoggitServices, discoverCoggitProjects, buildSnapshotFromProjects } from './project';

/**
 * One-shot reconcile-on-read snapshot for a bare fs+config consumer.
 *
 * This is the minimal public entry point for a runtime that owns its own
 * `FileSystem` and `ConfigProvider` adapters but does not need the full
 * `CoggitProject` facade lifecycle.
 */
export async function buildSnapshot(
  fs: FileSystem,
  config: ConfigProvider,
): Promise<CoggitSnapshot> {
  const services = createCoggitServices(fs, config);
  const projects = await discoverCoggitProjects(services);
  return buildSnapshotFromProjects(projects);
}
