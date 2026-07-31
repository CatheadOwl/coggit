import { getCognitionHandbook, type CognitionKind } from '../core';

export function runHandbook(kind: CognitionKind | 'all'): string {
  return kind === 'all'
    ? getCognitionHandbook('all').content
    : getCognitionHandbook(kind).content;
}
