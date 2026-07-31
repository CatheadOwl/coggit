export function formatTimestamp(value: number | null, noneLabel: string): string {
	return value === null ? noneLabel : new Date(value).toISOString();
}

export function latestAcceptedTime(
	cognitionMtimeMs: number | null,
	verificationTimeMs: number | null,
): number | null {
	if (cognitionMtimeMs === null) {
		return verificationTimeMs;
	}
	if (verificationTimeMs === null) {
		return cognitionMtimeMs;
	}
	return Math.max(cognitionMtimeMs, verificationTimeMs);
}
