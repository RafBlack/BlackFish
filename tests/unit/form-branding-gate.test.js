import test from 'node:test';
import assert from 'node:assert/strict';
import { formBrandingGate } from '../../scripts/form-branding-gate.js';

const measured = (id,label,before,after,interrupted=false) => ({id,label,suite:'targeted',baseline:{score:before,interrupted:false},candidate:{score:after,interrupted}});
test('promotion requires new phishing detection with no introduced benign warning or interruption',()=>{
  const improvement = measured('new','phishing',15,45);
  assert.equal(formBrandingGate([improvement,measured('ordinary','benign',15,15)]).passed,true);
  const ambiguous = measured('enterprise','benign',15,45);
  assert.equal(formBrandingGate([improvement,ambiguous]).passed,false);
  assert.deepEqual(formBrandingGate([improvement,ambiguous]).additionalBenignWarnings,['enterprise']);
  assert.equal(formBrandingGate([improvement,measured('interrupted','benign',15,15,true)]).passed,false);
  assert.equal(formBrandingGate([measured('no-gain','phishing',45,45)]).passed,false);
  assert.equal(formBrandingGate([improvement,measured('lost','phishing',45,15)]).passed,false);
});
test('improvements elsewhere cannot offset a new benign warning and malformed measurements fail closed',()=>{
  const rows=[measured('new','phishing',15,45),measured('old','benign',45,15),measured('new-benign','benign',15,45)];
  assert.equal(formBrandingGate(rows).passed,false);
  assert.throws(()=>formBrandingGate([rows[0],rows[0]]));
  assert.throws(()=>formBrandingGate([{...rows[0],candidate:{score:NaN,interrupted:false}}]));
  const transport=measured('transport','transport',40,15);transport.baseline.interrupted=true;
  assert.equal(formBrandingGate([rows[0],transport]).passed,false);
});
