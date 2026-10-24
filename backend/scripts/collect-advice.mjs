import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bfAggregateScore, bfIsBorderline, signal } from '../../lib/heuristics/score.js';
import { boundedJson, MANAGED_MODEL, PROMPT_VERSION, RULES_VERSION, validateAdvice } from '../../lib/cloud-contract.js';
import { chooseExamples, modelInput } from '../src/model.js';
import { evaluateReviewed } from './evaluate-reviewed.mjs';

const [corpusPath, outputPath] = process.argv.slice(2);
try {
  if (!corpusPath || !outputPath) throw new Error('Usage: node scripts/collect-advice.mjs CORPUS OUTPUT. Uses private Cloudflare credentials and free model quota; at most 25 calls per invocation and 100 recorded calls per UTC day.');
  const gate = await evaluateReviewed(corpusPath);
  if (gate.examples.benign < 200 || gate.examples.phishing < 100) throw new Error('Collect the independent reviewed corpus before spending model quota.');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Set private Cloudflare account/API credentials outside source control.');
  const raw = await readFile(corpusPath, 'utf8'), corpus = JSON.parse(raw), corpusSha = createHash('sha256').update(raw).digest('hex');
  let output;
  try { output = JSON.parse(await readFile(outputPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  output ||= { corpusSha, examplesVersion: corpus.examplesVersion, model: MANAGED_MODEL, rulesVersion: RULES_VERSION, promptVersion: PROMPT_VERSION, results: [], callsByDay: {} };
  if (output.corpusSha !== corpusSha || output.examplesVersion !== corpus.examplesVersion || output.model !== MANAGED_MODEL || output.promptVersion !== PROMPT_VERSION) throw new Error('Output belongs to another frozen corpus or model configuration.');
  const today = new Date().toISOString().slice(0,10), completed = new Set(output.results.filter(row => row.status === 'complete').map(row => row.id));
  let calls = 0;
  for (const example of corpus.examples.filter(row => row.split === 'evaluation')) {
    const score = bfAggregateScore([example.features.signalIds.map(id => signal(id,id))]).score;
    if (!bfIsBorderline(score) || completed.has(example.id)) continue;
    if (calls >= 25 || (output.callsByDay[today] || 0) >= 100) break;
    output.callsByDay[today] = (output.callsByDay[today] || 0) + 1; calls++;
    await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
    const started = performance.now();
    let result;
    try {
      const pool = ['benign','phishing'].flatMap(label => corpus.examples.filter(row => row.split === 'retrieval' && row.label === label).sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0,100));
      const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account) + '/ai/run/' + MANAGED_MODEL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(modelInput(example.features, chooseExamples(pool, example.features))), signal: AbortSignal.timeout(3000), redirect: 'error' });
      const data = await boundedJson(response);
      if (!response.ok || !data.success || typeof data.result?.response !== 'string' || data.result.response.length > 2000) throw new Error('Provider response failed.');
      result = { id: example.id, ...validateAdvice(JSON.parse(data.result.response)), latencyMs: performance.now() - started };
    } catch { result = { id: example.id, status: 'error', latencyMs: performance.now() - started }; }
    output.results = output.results.filter(row => row.id !== example.id); output.results.push(result);
    await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
  }
  console.log(JSON.stringify({ collected: calls, completed: output.results.filter(row=>row.status==='complete').length, callsToday: output.callsByDay[today] || 0, notice: 'No labels were generated or changed. Provider quota is shared with any other account usage.' }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
