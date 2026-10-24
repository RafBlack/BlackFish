import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentState } from '../../lib/document-state.js';
import { signal } from '../../lib/heuristics/score.js';
import { sanitizeSettings, SerialQueue, endpointInfo } from '../../lib/settings.js';
const top = { documentId: 'top', url: 'https://paypa1.com' };
const frame = { frameId:0, documentId:'top', url:'https://paypa1.com' };
const suspicious = [signal('homograph-domain','confusable'),signal('credential-presence','password')];
test('clean frames cannot overwrite main evidence; repeat rules across frames do not stack', () => {
  const state = new DocumentState();
  state.accept(1,top,frame,{revision:1,state:'complete',signals:suspicious});
  state.accept(1,top,{frameId:2,documentId:'child',parentFrameId:0,url:'https://example.org'},{revision:1,state:'complete',signals:[]});
  assert.equal(state.result(1).scored.score,60);
  state.accept(1,top,{frameId:3,documentId:'child-2',parentFrameId:0,url:'https://example.org'},{revision:1,state:'complete',signals:suspicious});
  assert.equal(state.result(1).scored.score,60);
});
test('stale revisions are rejected; documents reset; snapshots recover across restart', () => {
  let state = new DocumentState();
  assert.equal(state.accept(1,top,frame,{revision:2,state:'complete',signals:suspicious}),true);
  assert.equal(state.accept(1,top,frame,{revision:1,state:'complete',signals:[]}),false);
  state = new DocumentState(JSON.parse(JSON.stringify(state.serialize())));
  assert.equal(state.result(1).scored.score,60);
  state.ensure(1,{documentId:'new',url:'https://example.org'});
  assert.equal(state.result(1).scored.score,0);
  assert.equal(state.result(1).state,'scanning');
});
test('replacing a frame invalidates its descendants; trusting the main origin pauses all frames', () => {
  const state = new DocumentState(); state.accept(1,top,frame,{revision:1,state:'complete',signals:[]});
  state.accept(1,top,{frameId:1,parentFrameId:0,documentId:'c1',url:'https://a.test'},{revision:1,state:'complete',signals:suspicious});
  state.accept(1,top,{frameId:2,parentFrameId:1,documentId:'c2',url:'https://b.test'},{revision:1,state:'complete',signals:[]});
  assert.equal(state.result(1,['https://paypa1.com']).state,'trusted');
  assert.equal(state.result(1,['https://paypa1.com']).scored.score,0);
  state.removeFrame(1,1,'replacement');
  assert.equal(state.result(1).frameCount,1);
});
test('settings migration rejects invalid entries, disables legacy AI and permits keyless local AI', () => {
  const s = sanitizeSettings({bf_allowlist:['https://example.org','javascript:alert(1)'],bf_custom_brands:['[abc.com','example.com'],bf_ai_enabled:true,bf_ai_endpoint:'https://api.x.ai/v1/chat/completions',bf_ai_key:'fixture',bf_ai_model:'fixture'}, {migrate:true});
  assert.deepEqual(s.bf_allowlist,['https://example.org']); assert.deepEqual(s.bf_custom_brands,['example.com']);
  assert.equal(s.bf_ai_enabled,false); assert.ok(s.bf_rejected_settings.length >= 3);
  assert.equal(sanitizeSettings({bf_ai_enabled:true,bf_ai_endpoint:'http://localhost:11434/v1/chat/completions',bf_ai_model:'fixture'}).bf_ai_enabled,true);
  assert.equal(endpointInfo('https://api.x.ai.evil.test/x'),null);
  assert.equal(endpointInfo('https://evil.test/x'),null);
});
test('serialized read-modify-write retains concurrent trust edits after errors', async () => {
  const q = new SerialQueue(); let values=[];
  await Promise.all(Array.from({length:30},(_,i)=>q.run(async()=>{const old=[...values];await Promise.resolve();values=[...old,i];})));
  assert.equal(values.length,30);
  await assert.rejects(q.run(()=>Promise.reject(new Error('fixture'))));
  assert.equal(await q.run(()=>42),42);
});
