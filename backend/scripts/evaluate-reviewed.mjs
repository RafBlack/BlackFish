import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bfAggregateScore, bfIsBorderline, signal } from '../../lib/heuristics/score.js';
import { MANAGED_MODEL, PROMPT_VERSION, RULES_VERSION, validateAdvice } from '../../lib/cloud-contract.js';
import { validateExample } from '../src/review.js';

export async function evaluateReviewed(corpusPath, responsesPath) {
  const raw = await readFile(corpusPath, 'utf8'), corpus = JSON.parse(raw);
  const corpusSha = createHash('sha256').update(raw).digest('hex');
  const responses = responsesPath ? JSON.parse(await readFile(responsesPath, 'utf8')) : {};
  const failures = [], examples = (corpus.examples || []).map(validateExample);
  const groups = new Map(), ids = new Set();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error('Duplicate example ID.'); ids.add(example.id);
    for (const key of ['domain:' + example.domainGroup, 'family:' + example.family]) {
      if (groups.has(key) && groups.get(key) !== example.split) throw new Error('Domain/template split leakage.');
      groups.set(key, example.split);
    }
  }
  const count = (label, split) => examples.filter(item => item.label === label && (!split || item.split === split)).length;
  if (count('benign') < 200 || count('phishing') < 100) failures.push('Need 200 benign and 100 phishing independently reviewed examples.');
  if (count('benign','evaluation') < 100 || count('phishing','evaluation') < 50) failures.push('Reserve at least 100 benign and 50 phishing examples for held-out evaluation.');
  if (typeof corpus.examplesVersion !== 'string' || !corpus.examplesVersion.length) failures.push('Missing service example-set version.');
  if (responses.corpusSha !== corpusSha || responses.model !== MANAGED_MODEL || responses.promptVersion !== PROMPT_VERSION || responses.rulesVersion !== RULES_VERSION || responses.examplesVersion !== corpus.examplesVersion) failures.push('Missing or mismatched frozen model responses.');
  const predictions = new Map((responses.results || []).map(item => [item.id, item]));
  if (predictions.size !== (responses.results || []).length) throw new Error('Duplicate response IDs.');
  let phishingFound = 0, falseWarnings = 0, additionalPhishing = 0, falseAdvice = 0, missing = 0;
  const latencies = [];
  for (const example of examples.filter(item => item.split === 'evaluation')) {
    const scored = bfAggregateScore([example.features.signalIds.map(id => signal(id, id))]);
    const warned = scored.score >= 30;
    if (warned) example.label === 'phishing' ? phishingFound++ : falseWarnings++;
    if (!bfIsBorderline(scored.score)) continue;
    const prediction = predictions.get(example.id);
    if (!prediction || prediction.status !== 'complete') { missing++; continue; }
    const advice = validateAdvice(prediction);
    if (!Number.isFinite(prediction.latencyMs) || prediction.latencyMs < 0) throw new Error('Missing inference timing.');
    latencies.push(prediction.latencyMs);
    if (advice.escalate && example.label === 'benign') falseAdvice++;
    if (advice.escalate && !warned && example.label === 'phishing') additionalPhishing++;
  }
  if (missing) failures.push('Missing successful advice for ' + missing + ' eligible held-out examples.');
  if (!additionalPhishing) failures.push('No additional held-out phishing detected.');
  if (falseAdvice) failures.push('Managed AI added benign concern flags.');
  latencies.sort((a,b) => a-b);
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] ?? null;
  if (p95 === null || p95 > 3000) failures.push('Managed AI latency must fit the three-second deadline.');
  const metric = (found, warnings) => ({ phishingFound: found, benignWarnings: warnings, precision: found / (found + warnings || 1), recall: found / (count('phishing','evaluation') || 1), falseWarningRate: warnings / (count('benign','evaluation') || 1) });
  return { schema: 1, approved: !failures.length, failures, corpusSha, examplesVersion: corpus.examplesVersion, model: MANAGED_MODEL, rulesVersion: RULES_VERSION, promptVersion: PROMPT_VERSION, examples: { benign: count('benign'), phishing: count('phishing') }, evaluationKind: 'unseen domains and templates; no exact-memory matches are credited', rulesOnly: metric(phishingFound, falseWarnings), rulesAndMemory: metric(phishingFound, falseWarnings), rulesMemoryAndAdvice: metric(phishingFound + additionalPhishing, falseWarnings + falseAdvice), additionalPhishing, falseAdvice, missing, aiLatencyP95Ms: p95, interruptionsAddedByCloud: 0 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await evaluateReviewed(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
