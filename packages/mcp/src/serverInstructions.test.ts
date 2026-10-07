import * as assert from 'node:assert';
import { STANDARD_SYSTEM_PROMPT_SEGMENTS } from '@coggit/core';

import { handbookUri, MCP_TOOL_NAMES } from './operationDto/shared';
import { COGNITION_ROOTS_RESOURCE_URI } from './resources';
import { MCP_SERVER_INSTRUCTIONS } from './serverInstructions';

function coreSegmentText(key: string): string {
  const segment = STANDARD_SYSTEM_PROMPT_SEGMENTS.find((entry) => entry.key === key);
  assert.ok(segment !== undefined, `core standard form has no segment '${key}'`);
  return segment.text;
}

const RE_ADDRESSED_SEGMENT_KEYS = [
  'roots',
  'snapshot',
  'indexing',
  'delegation',
  'contradictions',
] as const;

suite('MCP server instructions derivation', () => {
  test('re-addresses operations onto MCP surface through the seams', () => {
    assert.ok(MCP_SERVER_INSTRUCTIONS.includes(COGNITION_ROOTS_RESOURCE_URI));
    assert.ok(MCP_SERVER_INSTRUCTIONS.includes(MCP_TOOL_NAMES.snapshot));
    assert.ok(MCP_SERVER_INSTRUCTIONS.includes(MCP_TOOL_NAMES.status));
    assert.ok(MCP_SERVER_INSTRUCTIONS.includes(handbookUri('leaf').replace('leaf', '<kind>')));
    assert.match(MCP_SERVER_INSTRUCTIONS, /CogGit MCP indexes/);
  });

  test('derivation is positional over the core segments', () => {
    const lines = MCP_SERVER_INSTRUCTIONS.split('\n');
    assert.strictEqual(lines.length, STANDARD_SYSTEM_PROMPT_SEGMENTS.length);
    for (const [index, segment] of STANDARD_SYSTEM_PROMPT_SEGMENTS.entries()) {
      if ((RE_ADDRESSED_SEGMENT_KEYS as readonly string[]).includes(segment.key)) {
        assert.notStrictEqual(lines[index], segment.text);
      } else {
        assert.strictEqual(lines[index], segment.text);
      }
    }
  });

  test('paired-document vocabulary is canonical in the derived instructions', () => {
    assert.match(MCP_SERVER_INSTRUCTIONS, /cognition document/);
    assert.doesNotMatch(MCP_SERVER_INSTRUCTIONS, /design note|cognition files/);
  });

  test('non-re-addressed segments pass through byte-equal to the core standard form', () => {
    for (const key of ['records', 'mirror', 'upkeep'] as const) {
      assert.ok(MCP_SERVER_INSTRUCTIONS.includes(coreSegmentText(key)));
    }
  });

  test('mirror rule keeps the append semantics explicit', () => {
    assert.match(MCP_SERVER_INSTRUCTIONS, /`\.md` appended \(`src\/foo\.ts` pairs with `src\/foo\.ts\.md`\)/);
    assert.doesNotMatch(MCP_SERVER_INSTRUCTIONS, /without the trailing \.md/);
  });

  test('no CLI-baseline command spelling leaks into the MCP surface', () => {
    assert.doesNotMatch(MCP_SERVER_INSTRUCTIONS, /coggit (snapshot|status|handbook)/);
  });

  test('the neutral operation phrasing is re-voiced, not passed through', () => {
    assert.doesNotMatch(MCP_SERVER_INSTRUCTIONS, /the (snapshot|status) operation/);
    assert.doesNotMatch(MCP_SERVER_INSTRUCTIONS, /handbook guidance for the cognition kind/);
  });
});
