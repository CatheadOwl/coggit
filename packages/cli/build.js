const esbuild = require('esbuild');
const path = require('node:path');
const packageJson = require('./package.json');

const watch = process.argv.includes('--watch');

// Bundle the pathscope CJS face, not its ESM module graph — same ruling as
// packages/core/build.js: esbuild resolves ESM sources through the `import`
// condition, and the ESM face's fdir entry (index.mjs) calls
// createRequire(import.meta.url), which does not survive a CJS bundle (the
// mcp-stdio payload crashed at startup because of exactly this). pathscope is
// @coggit/core's dependency, not this package's, so resolve through core's
// own node_modules link — machine-independent and no new dependency edge.
const pathscopeCjsEntry = require.resolve('@catheadowl/pathscope', {
	paths: [path.dirname(require.resolve('@coggit/core/package.json'))],
});

async function main() {
	const shared = {
		bundle: true,
		format: 'cjs',
		sourcemap: false,
		sourcesContent: false,
		platform: 'node',
		loader: {
			'.md': 'text',
		},
		define: {
			__COGGIT_PACKAGE_VERSION__: JSON.stringify(packageJson.version),
		},
		alias: {
			'@catheadowl/pathscope': pathscopeCjsEntry,
		},
		logLevel: 'silent',
	};

	const contexts = await Promise.all([
		// CLI executable (bin: coggit). Published SDK deps stay external (single
		// semantic source of truth); @parcel/watcher resolves its native binary
		// through a dynamic require, so it must stay external. Private
		// @coggit/format + @coggit/mcp-runtime-support and no-shared-semantics
		// commander are bundled.
		esbuild.context({
			...shared,
			entryPoints: ['src/main.ts'],
			outfile: 'dist/cli.js',
			banner: {
				js: '#!/usr/bin/env node',
			},
			external: [
				'@coggit/core',
				'@coggit/core/internal',
				'@coggit/runtime-node',
				'@coggit/runtime-node/internal',
				'@parcel/watcher',
			],
		}),
		// Self-contained MCP stdio payload for `coggit mcp install`. The launcher
		// copies this to ~/.coggit/runtimes/... where @coggit/* are NOT installed,
		// so unlike the CLI entry it must bundle @coggit/mcp and its runtime deps
		// (@coggit/core, @coggit/runtime-node). The public runtime-node surface
		// does not reach @parcel/watcher, so node builtins are the only externals.
		esbuild.context({
			...shared,
			entryPoints: ['src/mcp-stdio-bin.ts'],
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

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
