import * as vscode from 'vscode';

import type { CoggitLogEvent, CoggitLogLevel, CoggitLogger } from '../../../core';

const LOG_LEVEL_PRIORITIES: Record<CoggitLogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

type VscodeLogLevel = CoggitLogLevel | 'off';

/**
 * Create a VS Code output-channel logger controlled by `coggit.logging.level`.
 */
export function createVscodeCoggitLogger(channel: vscode.OutputChannel): CoggitLogger {
	return {
		log(event: CoggitLogEvent): void {
			const configuredLevel = getConfiguredLogLevel();
			if (configuredLevel === 'off') {
				return;
			}
			if (LOG_LEVEL_PRIORITIES[event.level] < LOG_LEVEL_PRIORITIES[configuredLevel]) {
				return;
			}

			const payload = event.data && Object.keys(event.data).length > 0
				? ` ${JSON.stringify(event.data)}`
				: '';
			channel.appendLine(`[${event.level}] ${event.category}: ${event.message}${payload}`);
		},
	};
}

function getConfiguredLogLevel(): VscodeLogLevel {
	const value = vscode.workspace
		.getConfiguration('coggit')
		.get<string>('logging.level', 'off')
		.toLowerCase();

	if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
		return value;
	}

	return 'off';
}
