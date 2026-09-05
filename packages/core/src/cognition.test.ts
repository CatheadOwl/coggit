import * as assert from 'node:assert';

import { getCognitionHandbook, getCognitionTemplate } from './cognition/index';

suite('cognition prompt assets', () => {
  test('exposes skeleton-leaf-v4 versions for templates and handbooks', () => {
    assert.strictEqual(getCognitionTemplate('leaf').version, 'skeleton-leaf-v4');
    assert.strictEqual(getCognitionTemplate('skeleton').version, 'skeleton-leaf-v4');
    assert.strictEqual(getCognitionHandbook('leaf').version, 'skeleton-leaf-v4');
    assert.strictEqual(getCognitionHandbook('skeleton').version, 'skeleton-leaf-v4');
    assert.strictEqual(getCognitionHandbook().version, 'skeleton-leaf-v4');
  });

  test('keeps V3 source tracing fields in the leaf template', () => {
    const template = getCognitionTemplate('leaf').content;

    assert.match(template, /\*\*Source\*\*: ADR-003 \(Registry-as-core-module; local implication\)/u);
    assert.match(template, /design source collision/u);
    assert.match(template, /Optional\. Only include boundaries/u);
  });

  test('keeps V3 collision guidance in the handbooks', () => {
    const leaf = getCognitionHandbook('leaf').content;
    const skeleton = getCognitionHandbook('skeleton').content;

    assert.match(leaf, /Design Source & Collisions/u);
    assert.match(leaf, /record the collision as a Note/u);
    assert.match(leaf, /not to start routine source\s+auditing/u);
    assert.match(skeleton, /layer-wide design source collision/u);
    assert.match(skeleton, /inline note under the relevant invariant/u);
  });

  test('keeps the forward-guidance rule in the handbooks', () => {
    const leaf = getCognitionHandbook('leaf').content;
    const skeleton = getCognitionHandbook('skeleton').content;

    assert.match(leaf, /Forward-Looking Guidance/u);
    assert.match(leaf, /when P happens, do Q/u);
    assert.match(leaf, /time-based promises/u);
    assert.match(skeleton, /Forward-Looking Guidance/u);
    assert.match(skeleton, /condition is its own expiry trigger/u);
  });

  test('marks the aggregate handbook as deprecated compatibility content', () => {
    const aggregate = getCognitionHandbook().content;

    assert.match(aggregate, /Deprecated Aggregate Cognition Handbook/u);
    assert.match(aggregate, /`coggit handbook all` is deprecated/u);
    assert.match(aggregate, /`coggit handbook leaf`/u);
    assert.match(aggregate, /`coggit handbook skeleton`/u);
    assert.doesNotMatch(aggregate, /Design Source & Collisions/u);
  });
});
