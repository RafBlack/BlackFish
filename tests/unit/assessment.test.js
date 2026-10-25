import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidence, credentialPolicy } from '../../lib/assessment.js';
import { bfAggregateScore, signal } from '../../lib/heuristics/score.js';

const assess = (ids, extra = {}) => assessEvidence({ scored: bfAggregateScore([ids.map(id => signal(id, id))]), ...extra });
test('destination notices and weak support never imply phishing or submission authority', () => {
  const ids = ['cross-origin-credential-form','credential-presence'];
  const before = assess(ids), after = assess([...ids,'lure-keywords','deep-subdomain']);
  assert.equal(before.kind,'destination');assert.equal(before.alert,false);
  assert.deepEqual(before,after);assert.deepEqual(credentialPolicy(ids.map(id => ({ id }))),{insecure:false,impersonation:false});
});
test('credential decisions follow explicit evidence without a numeric cutoff', () => {
  assert.equal(assess(['brand-in-subdomain','credential-presence']).kind,'impersonation');
  assert.equal(assess(['brand-in-subdomain']).kind,'identity');
  assert.equal(assess(['brand-name-domain-mismatch','credential-presence']).kind,'identity');
  assert.equal(credentialPolicy([{id:'brand-name-domain-mismatch'},{id:'credential-presence'}]).impersonation,false);
  assert.equal(assess(['insecure-credential-form','credential-presence']).kind,'transport');
});
test('confirmed fresh reputation takes priority over a zero index and incomplete scans', () => {
  const now = Date.now(), reputation = {status:'confirmed',expiresAt:now+60000,freshUntil:now+30000};
  assert.equal(assess([],{reputation}).kind,'confirmed');
  assert.equal(assess([],{reputation,state:'failed'}).kind,'confirmed');
  assert.equal(assess([],{reputation,state:'trusted'}).kind,'trusted');
  assert.equal(assess([],{reputation:{...reputation,freshUntil:now-1}}).kind,'none');
  assert.equal(assess([],{reputation:{...reputation,expiresAt:now-1}}).kind,'none');
});
test('incomplete scans cannot present a completed clean finding', () => {
  for (const state of ['scanning','failed','unsupported']) {
    const assessment=assess([],{state});
    assert.equal(assessment.kind,state);assert.equal(assessment.alert,false);
    assert.notEqual(assessment.title,'No strong phishing indicators detected');
  }
});
