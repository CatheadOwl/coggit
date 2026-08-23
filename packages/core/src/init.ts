import { joinUriPath } from './uri-utils';
import type { FileSystem, UriComponents } from './interfaces';
import { BOOTSTRAP_README_FOR_EMPTY_COGNITION_LAYER } from './cognition/templates';

const DEFAULT_SOURCE_ROOT = 'src';
const DEFAULT_COGNITION_ROOT = 'src_cognition';

const COGGIT_GITIGNORE_RULE = '*.bak';

/**
 * Initialize a coggit project at the given project root.
 *
 * Creates `.coggit/config.yaml`, the cognition root directory, and ensures
 * `.gitignore` has the right coggit entries so cache files don't leak in
 * and users are reminded not to gitignore `.coggit/` itself.
 *
 * Core-layer function: takes a `FileSystem` abstraction and `UriComponents`,
 * making it portable across VS Code, CLI, and tests.  Callers are responsible
 * for converting string paths to `UriComponents` before calling this function.
 *
 * @param fs           The filesystem abstraction to use for all I/O.
 * @param projectRoot  URI of the project root (the directory that will contain
 *                     the `.coggit/` folder).
 * @param overrides    Optional `{ sourceRoot, cognitionRoot }` to override the
 *                     defaults (`"src"` / `"src_cognition"`).
 */
export async function initProject(
	fs: FileSystem,
	projectRoot: UriComponents,
	overrides?: { sourceRoot?: string; cognitionRoot?: string },
): Promise<void> {
	const sourceRoot = overrides?.sourceRoot ?? DEFAULT_SOURCE_ROOT;
	const cognitionRoot = overrides?.cognitionRoot ?? DEFAULT_COGNITION_ROOT;

	const configDir = joinUriPath(projectRoot, '.coggit');
	const configUri = joinUriPath(configDir, 'config.yaml');

	if (await fs.exists(configUri)) {
		throw new Error('CogGit project already initialised at this root. Remove .coggit/config.yaml to re-initialise.');
	}
	const cognitionRootUri = joinUriPath(projectRoot, cognitionRoot);
	const cognitionReadmeUri = joinUriPath(cognitionRootUri, 'README.md');

	// 1. Create .coggit/ directory
	await fs.createDirectory(configDir);

	// 2. Write config.yaml
	const yamlContent = [
		'# Coggit project configuration',
		`source_root: "${sourceRoot}"`,
		`cognition_root: "${cognitionRoot}"`,
		'',
	].join('\n');
	await fs.writeFile(configUri, yamlContent);

	// 3. Create cognition root directory
	await fs.createDirectory(cognitionRootUri);

	// 4. Seed a root README only when the user has not created one already.
	if (!(await fs.exists(cognitionReadmeUri))) {
		await fs.writeFile(cognitionReadmeUri, BOOTSTRAP_README_FOR_EMPTY_COGNITION_LAYER);
	}

	// 5. Ensure .gitignore ignores backup files.
	await ensureGitignore(fs, projectRoot);
}

async function ensureGitignore(
	fs: FileSystem,
	projectRoot: UriComponents,
): Promise<void> {
	const gitignoreUri = joinUriPath(projectRoot, '.gitignore');

	let existing = '';
	try {
		existing = await fs.readFile(gitignoreUri);
	} catch {
		await fs.writeFile(gitignoreUri, `${COGGIT_GITIGNORE_RULE}\n`);
		return;
	}

	if (existing.includes('*.bak') || existing.includes(COGGIT_GITIGNORE_RULE)) {
		return;
	}

	const content = existing.endsWith('\n')
		? existing + COGGIT_GITIGNORE_RULE + '\n'
		: existing + '\n' + COGGIT_GITIGNORE_RULE + '\n';

	await fs.writeFile(gitignoreUri, content);
}
