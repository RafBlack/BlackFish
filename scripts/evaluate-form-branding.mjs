import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FORM_BRANDING_CORPUS } from '../evaluation/form-branding-corpus.js';
import { FORM_BRANDING_ENABLED } from '../content/form-branding.js';
import { RULES_VERSION } from '../lib/cloud-contract.js';
import { formBrandingGate } from './form-branding-gate.js';

const baselineRaw = await readFile(new URL('../evaluation/corpus.json', import.meta.url));
const baseline = JSON.parse(baselineRaw);
const fixtures = [...baseline.fixtures.map(item => ({ ...item, suite:'baseline' })), ...FORM_BRANDING_CORPUS.fixtures.map(item => ({ ...item, suite:'targeted' }))];
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['content/form-branding.js','content/dom-scanner.js','content/form-guard.js','lib/heuristics/score.js','lib/heuristics/brand-list.js','scripts/evaluation-entry.js'];
const sourceFingerprint = async () => hash(Buffer.concat(await Promise.all(sourceNames.map(name=>readFile(new URL('../'+name,import.meta.url))))));
const sourceSha256 = await sourceFingerprint();
const bundle = await build({entryPoints:[fileURLToPath(new URL('./evaluation-entry.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'BlackFishEvaluation',target:'chrome116'});
const browser = await chromium.launch({channel:'chromium',headless:true});
const rows = [];
try {
  const context = await browser.newContext();
  const pages = new Map(fixtures.map(item => [item.url,item.html]));
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:pages.get(route.request().url()) || '<!doctype html><p>Local fixture resource</p>'}));
  const page = await context.newPage();
  for (const fixture of fixtures) {
    await page.goto(fixture.url);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const results = await page.evaluate(async first=>{
      const results={};
      for(const name of first ? ['baseline','candidate'] : ['candidate','baseline']) results[name]=await BlackFishEvaluation.analyze({formContext:name==='candidate'});
      return results;
    },rows.length % 2 === 0);
    rows.push({id:fixture.id,suite:fixture.suite,family:fixture.family,label:fixture.label,...results});
    if (rows.length % 50 === 0) console.log('Compared '+rows.length+'/'+fixtures.length+' local fixtures');
  }
  const gate = formBrandingGate(rows);
  if (sourceSha256 !== await sourceFingerprint()) throw new Error('Detection sources changed during evaluation; rerun the comparison.');
  const metrics = key => {
    const group = rows.filter(row=>row.label==='benign');
    const times = rows.map(row=>row[key].scanMs).sort((a,b)=>a-b);
    return {phishingWarnings:rows.filter(row=>row.label==='phishing' && row[key].score>=30).length,benignWarnings:group.filter(row=>row[key].score>=30).length,benignInterruptions:group.filter(row=>row[key].interrupted).length,scanMs:{median:times[Math.floor(times.length/2)],p95:times[Math.floor(times.length*.95)]}};
  };
  const report = {generatedAt:new Date().toISOString(),browser:browser.version(),synthetic:true,limitation:'Paired synthetic regressions, including deliberately ambiguous enterprise branding. Execution order alternates; timings are not production latency. Not independent real-world accuracy or evidence of AI benefit.',rulesVersion:RULES_VERSION,candidate:'form-context-v1',defaultEnabled:FORM_BRANDING_ENABLED,baselineCorpusSha256:hash(baselineRaw),targetedCorpusSha256:hash(JSON.stringify(FORM_BRANDING_CORPUS)),sourceSha256,counts:{baseline:baseline.fixtures.length,targeted:FORM_BRANDING_CORPUS.fixtures.length},metrics:{baseline:metrics('baseline'),candidate:metrics('candidate')},gate,results:rows};
  await writeFile(new URL('../evaluation/form-branding-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({counts:report.counts,metrics:report.metrics,gate,defaultEnabled:FORM_BRANDING_ENABLED},null,2));
  if (FORM_BRANDING_ENABLED && !gate.passed) process.exitCode = 1;
} finally { await browser.close(); }
