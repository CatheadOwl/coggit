const esbuild = require('esbuild');
const packageJson = require('./package.json');

const watch = process.argv.includes('--watch');

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
