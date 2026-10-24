import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { database } from './database.js';
import { DAY, digest, MANAGED_MODEL, PROMPT_VERSION, RULES_VERSION } from '../../lib/cloud-contract.js';
import { threatReview, validateExample } from '../src/review.js';

let env, db, calls;
const token = 'a'.repeat(64), origin = 'https://blackfish-api.xelulabs.workers.dev';
const context = { hostname: 'login.example.com', signalIds: ['cross-origin-credential-form'], hasCredentials: true };
const versions = { origin, rules: RULES_VERSION, model: MANAGED_MODEL, prompt: PROMPT_VERSION, examples: '1' };
async function call(path, body, credential = token) {
  return worker.fetch(new Request(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ schema: 1, ...body }) } : {}) }), env);
}
beforeEach(async () => {
  db = database(); calls = 0;
  env = { DB: db, MANAGED_AI_ENABLED: 'true', EVALUATION_APPROVED: 'true', EVALUATION_EXAMPLES_VERSION: '1', EVALUATION_CORPUS_SHA: 'b'.repeat(64), AI: { async run(model, input) { calls++; assert.equal(model, MANAGED_MODEL); assert.equal(input.temperature, 0); assert.equal(input.max_tokens, 160); assert.equal(/pageText|passwordValue|https:\/\//.test(JSON.stringify(input)), false); await new Promise(resolve => setTimeout(resolve, 5)); return { response: JSON.stringify({ escalate: true, reason: 'Reviewed-pattern advice only.' }) }; } } };
  await db.prepare('INSERT INTO installations(id,token_hash,created_at) VALUES(?,?,?)').bind('one', await digest(token), Date.now()).run();
});
afterEach(() => db.sqlite.close());

test('authentication, consent and strict metadata prevent accidental uploads', async () => {
  assert.equal((await call('/v1/config', null, 'x'.repeat(64))).status, 401);
  assert.equal((await call('/v1/reputation/lookup', { hostname: 'localhost', urlHash: 'c'.repeat(64) })).status, 400);
  assert.equal((await call('/v1/reputation/lookup', { hostname: 'example.com', urlHash: 'c'.repeat(64), url: 'https://example.com/' })).status, 400);
  assert.equal((await call('/v1/reports', { requestId: 'test-report-id-0001', url: 'https://example.com/', context, confirmed: false, reuseConsent: true })).status, 400);
  assert.equal((await call('/v1/ai/triage', { context: { ...context, pageText: 'private' }, versions })).status, 400);
  assert.equal(calls, 0);
});
test('exact-link and hostname scopes never expand to siblings, paths or tenants', async () => {
  const now = Date.now(), urlHash = await digest('https://victim.example.com/login?a=1');
  await db.prepare("INSERT INTO threats(id,scope,hostname,url_hash,provenance,reviewer,reviewed_at,expires_at) VALUES('verified','url',?,?, 'Independent review','reviewer',?,?)").bind('victim.example.com', urlHash, now, now + DAY).run();
  assert.equal((await (await call('/v1/reputation/lookup', { hostname: 'victim.example.com', urlHash })).json()).status, 'confirmed');
  for (const [hostname, hash] of [['victim.example.com', await digest('https://victim.example.com/login?a=2')], ['sibling.example.com', urlHash]]) assert.equal((await (await call('/v1/reputation/lookup', { hostname, urlHash: hash })).json()).status, 'unknown');
  db.sqlite.exec("UPDATE threats SET revoked=1,revision=revision+1");
  assert.equal((await (await call('/v1/reputation/lookup', { hostname: 'victim.example.com', urlHash })).json()).status, 'unknown');
  await assert.rejects(threatReview({ url: 'https://github.io/', status: 'pending' }, { scope: 'hostname', reviewer: 'owner', provenance: 'Evidence' }));
});
test('reports are idempotent pending records and quota is enforced in SQL', async () => {
  const body = { requestId: 'test-report-id-0001', url: 'https://login.example.com/phishing?q=1#fragment', context, confirmed: true, reuseConsent: true };
  assert.equal((await call('/v1/reports', body)).status, 202);
  assert.equal((await call('/v1/reports', body)).status, 202);
  assert.equal((await db.prepare("SELECT count FROM usage WHERE kind='report'").first()).count, 1);
  assert.equal((await db.prepare('SELECT status FROM reports').first()).status, 'pending');
  for (let i = 2; i <= 5; i++) assert.equal((await call('/v1/reports', { ...body, requestId: 'test-report-id-000' + i })).status, 202);
  const limited = await call('/v1/reports', { ...body, requestId: 'test-report-id-0006' });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM reports').first()).count, 5);
});
test('simultaneous identical triage reserves exactly one inference and one quota slot', async () => {
  const responses = await Promise.all(Array.from({ length: 25 }, () => call('/v1/ai/triage', { context, versions })));
  assert.equal(calls, 1);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  const cached = await (await call('/v1/ai/triage', { context, versions })).json();
  assert.equal(cached.cached, true); assert.equal(calls, 1);
  assert.equal((await db.prepare("SELECT count FROM usage WHERE kind='globalAi'").first()).count, 1);
  assert.equal((await db.prepare("SELECT count FROM usage WHERE kind='ai'").first()).count, 1);
});
test('per-installation and global inference quotas cannot race past their caps', async () => {
  const single = await Promise.all(Array.from({ length: 15 }, (_,i) => call('/v1/ai/triage', { context: { ...context, hostname: 'host' + i + '.example.com' }, versions })));
  assert.equal(single.filter(response => response.status === 200).length, 10); assert.equal(calls, 10);
  db.sqlite.exec('DELETE FROM ai_jobs; DELETE FROM usage;'); calls = 0;
  const tokens = [token];
  for (let i = 1; i < 25; i++) { const credential = i.toString(16).padStart(64, '0'); tokens.push(credential); await db.prepare('INSERT INTO installations(id,token_hash,created_at) VALUES(?,?,?)').bind('user' + i, await digest(credential), Date.now()).run(); }
  const results = await Promise.all(tokens.flatMap((credential,i) => Array.from({ length: 5 }, (_,j) => call('/v1/ai/triage', { context: { ...context, hostname: 'user' + i + '-site' + j + '.example.com' }, versions }, credential))));
  assert.equal(calls, 100); assert.equal(results.filter(response => response.status === 429).length, 25);
  assert.equal((await db.prepare("SELECT count FROM usage WHERE kind='globalAi'").first()).count, 100);
  assert.equal((await db.prepare("SELECT SUM(count) AS count FROM usage WHERE kind='ai'").first()).count, 100);
  await assert.rejects(db.prepare('INSERT INTO installations(id,token_hash,created_at) VALUES(?,?,?)').bind('extra', 'd'.repeat(64), Date.now()).run(), /installation_limit/);
});
test('example changes invalidate approval and domain/template split leakage is rejected', async () => {
  const example = validateExample({ id: 'reviewed-one', label: 'benign', split: 'retrieval', features: context, explanation: 'Reviewed legitimate SSO.', reviewer: 'owner', evidence: 'Independent review', family: 'sso', domainGroup: 'example.com', independentlyReviewed: true, synthetic: false });
  const insert = (id, split) => db.prepare('INSERT INTO examples(id,label,features,explanation,reviewer,evidence,family,domain_group,split,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, example.label, JSON.stringify(example.features), example.explanation, example.reviewer, example.evidence, example.family, example.domainGroup, split, Date.now()).run();
  await insert('one', 'retrieval');
  assert.equal((await (await call('/v1/config')).json()).managedEnabled, false);
  assert.equal((await call('/v1/ai/triage', { context, versions })).status, 503);
  await assert.rejects(insert('two', 'evaluation'), /example_split_leakage/);
  assert.equal(calls, 0);
});
test('malformed provider output is never stored as approved advice or a threat', async () => {
  env.AI.run = async () => ({ response: '{"escalate":"false","reason":"wrong schema"}' });
  assert.equal((await call('/v1/ai/triage', { context, versions })).status, 503);
  assert.equal((await db.prepare('SELECT status FROM ai_jobs').first()).status, 'error');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM threats').first()).count, 0);
});
test('a timed-out provider keeps its charged reservation and never becomes a threat',async()=>{
  env.AI.run=()=>new Promise(()=>{});
  const response=await call('/v1/ai/triage',{context,versions});
  assert.equal(response.status,503);assert.equal((await response.json()).status,'timeout');
  assert.equal((await db.prepare("SELECT count FROM usage WHERE kind='globalAi'").first()).count,1);
  assert.equal((await db.prepare('SELECT status FROM ai_jobs').first()).status,'timeout');
});
test('scheduled retention deletes raw reports and expired jobs without deleting reviewed examples', async () => {
  await db.prepare("INSERT INTO reports(id,installation,request_id,url,url_hash,hostname,features,reuse_consent,created_at) VALUES('old','one','old-report-id','https://example.com/',?,'example.com',?,1,?)").bind('c'.repeat(64), JSON.stringify(context), Date.now() - 31 * DAY).run();
  await worker.scheduled({}, env);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM reports').first()).count, 0);
});
