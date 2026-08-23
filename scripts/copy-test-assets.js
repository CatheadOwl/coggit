const fs = require('node:fs/promises');
const path = require('node:path');

async function emitMarkdownTextModules(sourceDir, targetDir) {
	await fs.mkdir(targetDir, { recursive: true });

	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	await Promise.all(entries.map(async (entry) => {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			await emitMarkdownTextModules(sourcePath, targetPath);
			return;
		}

		if (entry.isFile() && entry.name.endsWith('.md')) {
			const content = await fs.readFile(sourcePath, 'utf8');

			await fs.writeFile(targetPath, `module.exports = ${JSON.stringify(content)};\n`);
		}
	}));
}

async function main() {
	const roots = [
		['packages/core/src/cognition', 'out/packages/core/src/cognition'],
		['packages/mcp/src/prompt-assets', 'out/packages/mcp/src/prompt-assets'],
	];

	await Promise.all(roots.map(([source, target]) => emitMarkdownTextModules(
		path.join(__dirname, '..', source),
		path.join(__dirname, '..', target),
	)));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
