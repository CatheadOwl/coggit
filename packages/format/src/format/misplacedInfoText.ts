/**
 * Build the multi-line info text for a misplaced cognition entry,
 * suitable for tooltips or clipboard copy.
 */
export interface MisplacedInfoTextInput {
  sourcePath: string;
  actualCognitionPath: string;
  expectedCognitionPath: string;
  errorMessage?: string;
}

export function buildMisplacedInfoText(entry: MisplacedInfoTextInput): string {
  const lines: string[] = [];
  lines.push(`**Source**: \`${entry.sourcePath}\``);
  lines.push(`**Actual cognition**: \`${entry.actualCognitionPath}\``);
  lines.push(`**Expected cognition**: \`${entry.expectedCognitionPath}\``);
  if (entry.errorMessage) {
    lines.push('');
    lines.push(`**⚠ Error**: ${entry.errorMessage}`);
  }
  return lines.join('  \n');
}
