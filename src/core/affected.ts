import type { AffectedResult, MappingIndex } from './types';

/**
 * Given changed source or cognition paths, calculate affected source-cognition pairs.
 * Phase 2 incremental refresh uses this to avoid full rebuilds when existing mapped
 * files change. Unknown create/delete paths are handled by the caller as full rebuilds.
 */
export function calculateAffected(
	changedPaths: string[],
	mapping: MappingIndex,
): AffectedResult {
	const direct = resolveDirectPairs(changedPaths, mapping);
	const structural = resolveStructuralPairs(direct, mapping);
	const semantic = resolveSemanticPairs(direct, mapping);
	const all = dedupePairs([...direct, ...structural, ...semantic]);

	return {
		pairs: all,
		stats: {
			direct: direct.length,
			structural: structural.length,
			semantic: semantic.length,
			total: all.length,
		},
	};
}

function resolveDirectPairs(
	changedPaths: string[],
	mapping: MappingIndex,
): AffectedResult['pairs'] {
	const pairs: AffectedResult['pairs'] = [];
	for (const changedPath of changedPaths) {
		const cognitionPaths = mapping.sourceToCognition.get(changedPath);
		if (cognitionPaths) {
			for (const cognitionPath of cognitionPaths) {
				pairs.push({
					sourcePath: changedPath,
					cognitionPath,
					reason: 'direct',
				});
			}
			continue;
		}

		const sourcePath = mapping.cognitionToSource.get(changedPath);
		if (sourcePath) {
			pairs.push({
				sourcePath,
				cognitionPath: changedPath,
				reason: 'direct',
			});
		}
	}
	return pairs;
}

function resolveStructuralPairs(
	directPairs: AffectedResult['pairs'],
	mapping: MappingIndex,
): AffectedResult['pairs'] {
	const seen = new Set<string>();
	const pairs: AffectedResult['pairs'] = [];

	const existing = new Set(
		directPairs.map((p) => `${p.sourcePath}→${p.cognitionPath}`),
	);

	for (const edge of mapping.structuralEdges) {
		for (const pair of directPairs) {
			if (edge.from === pair.sourcePath) {
				const cognitions =
					mapping.sourceToCognition.get(edge.to) ?? [];
				for (const cPath of cognitions) {
					const key = `${edge.to}→${cPath}`;
					if (!existing.has(key) && !seen.has(key)) {
						seen.add(key);
						pairs.push({
							sourcePath: edge.to,
							cognitionPath: cPath,
							reason: 'structural',
						});
					}
				}
			}
		}
	}

	return pairs;
}

function resolveSemanticPairs(
	directPairs: AffectedResult['pairs'],
	mapping: MappingIndex,
): AffectedResult['pairs'] {
	const seen = new Set<string>();
	const pairs: AffectedResult['pairs'] = [];

	const changedSources = new Set(directPairs.map((p) => p.sourcePath));

	for (const edge of mapping.semanticEdges) {
		if (changedSources.has(edge.from)) {
			const cognitionPaths =
				mapping.sourceToCognition.get(edge.to) ?? [];
			for (const cPath of cognitionPaths) {
				const key = `${edge.to}→${cPath}`;
				if (!seen.has(key)) {
					seen.add(key);
					pairs.push({
						sourcePath: edge.to,
						cognitionPath: cPath,
						reason: 'semantic',
					});
				}
			}
		}
	}

	return pairs;
}

function dedupePairs(
	pairs: AffectedResult['pairs'],
): AffectedResult['pairs'] {
	const seen = new Set<string>();
	return pairs.filter((p) => {
		const key = `${p.sourcePath}→${p.cognitionPath}`;
		if (seen.has(key)) {return false;}
		seen.add(key);
		return true;
	});
}
