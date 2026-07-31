import type { FileChangeKind } from '../watch/watcher';

export type WatchRefreshMode = 'full' | 'partial';

export function selectWatchRefreshMode(
	kind: FileChangeKind,
	hasMappingIndex: boolean,
): WatchRefreshMode {
	if (kind !== 'change') {
		return 'full';
	}

	return hasMappingIndex ? 'partial' : 'full';
}
