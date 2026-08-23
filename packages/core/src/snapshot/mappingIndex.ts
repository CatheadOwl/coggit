import type { CoggitTreeNode, MappingIndex } from '../types';
import { uriKey } from '../uri-utils';

export function buildMappingIndex(nodes: CoggitTreeNode[]): MappingIndex {
	const sourceToCognition = new Map<string, string[]>();
	const cognitionToSource = new Map<string, string>();
	const structuralEdges: Array<{ from: string; to: string; kind: 'parent' | 'child' | 'sibling' }> = [];
	const semanticEdges: Array<{ from: string; to: string; kind: 'link' | 'backlink' }> = [];

	for (const node of nodes) {
		const sourcePath = uriKey(node.sourceUri);
		const cognitionPath = node.cognitionUri ? uriKey(node.cognitionUri) : undefined;
		if (!cognitionPath) {
			continue;
		}

		const existing = sourceToCognition.get(sourcePath) ?? [];
		existing.push(cognitionPath);
		sourceToCognition.set(sourcePath, existing);

		cognitionToSource.set(cognitionPath, sourcePath);

		if (node.parent && node.parent.sourceUri) {
			const parentPath = uriKey(node.parent.sourceUri);
			structuralEdges.push({
				from: parentPath,
				to: sourcePath,
				kind: 'child',
			});
			structuralEdges.push({
				from: sourcePath,
				to: parentPath,
				kind: 'parent',
			});
		}
	}

	return {
		sourceToCognition,
		cognitionToSource,
		structuralEdges,
		semanticEdges,
	};
}
