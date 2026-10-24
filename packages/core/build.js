const esbuild = require('esbuild');

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
		logLevel: 'silent',
		// Bundle the pathscope CJS face, not its ESM module graph: esbuild
		// resolves ESM sources through the `import` condition, and the ESM
		// face's fdir entry (index.mjs) calls createRequire(import.meta.url),
		// which does not survive a CJS bundle. require.resolve picks the
		// `require` condition through this package's own node_modules link,
		// staying machine-independent.
		alias: {
			'@catheadowl/pathscope': require.resolve('@catheadowl/pathscope'),
		},
	};

	const contexts = await Promise.all([
		esbuild.context({
			...shared,
			entryPoints: ['src/public.ts'],
			outfile: 'dist/public.js',
		}),
		esbuild.context({
			...shared,
			entryPoints: ['src/internal.ts'],
			outfile: 'dist/internal.js',
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
