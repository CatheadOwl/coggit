import { getCognitionHandbook, type CognitionKind } from '@coggit/core';

export function runHandbook(kind: CognitionKind | 'all'): string {
  return kind === 'all'
    ? getCognitionHandbook('all').content
    : getCognitionHandbook(kind).content;
}
