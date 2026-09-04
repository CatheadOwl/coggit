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
		// `@coggit/core` and `@coggit/runtime-node` are published runtime
		// dependencies (single semantic source of truth); `@coggit/format` is
		// private and is bundled into this package's dist.
		external: ['@coggit/core', '@coggit/core/internal', '@coggit/runtime-node'],
		logLevel: 'silent',
	};

	const contexts = await Promise.all([
		esbuild.context({
			...shared,
			entryPoints: ['src/public.ts'],
			outfile: 'dist/public.js',
		}),
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
