import type { NodeStatusInspection, NodeStatusResult } from '../core/types';
import { describeObservedStatus, projectStatusPresentation, renderStatusPresentation } from '../core';
import type { FormatStyle } from './structFormat.js';

// ── Shared: tooltip and clipboard produce the same content structure ─────────
// Only the rendering style differs: tooltip uses VSCode markdown (`**bold**`,
// `  \n`), clipboard uses plain text (`\n`, no bold).
//
// Inspection format:
//   Status: <label>
//   Source: <path>
//   Cognition: <path>
//
//   Own issues: <n>
//   - <path>: [<severity>] <message> Suggested actions: ...
//
//   Descendant issues: <n>
//   - <path>: [<severity>] <message> Suggested actions: ...

function formatNodeText(
  sourceRelativePath: string,
  cognitionRelativePath: string | undefined,
  status: NodeStatusResult | undefined,
  style: FormatStyle,
  options: { includeIssues?: boolean } = {},
): string {
  const lineSep = style === 'tooltip' ? '  \n' : '\n';
  const blockSep = style === 'tooltip' ? '  \n  \n' : '\n\n';
  const bu = (text: string) => (style === 'clipboard' ? text : `**${text}**`);
  const includeIssues = options.includeIssues ?? true;

  let text = `${bu('Source')}: ${sourceRelativePath}`;
  if (cognitionRelativePath !== undefined) {
    text += `${lineSep}${bu('Cognition')}: ${cognitionRelativePath}`;
  }

  if (status) {
    const statusLabel = describeObservedStatus(status.observedStatus);
    if (statusLabel) {
      text += `${blockSep}${bu('Status')}: ${statusLabel}`;
      text += `${lineSep}${bu('Own status')}: ${describeObservedStatus(status.ownObservedStatus) ?? 'None'}`;
    }

    if (includeIssues) {
      // Diagnostics with related file paths — limit to 3 for tooltip, full for clipboard.
      const issues = status.issues ?? [];
      const maxIssues = style === 'tooltip' ? Math.min(issues.length, 3) : issues.length;
      for (let i = 0; i < maxIssues; i++) {
        const diag = issues[i].diagnostic;
        let line = `${lineSep}[${diag.severity}] ${diag.message}`;
        if (diag.relatedPaths?.length) {
          line += ` [${diag.relatedPaths.join(', ')}]`;
        }
        text += line;
      }
      const overflow = issues.length - maxIssues;
      if (overflow > 0) {
        text += `${lineSep}(+${overflow} more)`;
      }

      // Actions: compact one-liner
      const actions = issues.flatMap((i) => i.actions.map((a) => a.label));
      if (actions.length > 0) {
        text += `${lineSep}→ ${actions.join(' | ')}`;
      }
    }
  }

  return text;
}

// ── Tooltip (VSCode TreeItem markdown tooltip) ──────────────────────────────
// Relative paths + status blocks in VSCode-friendly markdown.

export function tooltipText(
  sourceRelativePath: string,
  cognitionRelativePath?: string,
  status?: NodeStatusResult,
): string {
  return formatNodeText(sourceRelativePath, cognitionRelativePath, status, 'tooltip');
}

// ── Clipboard (plain text) ──────────────────────────────────────────────────
// Same information structure as tooltip, rendered as plain text.

export function clipboardText(
  sourceRelativePath: string,
  cognitionRelativePath?: string,
  status?: NodeStatusResult,
): string {
  return formatNodeText(sourceRelativePath, cognitionRelativePath, status, 'clipboard');
}

export function tooltipNodeStatusText(inspection: NodeStatusInspection): string {
  return renderStatusPresentation(projectStatusPresentation(inspection), 'markdown');
}

export function clipboardNodeStatusText(inspection: NodeStatusInspection): string {
  return renderStatusPresentation(projectStatusPresentation(inspection), 'text');
}
