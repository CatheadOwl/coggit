import * as vscode from 'vscode';

import type { NodeStatusResult } from '../../../core/types';

// File decoration badge mapping for VS Code.

export function badgeFromStatus(
  status: NodeStatusResult,
): vscode.FileDecoration | undefined {
  if (status.coverage?.ownCognition === 'missing' && !status.observedStatus) {
    const dec = new vscode.FileDecoration(
      'U',
      'No cognition file',
      new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
    );
    dec.propagate = true;
    return dec;
  }

  switch (status.observedStatus) {
    case 'fresh':
      return new vscode.FileDecoration(
        'F',
        'Cognition is fresh',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
      );
    case 'stale': {
      const dec = new vscode.FileDecoration(
        'S',
        'Cognition is stale',
        new vscode.ThemeColor('list.warningForeground'),
      );
      dec.propagate = true;
      return dec;
    }
    case 'conflict': {
      const dec = new vscode.FileDecoration(
        '!',
        'Conflicting evidence',
        new vscode.ThemeColor('errorForeground'),
      );
      dec.propagate = true;
      return dec;
    }
    default:
      return undefined;
  }
}
