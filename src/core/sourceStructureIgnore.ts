const GENERATED_DIRECTORY_NAMES = new Set([
	'.cache',
	'.git',
	'.mypy_cache',
	'.next',
	'.nox',
	'.nuxt',
	'.parcel-cache',
	'.pytest_cache',
	'.ruff_cache',
	'.svelte-kit',
	'.tox',
	'.turbo',
	'.vite',
	'.vscode-test',
	'__pycache__',
	'node_modules',
]);

export function isIgnoredSourceStructureEntry(name: string, isDirectory: boolean): boolean {
	return isDirectory && GENERATED_DIRECTORY_NAMES.has(name);
}
