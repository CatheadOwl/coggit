// Shared presentation format layer — consumable by VS Code UI, MCP, CLI, and clipboard.
//
// Every formatter is a pure function: data → formatted string.
// To add a new output target, create a new formatter file and re-export here.

// High-level text formatters
export { tooltipText, clipboardText, tooltipNodeStatusText, clipboardNodeStatusText } from './nodeFormat.js';
export { buildMisplacedInfoText } from './misplacedInfoText.js';
export { nodeTooltip, nodeClipboardStatusText } from './nodePresentation.js';
export { snapshotTreeText, nodeSnapshotTreeText, listText } from './snapshotFormat.js';
export type { SnapshotScope, SnapshotTreeTextOptions } from './snapshotFormat.js';
export { routesContentText } from './routesFormat.js';
export type { RoutesTextSurface } from './routesFormat.js';

// Structured pipeline (block-based agent-facing output)
export {
  composeBlocks,
  formatSnapshot,
  formatFileList,
  blocksFromNodeStatus,
} from './structFormat.js';

export type {
  Block,
  FormatStyle,
  StatusLineBlock,
  MessageListBlock,
  MessageItem,
  KVPairsBlock,
  KVPair,
  ActionListBlock,
  TimestampBlock,
  TreeBlock,
  FileListBlock,
  GroupBlock,
} from './structFormat.js';
