import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { NodeConfigProvider } from './config';
import { uriComponentsToPath } from './uri';

suite('NodeConfigProvider', () => {
	test('discovers descendant configs while skipping generated directories', async () => {
		const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-config-'));
		try {
			await writeConfig(path.join(tempRoot, 'project-a'));
			await writeConfig(path.join(tempRoot, 'vendor', 'ignored-project'));
			await writeConfig(path.join(tempRoot, 'build', 'ignored-project'));

			const provider = new NodeConfigProvider(tempRoot);
			const configs = await provider.findFiles('**/.coggit/config.yaml');
			const paths = configs.map(uriComponentsToPath);

			assert.deepStrictEqual(paths, [
				path.join(tempRoot, 'project-a', '.coggit', 'config.yaml'),
			]);
		} finally {
			await nodeFs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('can restrict discovery to the nearest ancestor project', async () => {
		const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-config-'));
		try {
			await writeConfig(tempRoot);
			await writeConfig(path.join(tempRoot, 'nested-project'));

			const provider = new NodeConfigProvider(path.join(tempRoot, 'src'), {
				discoveryMode: 'nearest',
			});
			const configs = await provider.findFiles('**/.coggit/config.yaml');
			const paths = configs.map(uriComponentsToPath);

			assert.deepStrictEqual(paths, [
				path.join(tempRoot, '.coggit', 'config.yaml'),
			]);
		} finally {
			await nodeFs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('nearest discovery does not scan descendants when no ancestor project exists', async () => {
		const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-config-'));
		try {
			await writeConfig(path.join(tempRoot, 'nested-project'));

			const provider = new NodeConfigProvider(tempRoot, {
				discoveryMode: 'nearest',
			});
			const configs = await provider.findFiles('**/.coggit/config.yaml');

			assert.deepStrictEqual(configs, []);
		} finally {
			await nodeFs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});

async function writeConfig(projectPath: string): Promise<void> {
	const configDirectory = path.join(projectPath, '.coggit');
	await nodeFs.mkdir(configDirectory, { recursive: true });
	await nodeFs.writeFile(
		path.join(configDirectory, 'config.yaml'),
		'source_root: src\ncognition_root: cognition\n',
	);
}
