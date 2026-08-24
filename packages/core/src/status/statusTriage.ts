import type { CoggitOperationAction } from '../operationTypes';
import type { CoggitNodeKind } from '../snapshotTypes';
import type { NodeStatusInspection } from './statusTypes';
import {
  mapStatusPresentationIssues,
  type StatusPresentationIssue,
} from './statusPresentation';

/**
 * Adapter-ready subtree triage view for a status hit: one entry per
 * issue-bearing node in the inspected node's projected issue set, grouping
 * that node's issues with its node-scoped next-step actions. Lets an adapter
 * answer "which descendants need attention, with what action and handbook
 * guidance" from one folder/root status call, without per-descendant
 * re-inspection.
 */
export interface StatusTriageView {
  /** Source-root-relative path of the inspected node. */
  sourcePath: string;
  /** Total projected issue count over the inspected node and its subtree. */
  issueCount: number;
  entries: StatusTriageEntry[];
}

export interface StatusTriageEntry {
  sourcePath: string;
  /** Expected paired cognition path; same expected-path semantics and null
   *  encoding as `StatusPresentationView.cognitionPath`. */
  cognitionPath: string | null;
  nodeKind: CoggitNodeKind;
  relation: 'own' | 'descendant';
  issues: StatusPresentationIssue[];
  /**
   * Node-scoped workflow actions. Facts-only (`[]`) for the own entry: the
   * inspected node's next steps remain exclusively in the top-level
   * `suggestedActions` channel. Handbook guidance rides the action-level
   * `handbookId` (ISSUE 20260819-2200); no parallel entry-level handbook
   * representation exists.
   */
  suggestedActions: CoggitOperationAction[];
}

/**
 * Project an inspection's synthesized triage facts into the adapter-ready
 * subtree triage view. Pure projection: the node-signal synthesis of
 * descendant-scoped actions happens in `status/` during inspection (which is
 * why this consumes the inspection, whose `triage` entries carry the matched
 * tree nodes' synthesized actions, rather than re-deriving actions from
 * `subtreeIssues`).
 *
 * This is a workflow/triage contract adjacent to the presentation, not a
 * `StatusPresentationView` scope variant: the presentation stays the
 * single-node fact projection, and adapters must not reintroduce `own` or
 * `subtree` presentation variants through it.
 */
export function projectStatusTriage(
  inspection: NodeStatusInspection,
): StatusTriageView {
  return {
    sourcePath: inspection.sourcePath,
    issueCount: inspection.issueSummary.total,
    entries: inspection.triage.map((entry) => ({
      sourcePath: entry.sourcePath,
      cognitionPath: entry.cognitionPath,
      nodeKind: entry.nodeKind,
      relation: entry.relation,
      issues: mapStatusPresentationIssues(entry.issues),
      suggestedActions: [...entry.actions],
    })),
  };
}
