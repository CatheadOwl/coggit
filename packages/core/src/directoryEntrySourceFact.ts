import type { FileSystem, UriComponents } from './interfaces';

function encodeItem(item: DirectoryEntrySourceFactItem): string {
	const kind = item.kind === 'folder' ? 'folder' : 'file';
	const byteLength = Buffer.byteLength(item.name, 'utf8');
	return `${kind}:${byteLength}:${item.name}\n`;
}

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export interface DirectoryEntrySourceFactItem {
	readonly name: string;
	readonly kind: 'file' | 'folder';
}

export function directoryEntryFingerprint(
	items: readonly DirectoryEntrySourceFactItem[],
): string {
	return items
		.map(encodeItem)
		.sort((left, right) => Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8')))
		.join('');
}

export function directoryEntryItemsFromReadDirectory(
	entries: readonly (readonly [string, number])[],
): DirectoryEntrySourceFactItem[] {
	const items: DirectoryEntrySourceFactItem[] = [];
	for (const [name, type] of entries) {
		if ((type & FILE_TYPE_DIRECTORY) !== 0) {
			items.push({ name, kind: 'folder' });
			continue;
		}
		if ((type & FILE_TYPE_FILE) !== 0) {
			items.push({ name, kind: 'file' });
		}
	}
	return items;
}

export async function readDirectoryEntryFingerprint(
	fs: FileSystem,
	directoryUri: UriComponents,
): Promise<string | undefined> {
	const stat = await fs.stat(directoryUri);
	if (!stat?.isDirectory) {
		return undefined;
	}
	const entries = await fs.readDirectory(directoryUri);
	return directoryEntryFingerprint(directoryEntryItemsFromReadDirectory(entries));
}
