import test from 'node:test';
import assert from 'node:assert/strict';
import { COVERAGE_NOTICE, coverageLabel } from '../../ui/coverage.js';

test('coverage labels distinguish partial, unavailable, failed and paused protection',()=>{
  assert.match(COVERAGE_NOTICE,/TLS certificates, non-credential mixed content, and malware are not assessed/);
  for (const [state,word] of [['failed','failed'],['unsupported','unavailable'],['trusted','paused'],['scanning','Scanning']]) assert.ok(coverageLabel({state}).includes(word));
  assert.match(coverageLabel({state:'complete',truncated:true}),/^Partial/);
  assert.match(coverageLabel({state:'complete'}),/complete$/);
  assert.match(coverageLabel(),/^Waiting/);
});
