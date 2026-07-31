import type { MisplacedCognitionEntry } from '../../../core/types';

export type MisplacedMoveState = 'pending' | 'succeeded' | 'failed';

export interface MisplacedTreeEntry extends MisplacedCognitionEntry {
  rootId: string;
  moveState: MisplacedMoveState;
  errorMessage?: string;
}
