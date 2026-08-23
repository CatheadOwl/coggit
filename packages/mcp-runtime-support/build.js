const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
	const shared = {
		bundle: true,
		format: 'cjs',
		sourcemap: false,
		sourcesContent: false,
		platform: 'node',
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
