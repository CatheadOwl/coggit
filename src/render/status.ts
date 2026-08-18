import type { NodeStatusInspection } from '../core/types';
import { projectStatusPresentation, renderStatusPresentation } from '../core';

export function renderStatusSectionsText(sections: readonly string[]): string {
  return sections.join('\n\n');
}

// ─── Inspection-based CLI rendering ─────────────────────────────────────────

export function renderNodeStatusInspectionText(
  inspection: NodeStatusInspection,
  mode: 'aggregate' | 'own' | 'subtree',
): string {
  return renderStatusPresentation(projectStatusPresentation(inspection, mode), 'text');
}
