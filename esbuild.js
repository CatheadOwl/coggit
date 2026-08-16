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
	await removeLegacyMcpPromptOutput();

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
		esbuild.context({
			...shared,
			entryPoints: ['src/extension.ts'],
			outfile: 'dist/extension.js',
			external: ['vscode'],
		}),
		esbuild.context({
			...shared,
			entryPoints: ['src/cli/main.ts'],
			outfile: 'dist/cli.js',
			banner: {
				js: '#!/usr/bin/env node',
			},
		}),
		esbuild.context({
			...shared,
			entryPoints: ['src/mcp-stdio/main.ts'],
			outfile: 'dist/mcp-stdio.js',
			banner: {
				js: '#!/usr/bin/env node',
			},
		}),
		// SDK library entries — the public `coggit/core` and `coggit/runtime-node`
		// surfaces. Node built-ins (`node:fs`, `node:path`, `node:crypto`) stay
		// external; everything else bundles into a self-contained CJS file.
		esbuild.context({
			...shared,
			entryPoints: ['src/core/public.ts'],
			outfile: 'dist/core.js',
		}),
		esbuild.context({
			...shared,
			entryPoints: ['src/runtime/node/index.ts'],
			outfile: 'dist/runtime-node.js',
		}),
	]);
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
	} else {
		await Promise.all(contexts.map((ctx) => ctx.rebuild()));
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
	}
}

async function removeLegacyMcpPromptOutput() {
	await fs.rm(path.join(__dirname, 'dist', 'prompts'), { recursive: true, force: true });
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
