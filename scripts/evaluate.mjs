import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { domainInfo } from '../lib/heuristics/domain.js';
import { RULES_VERSION } from '../lib/cloud-contract.js';
const raw=await readFile(new URL('../evaluation/corpus.json',import.meta.url),'utf8');
const corpus=JSON.parse(raw);
const families=new Map(),domains=new Map();
for(const f of corpus.fixtures){
  for(const [map,key] of [[families,f.family],[domains,domainInfo(new URL(f.url).hostname).domain]]){
    if(map.has(key)&&map.get(key)!==f.split)throw new Error('Tuning/evaluation leakage: '+key);
    map.set(key,f.split);
  }
}
const bundle=await build({entryPoints:[fileURLToPath(new URL('./evaluation-entry.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'BlackFishEvaluation',target:'chrome116'});
let aiResults=null;
const arg=process.argv.indexOf('--ai-results');
if(arg!==-1){
  aiResults=JSON.parse(await readFile(process.argv[arg+1],'utf8'));
  const known=new Set(corpus.fixtures.map(f=>f.id));
  for(const [id,r]of Object.entries(aiResults)){
    if(!known.has(id)||typeof r.escalate!=='boolean'||typeof r.reason!=='string'||r.reason.length>300)throw new Error('Invalid offline AI advice: '+id);
  }
}
const browser=await chromium.launch({channel:'chromium',headless:true});
const context=await browser.newContext();
const pages=new Map(corpus.fixtures.map(f=>[f.url,f.html]));
await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:pages.get(route.request().url())||'<!doctype html><p>Local fixture resource</p>'}));
const page=await context.newPage();
const results=[];
try{
  for(const fixture of corpus.fixtures){
    await page.goto(fixture.url);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(()=>BlackFishEvaluation.analyze());
    results.push({id:fixture.id,family:fixture.family,label:fixture.label,split:fixture.split,...result});
    if(results.length%50===0)console.log('Evaluated '+results.length+'/'+corpus.fixtures.length+' local fixtures');
  }
}finally{await browser.close();}
function metrics(rows,useAi=false){
  let tp=0,fp=0,tn=0,fn=0,benignInterrupted=0,phishingInterrupted=0;
  const times=rows.map(r=>r.scanMs).sort((a,b)=>a-b);
  for(const r of rows){
    const positive=r.warned || useAi&&aiResults?.[r.id]?.escalate===true;
    if(r.label==='phishing'){if(positive)tp++;else fn++;if(r.interrupted)phishingInterrupted++;}
    else{if(positive)fp++;else tn++;if(r.interrupted)benignInterrupted++;}
  }
  return {count:rows.length,truePositives:tp,falsePositives:fp,trueNegatives:tn,falseNegatives:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,falseWarningRate:fp+tn?fp/(fp+tn):null,passiveDestinationNotices:rows.filter(r=>r.assessmentKind==='destination').length,benignInterruptions:benignInterrupted,benignInterruptionRate:fp+tn?benignInterrupted/(fp+tn):null,phishingInterruptionRate:tp+fn?phishingInterrupted/(tp+fn):null,scanMs:{median:times[Math.floor(times.length/2)]||0,p95:times[Math.floor(times.length*.95)]||0,max:times.at(-1)||0}};
}
const report={
  generatedAt:new Date().toISOString(),browser:browser.version(),synthetic:corpus.synthetic,rulesVersion:RULES_VERSION,warningDefinition:'Evidence-policy banner/badge alert; excludes passive destination/link notices. Historical versions used index >=30. Scores retained for technical comparison, not risk calibration.',
  limitation:'Scenario regression baseline only. Parameter variants are correlated. These measurements do not establish real-world detection accuracy or beta readiness.',
  corpusSha256:createHash('sha256').update(raw).digest('hex'),
  rules:{all:metrics(results),tuning:metrics(results.filter(r=>r.split==='tuning')),evaluation:metrics(results.filter(r=>r.split==='evaluation'))},
  ai:aiResults?{mode:'Offline advice comparison only; no network calls or protection changes',providedExamples:Object.keys(aiResults).length,rulesPlusAdvice:metrics(results.filter(r=>r.split==='evaluation'),true)}:{status:'Not evaluated. AI remains experimental and advisory-only.'},
  failures:results.filter(r=>r.warned!==(r.label==='phishing')),
  results
};
await writeFile(new URL('../evaluation/latest-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rules:report.rules,ai:report.ai},null,2));
if(report.rules.all.benignInterruptions)process.exitCode=1;
