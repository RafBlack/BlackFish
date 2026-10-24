import test from 'node:test';
import assert from 'node:assert/strict';
import { bfAggregateScore, signal, EvidenceStore, RULES } from '../../lib/heuristics/score.js';
test('100 identical observations never stack; removed evidence disappears', () => {
  const store = new EvidenceStore();
  for (let i = 0; i < 100; i++) {
    store.replace('forms', Array(8).fill(signal('cross-origin-credential-form', 'Different destination')));
    assert.equal(store.score().score, 35);
    assert.equal(store.score().signals.length, 1);
  }
  store.replace('forms', []); assert.equal(store.score().score, 0);
});
test('related identity rules contribute only the strongest weight', () => {
  const s = bfAggregateScore([[signal('typosquat-domain','typo'), signal('homograph-domain','homograph'), signal('brand-name-domain-mismatch','title')]]);
  assert.equal(s.score, 45);
  assert.equal(s.signals.reduce((a,b) => a+b.contribution,0),45);
});
test('weak supporting indicators cannot create a warning alone', () => {
  const signals = Object.entries(RULES).filter(([,r]) => r[1] === 'support').map(([id]) => signal(id,id));
  assert.equal(bfAggregateScore([signals]).score,20);
});
test('unknown rules and forged weights do not affect the score', () => {
  const s = bfAggregateScore([[{id:'invented',weight:100,detail:'fake'}, {id:'typosquat-domain',weight:999,detail:'typo'}]]);
  assert.equal(s.score,40);
});
