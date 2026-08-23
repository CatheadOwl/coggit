const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
	const shared = {
		bundle: true,
		format: 'cjs',
		sourcemap: false,
		sourcesContent: false,
		platform: 'node',
		// `@coggit/core` stays a real dependency of the consuming bundle; keep
		// the specifier external so consumers bundle core once (single semantic
		// source of truth), mirroring `@coggit/runtime-node`.
		external: ['@coggit/core', '@coggit/core/internal'],
		logLevel: 'silent',
	};

	const contexts = await Promise.all([
		esbuild.context({
			...shared,
			entryPoints: ['src/public.ts'],
			outfile: 'dist/public.js',
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
