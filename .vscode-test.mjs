import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	extensionDevelopmentPath: './packages/vscode',
	files: 'out/packages/vscode/src/**/*.test.js',
});
