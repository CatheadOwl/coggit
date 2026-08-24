import type { AcceptanceStore } from './interfaces';
import type { AcceptedPair } from './registryTypes';
import { isTemplateContent } from './status/evidence';
import { computeCognitionIdentity } from './hash';

export interface AcceptCurrentPairResult {
	accepted: AcceptedPair | null;
	changed: boolean;
}

export function acceptCurrentPair(
	store: AcceptanceStore,
	rootId: string,
	sourceKey: string,
	sourceIdentity: AcceptedPair['source'],
	cognitionContent: string | null,
): AcceptCurrentPairResult {
	const accepted = store.getAcceptedPair(rootId, sourceKey);
	if (cognitionContent === null) {
		return { accepted, changed: false };
	}

	const current = {
		source: sourceIdentity,
		cognition: computeCognitionIdentity(cognitionContent),
	};
	const shouldBootstrap = accepted === null && !isTemplateContent(cognitionContent);
	const cognitionOnlyChange = accepted !== null
		&& accepted.source === current.source
		&& accepted.cognition !== current.cognition;
	const orderedSourceThenCognitionChange = accepted !== null
		&& accepted.source !== current.source
		&& accepted.cognition !== current.cognition
		&& store.hasSourceBeforeCognitionEvidence(rootId, sourceKey, current);

	if (shouldBootstrap || cognitionOnlyChange || orderedSourceThenCognitionChange) {
		store.acceptPair(rootId, sourceKey, current);
		return { accepted: current, changed: true };
	}
	return { accepted, changed: false };
}
