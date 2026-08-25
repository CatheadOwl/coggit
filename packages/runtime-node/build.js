const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
	const shared = {
		bundle: true,
		format: 'cjs',
		sourcemap: false,
		sourcesContent: false,
		platform: 'node',
		// `@coggit/core` stays a real dependency (single semantic source of
		// truth); `@parcel/watcher` resolves its native binary through a dynamic
		// require, so both must stay external like node built-ins.
		external: ['@coggit/core', '@coggit/core/internal', '@parcel/watcher'],
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
