import { adviceKey, boundedJson, canonicalUrl, CLOUD_SCHEMA, DAY, digest, MANAGED_MODEL, normalizeFeatures, PROMPT_VERSION, publicHostname, RULES_VERSION, validateAdvice } from '../../lib/cloud-contract.js';
import { chooseExamples, modelInput } from './model.js';

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const day = now => new Date(now).toISOString().slice(0,10);
function nextReset(now) { return Math.ceil((DAY - now % DAY) / 1000); }
async function versions(env, origin) {
  const row = await env.DB.prepare("SELECT value FROM service_meta WHERE key='examples_version'").first();
  return { origin, rules: RULES_VERSION, model: MANAGED_MODEL, prompt: PROMPT_VERSION, examples: row.value };
}
function enabled(env, version) { return env.MANAGED_AI_ENABLED === 'true' && env.EVALUATION_APPROVED === 'true' && env.EVALUATION_EXAMPLES_VERSION === version && /^[a-f0-9]{64}$/.test(env.EVALUATION_CORPUS_SHA || ''); }
function fields(value, allowed) { if (!value || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('invalid_request'); }
async function lookup(body, env, installation, now) {
  fields(body, ['schema','hostname','urlHash']);
  if (!publicHostname(body.hostname) || !/^[a-f0-9]{64}$/.test(body.urlHash || '')) throw new Error('invalid_request');
  await env.DB.prepare("INSERT INTO usage(installation,day,kind,count) VALUES(?,?,'lookup',1) ON CONFLICT(installation,day,kind) DO UPDATE SET count=count+1").bind(installation, day(now)).run();
  const row = await env.DB.prepare("SELECT * FROM threats WHERE hostname=? AND revoked=0 AND expires_at>? AND reviewed_at<=? AND ((scope='url' AND url_hash=?) OR scope='hostname') ORDER BY CASE scope WHEN 'url' THEN 0 ELSE 1 END,reviewed_at DESC,id LIMIT 1").bind(body.hostname, now, now, body.urlHash).first();
  if (!row) return json({ status: 'unknown' });
  return json({ status: 'confirmed', id: row.id, scope: row.scope, hostname: row.hostname, ...(row.scope === 'url' ? { urlHash: row.url_hash } : {}), provenance: row.provenance, reviewedAt: row.reviewed_at, expiresAt: row.expires_at, revision: row.revision });
}
async function report(body, env, installation, now) {
  fields(body, ['schema','requestId','url','context','confirmed','reuseConsent']);
  const target = canonicalUrl(body.url), context = normalizeFeatures(body.context);
  if (!target || context.hostname !== target.hostname || body.confirmed !== true || body.reuseConsent !== true || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '')) throw new Error('invalid_request');
  const id = await digest(installation + ':' + body.requestId);
  const urlHash = await digest(target.url);
  await env.DB.prepare("INSERT INTO reports(id,installation,request_id,url,url_hash,hostname,features,reuse_consent,created_at) SELECT ?,?,?,?,?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM reports WHERE installation=? AND request_id=?)").bind(id, installation, body.requestId, target.url, urlHash, target.hostname, JSON.stringify(context), now, installation, body.requestId).run();
  return json({ status: 'pending', reportId: id }, 202);
}
async function triage(body, env, installation, now, origin) {
  fields(body, ['schema','context','versions']);
  const context = normalizeFeatures(body.context), expected = await versions(env, origin);
  if (!enabled(env, expected.examples)) return json({ status: 'evaluation-required' }, 503);
  if (!body.versions || Object.keys(expected).some(key => expected[key] !== body.versions[key])) return json({ status: 'version-changed' }, 409);
  const key = await adviceKey(context, expected);
  const reservation = await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_jobs WHERE key=? AND expires_at<=?').bind(key, now),
    env.DB.prepare("INSERT INTO ai_jobs(key,installation,day,status,created_at,expires_at) SELECT ?,?,?,'pending',?,? WHERE NOT EXISTS(SELECT 1 FROM ai_jobs WHERE key=?)").bind(key, installation, day(now), now, now + 60000, key),
    env.DB.prepare('SELECT status,result FROM ai_jobs WHERE key=?').bind(key)
  ]);
  if (!reservation[1].meta.changes) {
    const job = reservation[2].results[0];
    return job?.status === 'complete' ? json({ ...JSON.parse(job.result), versions: expected, cached: true }) : json({ status: job?.status || 'pending' }, 202, { 'Retry-After': '60' });
  }
  const pools = await Promise.all(['benign','phishing'].map(label => env.DB.prepare("SELECT id,label,features,explanation FROM examples WHERE active=1 AND split='retrieval' AND label=? ORDER BY id LIMIT 100").bind(label).all()));
  const examples = chooseExamples(pools.flatMap(pool => pool.results), context);
  let timer;
  try {
    const output = await Promise.race([
      env.AI.run(MANAGED_MODEL, modelInput(context, examples)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2800); })
    ]);
    if (typeof output?.response !== 'string' || output.response.length > 2000 || output.tool_calls?.length) throw new Error('invalid_advice');
    const result = validateAdvice(JSON.parse(output.response));
    await env.DB.prepare("UPDATE ai_jobs SET status='complete',result=?,expires_at=? WHERE key=? AND status='pending' AND created_at=?").bind(JSON.stringify(result), now + DAY, key, now).run();
    return json({ ...result, versions: expected, cached: false });
  } catch (error) {
    const status = error.message === 'timeout' ? 'timeout' : 'error';
    await env.DB.prepare('UPDATE ai_jobs SET status=?,expires_at=? WHERE key=? AND created_at=?').bind(status, now + 60000, key, now).run();
    return json({ status }, 503, { 'Retry-After': '60' });
  } finally { clearTimeout(timer); }
}
export default {
  async fetch(request, env) {
    const now = Date.now(), url = new URL(request.url);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) return json({ status: 'unauthorized' }, 401);
      const installation = await env.DB.prepare('SELECT id FROM installations WHERE token_hash=? AND active=1').bind(await digest(token)).first();
      if (!installation) return json({ status: 'unauthorized' }, 401);
      if (request.method === 'GET' && url.pathname === '/v1/config') {
        const current = await versions(env, url.origin);
        return json({ schema: CLOUD_SCHEMA, rulesVersion: current.rules, model: current.model, promptVersion: current.prompt, examplesVersion: current.examples, managedEnabled: enabled(env, current.examples) });
      }
      if (request.method !== 'POST') return json({ status: 'not-found' }, 404);
      if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json({ status: 'invalid-request' }, 400);
      const body = await boundedJson(request, 8192);
      if (body.schema !== CLOUD_SCHEMA) return json({ status: 'version-changed' }, 409);
      if (url.pathname === '/v1/reputation/lookup') return await lookup(body, env, installation.id, now);
      if (url.pathname === '/v1/reports') return await report(body, env, installation.id, now);
      if (url.pathname === '/v1/ai/triage') return await triage(body, env, installation.id, now, url.origin);
      return json({ status: 'not-found' }, 404);
    } catch (error) {
      if (/daily_quota/.test(error.message)) return json({ status: 'limited' }, 429, { 'Retry-After': String(nextReset(now)) });
      if (/invalid|Unexpected|JSON|large|Empty/.test(error.message)) return json({ status: 'invalid-request' }, 400);
      return json({ status: 'unavailable' }, 503, { 'Retry-After': '60' });
    }
  },
  async scheduled(event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reports WHERE created_at<?').bind(now - 30 * DAY),
      env.DB.prepare('DELETE FROM ai_jobs WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM usage WHERE day<?').bind(day(now - 2 * DAY)),
      env.DB.prepare('DELETE FROM threats WHERE expires_at<?').bind(now - DAY)
    ]);
  }
};
