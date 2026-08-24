import type {
	MaintenanceDiagnostic,
	MisplacedCognitionEntry,
	OrphanedCognitionEntry,
	StrayCognitionEntry,
	UnboundCognitionEntry,
} from './types';

export type MaintenancePresentationFormat = 'text' | 'markdown';

export type MaintenanceIssueCode =
	| 'tracked-source-missing'
	| 'cognition-path-out-of-sync'
	| 'unregistered-cognition'
	| 'unbound-cognition'
	| 'missing-source-candidate';

export interface MaintenancePresentationItem {
	kind: MaintenanceDiagnostic['kind'];
	issueCode: MaintenanceIssueCode;
	severity: 'warning';
	path: string;
	message: string;
	hint: string;
}

export interface MaintenancePresentationView {
	items: MaintenancePresentationItem[];
}

function orphanedItem(entry: OrphanedCognitionEntry): MaintenancePresentationItem {
	return {
		kind: 'orphaned',
		issueCode: 'tracked-source-missing',
		severity: 'warning',
		path: entry.cognitionPath,
		message: `paired source ${entry.sourcePath} is missing while the cognition file remains`,
		hint: 'Restore the source, or move the cognition file to the new source mirror path.',
	};
}

function misplacedItem(entry: MisplacedCognitionEntry): MaintenancePresentationItem {
	return {
		kind: 'misplaced',
		issueCode: 'cognition-path-out-of-sync',
		severity: 'warning',
		path: entry.actualCognitionPath,
		message: 'cognition path does not mirror its bound source',
		hint: `Move cognition to ${entry.expectedCognitionPath}.`,
	};
}

function strayItem(entry: StrayCognitionEntry): MaintenancePresentationItem {
	return {
		kind: 'stray',
		issueCode: 'unregistered-cognition',
		severity: 'warning',
		path: entry.cognitionPath,
		message: 'cognition-shaped markdown is not yet registered',
		hint: 'Reconcile registers source-paired cognition automatically; verify the file is source-paired.',
	};
}

function unboundItem(entry: UnboundCognitionEntry): MaintenancePresentationItem {
	if (entry.sourceCandidateState === 'all-missing') {
		return {
			kind: 'unbound',
			issueCode: 'missing-source-candidate',
			severity: 'warning',
			path: entry.cognitionPath,
			message: 'cognition-shaped markdown has no likely source candidate',
			hint: 'Bind it to the intended source explicitly before accepting, or remove it.',
		};
	}

	return {
		kind: 'unbound',
		issueCode: 'unbound-cognition',
		severity: 'warning',
		path: entry.cognitionPath,
		message: 'cognition-shaped markdown is not bound to a source',
		hint: 'Inspect the likely source candidates or bind explicitly before accepting.',
	};
}

export function projectMaintenancePresentation(
	diagnostics: readonly MaintenanceDiagnostic[],
): MaintenancePresentationView {
	return {
		items: diagnostics.map((diagnostic) => {
			switch (diagnostic.kind) {
				case 'orphaned':
					return orphanedItem(diagnostic.entry);
				case 'misplaced':
					return misplacedItem(diagnostic.entry);
				case 'stray':
					return strayItem(diagnostic.entry);
				case 'unbound':
					return unboundItem(diagnostic.entry);
			}
		}),
	};
}

export function renderMaintenancePresentation(
	view: MaintenancePresentationView,
	format: MaintenancePresentationFormat = 'text',
): string {
	const markdown = format === 'markdown';
	const lineBreak = markdown ? '  \n' : '\n';
	const label = (value: string) => markdown ? `**${value}**` : value;

	if (view.items.length === 0) {
		return 'No cognition maintenance issues found.';
	}

	const lines: string[] = [`${label('Maintenance issues')}: ${view.items.length}`];
	for (const item of view.items) {
		lines.push(`- ${item.severity} ${item.issueCode} ${item.path}: ${item.message}. ${item.hint}`);
	}

	return lines.join(lineBreak);
}
