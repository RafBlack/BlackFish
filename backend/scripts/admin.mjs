import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY, digest } from '../../lib/cloud-contract.js';
import { threatReview, validateExample, exampleFromRow } from '../src/review.js';
import { evaluateReviewed } from './evaluate-reviewed.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), command = args.shift();
const localIndex = args.indexOf('--local');
const localPath = localIndex >= 0 ? args.splice(localIndex, 2)[1] : null;
let database;
async function query(sql, params = []) {
  if (localPath) {
    database ||= new DatabaseSync(path.resolve(localPath));
    const statement = database.prepare(sql);
    return statement.columns().length ? statement.all(...params) : (statement.run(...params), []);
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, id = process.env.CLOUDFLARE_D1_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !id || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_ID and CLOUDFLARE_API_TOKEN privately, or use --local PATH for an offline review database.');
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account) + '/d1/database/' + encodeURIComponent(id) + '/query', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }), redirect: 'error', signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok || !data.success || data.result?.some(result => result.success === false)) throw new Error('D1 operation failed; inspect the private Cloudflare dashboard.');
  return data.result[0]?.results || [];
}
async function main() {
  const now = Date.now();
  if (command === 'init-local') {
    if (!localPath) throw new Error('init-local requires --local PATH.');
    await mkdir(path.dirname(path.resolve(localPath)), { recursive: true });
    database = new DatabaseSync(path.resolve(localPath));
    database.exec(await readFile(path.join(directory, 'migrations/0001_beta.sql'), 'utf8'));
    return { initialized: true };
  }
  if (command === 'invite') {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    await query('INSERT INTO installations(id,token_hash,created_at) VALUES(?,?,?)', [id, await digest(token), now]);
    return { installationId: id, invitationToken: token, notice: 'Copy privately. This is the only intentional credential output; never paste it into source, reports or application logs.' };
  }
  if (command === 'revoke-installation') { await query('UPDATE installations SET active=0 WHERE id=?', [args[0]]); return { revoked: args[0] }; }
  if (command === 'pending') return query("SELECT id,url,features,created_at FROM reports WHERE status='pending' AND created_at>? ORDER BY created_at LIMIT 100", [now - 30 * DAY]);
  if (command === 'confirm') {
    const [id, scope, reviewer, provenance] = args;
    const report = (await query('SELECT * FROM reports WHERE id=? AND created_at>?', [id, now - 30 * DAY]))[0];
    const reviewed = await threatReview(report, { scope, reviewer, provenance });
    const threatId = randomUUID();
    await query('INSERT INTO threats(id,report_id,scope,hostname,url_hash,provenance,reviewer,reviewed_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)', [threatId, id, reviewed.scope, reviewed.hostname, reviewed.urlHash, reviewed.provenance, reviewed.reviewer, now, now + DAY]);
    return { threatId, scope, expiresAt: now + DAY };
  }
  if (command === 'reject') { const updated = await query("UPDATE reports SET status='rejected' WHERE id=? AND status='pending' RETURNING id", [args[0]]); if (!updated.length) throw new Error('Pending report not found. Revoke a confirmed threat explicitly.'); return { rejected: args[0] }; }
  if (command === 'revoke-threat') { const updated = await query('UPDATE threats SET revoked=1,revision=revision+1 WHERE id=? RETURNING id', [args[0]]); if (!updated.length) throw new Error('Threat not found.'); return { revoked: args[0] }; }
  if (command === 'renew-threat') {
    const [id, reviewer, provenance] = args;
    if (!reviewer?.trim() || reviewer.length > 100 || !provenance?.trim() || provenance.length > 300) throw new Error('Renewal requires a reviewer and current independent evidence.');
    await query('UPDATE threats SET revoked=0,reviewed_at=?,expires_at=?,revision=revision+1,reviewer=?,provenance=? WHERE id=?', [now, now + DAY, reviewer, provenance, id]);
    return { renewed: id, expiresAt: now + DAY };
  }
  if (command === 'add-example') {
    const item = validateExample(JSON.parse(await readFile(args[0], 'utf8')));
    await query('INSERT INTO examples(id,label,features,explanation,reviewer,evidence,family,domain_group,split,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [item.id, item.label, JSON.stringify(item.features), item.explanation, item.reviewer, item.evidence, item.family, item.domainGroup, item.split, now]);
    return { added: item.id, notice: 'Example changes advance the retrieval version and invalidate previous AI approval.' };
  }
  if (command === 'revoke-example') { await query('UPDATE examples SET active=0 WHERE id=?', [args[0]]); return { revoked: args[0] }; }
  if (command === 'export-examples') {
    const rows = await query('SELECT * FROM examples WHERE active=1 ORDER BY id');
    const output = rows.map(exampleFromRow);
    const examplesVersion = (await query("SELECT value FROM service_meta WHERE key='examples_version'"))[0].value;
    await writeFile(args[0], JSON.stringify({ examplesVersion, examples: output }, null, 2) + '\n');
    return { exported: rows.length };
  }
  if (command === 'metrics') return { usage: await query('SELECT day,kind,SUM(count) AS count FROM usage GROUP BY day,kind ORDER BY day DESC'), backlog: await query("SELECT status,COUNT(*) AS count FROM reports GROUP BY status"), aiCache: await query('SELECT status,COUNT(*) AS count FROM ai_jobs GROUP BY status') };
  if (command === 'approve-ai') {
    const report = await evaluateReviewed(args[0], args[1]);
    if (!report.approved) throw new Error('Evaluation gate did not pass: ' + report.failures.join('; '));
    const version = (await query("SELECT value FROM service_meta WHERE key='examples_version'"))[0]?.value;
    if (report.examplesVersion !== version) throw new Error('Reviewed-example version does not match the service.');
    const corpus = JSON.parse(await readFile(args[0], 'utf8'));
    const live = (await query('SELECT * FROM examples WHERE active=1 ORDER BY id')).map(exampleFromRow);
    const expected = corpus.examples.map(validateExample).sort((a,b) => a.id.localeCompare(b.id));
    if (JSON.stringify(live.sort((a,b) => a.id.localeCompare(b.id))) !== JSON.stringify(expected)) throw new Error('Corpus does not match the active reviewed database snapshot.');
    const configPath = path.join(directory, 'wrangler.local.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.vars = { ...config.vars, EVALUATION_APPROVED: 'true', EVALUATION_CORPUS_SHA: report.corpusSha, EVALUATION_EXAMPLES_VERSION: version, MANAGED_AI_ENABLED: 'true' };
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    return { approved: true, notice: 'Local deployment configuration updated. No deployment was performed.' };
  }
  throw new Error('Commands: init-local --local PATH; invite; revoke-installation ID; pending; confirm REPORT_ID url|hostname REVIEWER EVIDENCE; reject REPORT_ID; revoke-threat ID; renew-threat ID REVIEWER EVIDENCE; add-example FILE; revoke-example ID; export-examples FILE; metrics; approve-ai CORPUS RESPONSES. Remote commands use private environment credentials.');
}
try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { database?.close(); }
