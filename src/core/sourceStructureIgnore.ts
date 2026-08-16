export const GENERATED_SOURCE_STRUCTURE_DIRECTORY_NAMES = [
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
	'build',
	'coverage',
	'dist',
	'lib',
	'node_modules',
	'out',
	'vendor',
] as const;

const GENERATED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(GENERATED_SOURCE_STRUCTURE_DIRECTORY_NAMES);

export function isIgnoredSourceStructureEntry(name: string, isDirectory: boolean): boolean {
	return isDirectory && GENERATED_DIRECTORY_NAMES.has(name);
}

export function generatedSourceStructureGlobExclude(): string {
	const patterns = GENERATED_SOURCE_STRUCTURE_DIRECTORY_NAMES.map((name) => `**/${name}/**`);
	return `{${patterns.join(',')}}`;
}
