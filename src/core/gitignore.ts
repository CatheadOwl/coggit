import { joinUriPath, uriRelativePath } from './uri-utils';
import type { UriComponents } from './interfaces';

export interface CoggitIgnoreRuleSet {
	rules: IgnoreRule[];
}

interface IgnoreRule {
	basePath: string;
	pattern: string;
	negated: boolean;
	directoryOnly: boolean;
	anchored: boolean;
	hasSlash: boolean;
	segmentRegExp: RegExp;
	pathRegExp: RegExp;
}

export interface FileReader {
	readFile(uri: UriComponents): Promise<string>;
	exists(uri: UriComponents): Promise<boolean>;
}

export async function loadGitignoreRules(
	projectRootUri: UriComponents,
	directoryUri: UriComponents,
	inheritedRules: CoggitIgnoreRuleSet,
	fileReader: FileReader,
): Promise<CoggitIgnoreRuleSet> {
	const gitignoreUri = joinUriPath(directoryUri, '.gitignore');
	if (!(await fileReader.exists(gitignoreUri))) {
		return inheritedRules;
	}

	const basePath = uriRelativePath(projectRootUri, directoryUri);
	if (basePath === undefined) {
		return inheritedRules;
	}
	const rules = parseGitignoreRules(await fileReader.readFile(gitignoreUri), normalizeRelativePath(basePath));
	return { rules: [...inheritedRules.rules, ...rules] };
}

export function isIgnoredByGitignoreRules(
	projectRootUri: UriComponents,
	ruleSet: CoggitIgnoreRuleSet,
	uri: UriComponents,
	isDirectory: boolean,
): boolean {
	const relativePath = uriRelativePath(projectRootUri, uri);
	if (relativePath === undefined || relativePath === '.') {
		return false;
	}

	let ignored = false;
	for (const rule of ruleSet.rules) {
		if (matchesRule(rule, relativePath, isDirectory)) {
			ignored = !rule.negated;
		}
	}
	return ignored;
}

function parseGitignoreRules(contents: string, basePath = '.'): IgnoreRule[] {
	return contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'))
		.map((line) => {
			const negated = line.startsWith('!');
			let pattern = negated ? line.slice(1) : line;
			const anchored = pattern.startsWith('/');
			pattern = anchored ? pattern.slice(1) : pattern;
			const directoryOnly = pattern.endsWith('/');
			pattern = directoryOnly ? pattern.slice(0, -1) : pattern;
			pattern = normalizeRelativePath(pattern);
			const hasSlash = pattern.includes('/');

			return {
				basePath: normalizeRelativePath(basePath),
				pattern,
				negated,
				directoryOnly,
				anchored,
				hasSlash,
				segmentRegExp: new RegExp(`^${globToRegExpSource(pattern)}$`),
				pathRegExp: new RegExp(`^${globToRegExpSource(pattern)}(?:/.*)?$`),
			};
		})
		.filter((rule) => rule.pattern.length > 0);
}

function matchesRule(rule: IgnoreRule, relativePath: string, isDirectory: boolean): boolean {
	const candidatePath = toRuleRelativePath(rule.basePath, relativePath);
	if (candidatePath === undefined || candidatePath === '.') {
		return false;
	}

	if (rule.directoryOnly && !isDirectory && !candidatePath.includes('/')) {
		return false;
	}

	if (rule.hasSlash) {
		const candidate = rule.anchored ? candidatePath : findMatchingSuffix(candidatePath, rule.pathRegExp);
		return candidate !== undefined && rule.pathRegExp.test(candidate);
	}

	const segments = candidatePath.split('/');
	const segmentLimit = rule.directoryOnly && !isDirectory ? segments.length - 1 : segments.length;
	for (let index = 0; index < segmentLimit; index++) {
		if (rule.segmentRegExp.test(segments[index])) {
			return true;
		}
	}
	return false;
}

function toRuleRelativePath(basePath: string, relativePath: string): string | undefined {
	if (basePath === '.') {
		return relativePath;
	}
	if (relativePath === basePath) {
		return '.';
	}
	const basePrefix = `${basePath}/`;
	return relativePath.startsWith(basePrefix) ? relativePath.slice(basePrefix.length) : undefined;
}

function findMatchingSuffix(relativePath: string, pathRegExp: RegExp): string | undefined {
	const segments = relativePath.split('/');
	for (let index = 0; index < segments.length; index++) {
		const suffix = segments.slice(index).join('/');
		if (pathRegExp.test(suffix)) {
			return suffix;
		}
	}
	return undefined;
}

function globToRegExpSource(pattern: string): string {
	let source = '';
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		const next = pattern[index + 1];
		if (char === '*' && next === '*') {
			source += '.*';
			index++;
			continue;
		}
		if (char === '*') {
			source += '[^/]*';
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		source += escapeRegExp(char);
	}
	return source;
}

function escapeRegExp(char: string): string {
	return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function normalizeRelativePath(targetPath: string): string {
	const normalized = targetPath.replace(/\\/g, '/');
	return normalized === '' ? '.' : normalized;
}

export const __testing__ = {
	parseGitignoreRules,
	matchesRule,
	isIgnoredByGitignoreRules,
};
