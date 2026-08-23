const esbuild = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	await removeStaleDistOutputs();

	const shared = {
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		loader: {
			'.md': 'text',
		},
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	};
	const contexts = await Promise.all([
		// The extension host only reaches the VS Code surface; everything else
		// (@coggit/core, runtime-node, format, mcp-runtime-support) is bundled.
		esbuild.context({
			...shared,
			entryPoints: ['src/extension.ts'],
			outfile: 'dist/extension.js',
			external: ['vscode'],
		}),
		// Self-contained MCP stdio payload the extension copies into the user
		// runtime via `ensureMcpRuntime`. It must bundle @coggit/mcp and its
		// runtime deps (@coggit/core, @coggit/runtime-node) because the copied
		// runtime directory has no @coggit/* installed.
		esbuild.context({
			...shared,
			entryPoints: ['src/mcp-stdio/main.ts'],
			outfile: 'dist/mcp-stdio.js',
			banner: {
				js: '#!/usr/bin/env node',
			},
		}),
	]);
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
	} else {
		await Promise.all(contexts.map((ctx) => ctx.rebuild()));
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
	}
}

async function removeStaleDistOutputs() {
	const distDir = path.join(__dirname, 'dist');
	await fs.rm(path.join(distDir, 'prompts'), { recursive: true, force: true });

	// Every `.js` / `.js.map` file in dist/ is an esbuild bundle produced by
	// this script; remove them all up front so orphaned entries never ship.
	const entries = await fs.readdir(distDir).catch(() => []);
	await Promise.all(
		entries
			.filter((name) => name.endsWith('.js') || name.endsWith('.js.map'))
			.map((name) => fs.rm(path.join(distDir, name), { force: true })),
	);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
