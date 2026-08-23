// Structured format pipeline — block-based rendering for agent-facing output.
//
// Data → typed blocks → standardized string.
// Snapshot and list outputs use this pipeline; node status detail rendering
// lives in nodeFormat.ts so VS Code, MCP, copy, and future CLI paths share one
// node-aware formatter.

import type { CoggitSnapshot, CoggitTreeNode, NodeStatusResult } from '@coggit/core';
import type { StatusIssue } from '@coggit/core/internal';
import { describeObservedStatus } from '@coggit/core';

// ── Block Types ──────────────────────────────────────────────────────────────────

export interface StatusLineBlock {
  type: 'status-line';
  label?: string;
  /** agent: "path: **label**" */
  path?: string;
  /** tooltip/clipboard: "**heading**: label" or "heading: label" */
  heading?: string;
}

export interface MessageItem {
  severity: string;
  message: string;
  relatedPaths?: string[];
}

export interface MessageListBlock {
  type: 'message-list';
  heading: string;
  messages: MessageItem[];
  config?: {
    max?: number;
    showPaths?: boolean;
  };
}

export interface KVPair {
  label: string;
  value: unknown;
}

export interface KVPairsBlock {
  type: 'kv-list';
  heading?: string;
  pairs: KVPair[];
}

export interface IssueListBlock {
  type: 'issue-list';
  heading: string;
  issues: StatusIssue[];
  config?: {
    max?: number;
    showPaths?: boolean;
  };
}

export interface ActionListBlock {
  type: 'action-list';
  heading: string;
  actions: string[];
  config?: {
    max?: number;
  };
}

export interface TimestampBlock {
  type: 'timestamp';
  value: number;
}

export interface TreeBlock {
  type: 'tree';
  roots: CoggitTreeNode[];
}

export interface FileListBlock {
  type: 'file-list';
  nodes: CoggitTreeNode[];
  tag: string;
}

export interface GroupBlock {
  type: 'group';
  heading: string;
  children: Block[];
}

export type Block =
  | StatusLineBlock
  | MessageListBlock
  | IssueListBlock
  | KVPairsBlock
  | ActionListBlock
  | TimestampBlock
  | TreeBlock
  | FileListBlock
  | GroupBlock;

// ── Style ─────────────────────────────────────────────────────────────────────────

export type FormatStyle = 'agent' | 'tooltip' | 'clipboard';

// ── Style Helpers ─────────────────────────────────────────────────────────────────

/** Bold wrapper — agent and tooltip use `**bold**`, clipboard is plain. */
function b(text: string, style: FormatStyle): string {
  return style === 'clipboard' ? text : `**${text}**`;
}

/** Line separator within a block. */
function nl(style: FormatStyle): string {
  return style === 'tooltip' ? '  \n' : '\n';
}

/** Section separator between blocks. */
function sectionSep(style: FormatStyle): string {
  return style === 'agent' ? '\n\n' : style === 'tooltip' ? '  \n' : '\n';
}

// ── Block Renderers ───────────────────────────────────────────────────────────────

function renderStatusLine(block: StatusLineBlock, style: FormatStyle): string {
  const label = block.label ?? 'unknown';
  switch (style) {
    case 'agent':
      return `${block.path ?? '?'}: ${b(label, style)}`;
    case 'tooltip':
      return `${b(block.heading ?? 'Status', style)}: ${label}`;
    case 'clipboard':
      return `${block.heading ?? 'Status'}: ${label}`;
  }
}

function renderMessageList(block: MessageListBlock, style: FormatStyle): string {
  const max = block.config?.max;
  const items = max !== undefined ? block.messages.slice(0, max) : block.messages;
  if (items.length === 0) {return '';}

  const separator = nl(style);
  const lines: string[] = [b(block.heading, style)];
  for (const m of items) {
    let line = `  [${m.severity}] ${m.message}`;
    if (block.config?.showPaths && m.relatedPaths?.length) {
      line += ` [${m.relatedPaths.join(', ')}]`;
    }
    lines.push(line);
  }
  const overflow = block.messages.length - items.length;
  if (overflow > 0) {
    lines.push(`  (+${overflow} more)`);
  }
  return lines.join(separator);
}

function renderIssueList(block: IssueListBlock, style: FormatStyle): string {
  const max = block.config?.max;
  const items = max !== undefined ? block.issues.slice(0, max) : block.issues;
  if (items.length === 0) {return '';}

  const separator = nl(style);
  const lines: string[] = [b(block.heading, style)];
  for (const item of items) {
    const diagnostic = item.diagnostic;
    let line = `  [${diagnostic.severity}] ${diagnostic.message}`;
    if (block.config?.showPaths && diagnostic.relatedPaths?.length) {
      line += ` [${diagnostic.relatedPaths.join(', ')}]`;
    }
    lines.push(line);
    for (const action of item.actions) {
      lines.push(`    Action: ${action.label}`);
    }
  }
  const overflow = block.issues.length - items.length;
  if (overflow > 0) {
    lines.push(`  (+${overflow} more)`);
  }
  return lines.join(separator);
}

function renderKVPairs(block: KVPairsBlock, style: FormatStyle): string {
  const pairs = block.pairs.filter(
    (p) => p.value !== undefined && p.value !== null,
  );
  if (pairs.length === 0) {return '';}

  // tooltip/clipboard: render as a single inline line
  if (style !== 'agent') {
    const kvText = pairs.map((p) => `${p.label} ${p.value}`).join(', ');
    const h = block.heading ? `${b(block.heading, style)}: ` : '';
    return `${h}${kvText}`;
  }

  // agent: render as multi-line kv list
  const lines: string[] = [];
  if (block.heading) {lines.push(b(block.heading, style));}
  for (const p of pairs) {
    lines.push(`  ${p.label}: ${String(p.value)}`);
  }
  return lines.join('\n');
}

function renderActionList(block: ActionListBlock, style: FormatStyle): string {
  const max = block.config?.max;
  const items = max !== undefined ? block.actions.slice(0, max) : block.actions;
  if (items.length === 0) {return '';}

  const separator = nl(style);
  const lines: string[] = [b(block.heading, style)];
  for (const a of items) {
    lines.push(`  - ${a}`);
  }
  const overflow = block.actions.length - items.length;
  if (overflow > 0) {
    lines.push(`  (+${overflow} more)`);
  }
  return lines.join(separator);
}

function renderTimestamp(block: TimestampBlock, _style: FormatStyle): string {
  const ts = new Date(block.value).toISOString();
  return `_(computed at ${ts})_`;
}

function renderTreeNode(node: CoggitTreeNode, depth: number): string {
  const desc = describeObservedStatus(node.status?.observedStatus);
  if (!desc) {return '';}

  const indent = '  '.repeat(depth);
  const renderedChildren = (node.children ?? [])
    .map((child) => renderTreeNode(child, depth + 1))
    .filter((s) => s.length > 0);

  let line = `${indent}${node.label} [${desc}]`;
  if (renderedChildren.length > 0) {
    line += '\n' + renderedChildren.join('\n');
  }
  return line;
}

function renderTreeBlock(block: TreeBlock, _style: FormatStyle): string {
  const lines: string[] = [];
  for (const root of block.roots) {
    lines.push(renderTreeNode(root, 0));
  }
  return lines.join('\n');
}

function renderFileListBlock(
  block: FileListBlock,
  _style: FormatStyle,
): string {
  if (block.nodes.length === 0) {
    return `No ${block.tag} files found.`;
  }
  const lines: string[] = [`Found ${block.nodes.length} ${block.tag} file(s):\n`];
  for (const node of block.nodes) {
    lines.push(node.relativePath);
  }
  return lines.join('\n');
}

function renderGroup(block: GroupBlock, style: FormatStyle): string {
  const children = block.children
    .map((c) => renderBlock(c, style))
    .filter((s) => s.length > 0);
  if (children.length === 0) {return '';}

  const lines =
    style === 'clipboard'
      ? children
      : [b(block.heading, style), ...children];
  return lines.join(nl(style));
}

function renderBlock(block: Block, style: FormatStyle): string {
  switch (block.type) {
    case 'status-line':
      return renderStatusLine(block, style);
    case 'message-list':
      return renderMessageList(block, style);
    case 'issue-list':
      return renderIssueList(block, style);
    case 'kv-list':
      return renderKVPairs(block, style);
    case 'action-list':
      return renderActionList(block, style);
    case 'timestamp':
      return renderTimestamp(block, style);
    case 'tree':
      return renderTreeBlock(block, style);
    case 'file-list':
      return renderFileListBlock(block, style);
    case 'group':
      return renderGroup(block, style);
  }
}

// ── Pipeline Entry Point ──────────────────────────────────────────────────────────

/**
 * Convert an ordered list of blocks into a formatted string.
 *
 * @param blocks - The blocks to render, in display order.
 * @param style  - `'agent'` (LLM-facing, bold + `\n\n` sections),
 *                 `'tooltip'` (VS Code markdown, bold + `  \n` line breaks),
 *                 `'clipboard'` (plain text, no bold).
 */
export function composeBlocks(
  blocks: Block[],
  style: FormatStyle = 'agent',
): string {
  const rendered = blocks
    .map((b) => renderBlock(b, style))
    .filter((s) => s.length > 0);
  return rendered.join(sectionSep(style));
}

// ── Shared Helpers ────────────────────────────────────────────────────────────────

export function actionLabelsFromIssues(issues: Iterable<StatusIssue> | undefined): string[] {
  return Array.from(issues ?? []).flatMap((statusIssue) =>
    statusIssue.actions.map((action) => action.label),
  );
}

/**
 * Convert a `NodeStatusResult` into blocks shared by tooltip, clipboard, and
 * partial status displays.
 *
 * @param status   - The node status to render.
 * @param truncate - `true` for tooltip (limit issues to 3).
 */
export function blocksFromNodeStatus(
  status: NodeStatusResult,
  truncate?: boolean,
): Block[] {
  const blocks: Block[] = [];

  blocks.push({
    type: 'status-line',
    heading: 'Status',
    label: describeObservedStatus(status.observedStatus),
  });

  if (status.issues?.length) {
    blocks.push({
      type: 'issue-list',
      heading: 'Diagnostics',
      issues: status.issues,
      config: { max: truncate ? 3 : undefined, showPaths: true },
    });
  }

  if (status.coverage) {
    blocks.push({
      type: 'kv-list',
      heading: 'Coverage',
      pairs: [
        { label: 'Own', value: status.coverage.ownCognition },
        { label: 'Covered', value: status.coverage.coveredCount },
        { label: 'Missing', value: status.coverage.missingMaterializableCount },
      ],
    });
  }

  return blocks;
}

// ── Standard Agent-Facing Layouts ─────────────────────────────────────────────────

/**
 * Standardized indented snapshot tree (agent style).
 */
export function formatSnapshot(snapshot: CoggitSnapshot): string {
  return composeBlocks([{ type: 'tree', roots: snapshot.roots }], 'agent');
}

/**
 * Standardized file list with count heading (agent style).
 */
export function formatFileList(
  nodes: CoggitTreeNode[],
  tag: string,
): string {
  return composeBlocks([{ type: 'file-list', nodes, tag }], 'agent');
}

// describeObservedStatus is re-exported from core/status
