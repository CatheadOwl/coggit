import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	extensionDevelopmentPath: './packages/vscode',
	files: 'out/**/*.test.js',
});
