import * as vscode from 'vscode';

import type { MisplacedTreeEntry } from './misplacedTreeTypes';
import { buildMisplacedInfoText } from '@coggit/format';

/**
 * Tree data provider for misplaced cognition files —
 * cognition files whose actual path does not match the expected mirror path.
 */
export class MisplacedTreeDataProvider implements vscode.TreeDataProvider<MisplacedTreeEntry> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MisplacedTreeEntry | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly getEntries: () => MisplacedTreeEntry[],
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /** Build plain text for copying to clipboard. */
  buildCopyText(entry: MisplacedTreeEntry): string {
    return buildMisplacedInfoText(entry);
  }

  /** Refresh a single item (e.g. after a move attempt). */
  refreshItem(entry: MisplacedTreeEntry): void {
    this.onDidChangeTreeDataEmitter.fire(entry);
  }

  getTreeItem(element: MisplacedTreeEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.sourcePath,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `misplaced-${element.rootId}-${element.registryKey}-${element.sourcePath}`;
    item.description = `→ ${element.expectedCognitionPath}`;
    item.tooltip = this.buildTooltip(element);
    item.contextValue = this.getContextValue(element);

    // Failed items are styled with an error icon
    if (element.moveState === 'failed') {
      item.iconPath = new vscode.ThemeIcon(
        'error',
        new vscode.ThemeColor('list.errorForeground'),
      );
    } else {
      item.iconPath = new vscode.ThemeIcon('file-symlink-file');
    }

    return item;
  }

  getChildren(element?: MisplacedTreeEntry): MisplacedTreeEntry[] {
    // Flat list — no hierarchy
    if (element) {
      return [];
    }
    return this.getEntries();
  }

  getParent(_element: MisplacedTreeEntry): MisplacedTreeEntry | undefined {
    return undefined;
  }

  private getContextValue(entry: MisplacedTreeEntry): string {
    if (entry.moveState === 'failed') {
      return 'misplacedCognitionFailed';
    }
    if (entry.moveState === 'succeeded') {
      // Succeeded items are skipped by the provider; this is defensive
      return 'misplacedCognitionDone';
    }
    return 'misplacedCognition';
  }

  private buildTooltip(entry: MisplacedTreeEntry): string | vscode.MarkdownString {
    return new vscode.MarkdownString(buildMisplacedInfoText(entry));
  }
}
