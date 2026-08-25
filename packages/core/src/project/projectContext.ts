import type { CoggitProject } from '../interfaces';
import type { CoggitProjectContext, CoggitWorkspaceRoot } from '../types';
import { toRelativeUriPath } from '../mapping';
import { uriKey } from '../uri-utils';

export function projectContextFromRoot(root: CoggitWorkspaceRoot): CoggitProjectContext {
	return {
		label: root.label,
		configUri: uriKey(root.configUri),
		projectRootUri: uriKey(root.projectRootUri),
		sourceRoot: toRelativeUriPath(root.projectRootUri, root.sourceRootUri),
		cognitionRoot: toRelativeUriPath(root.projectRootUri, root.cognitionRootUri),
		sourcePathRule: 'Use project-root-relative paths with CogGit tools, for example src/main.ts, src/app, or ".".',
	};
}

export function projectContext(project: CoggitProject): CoggitProjectContext {
	return projectContextFromRoot(project.root);
}
