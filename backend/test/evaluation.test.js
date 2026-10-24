import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateReviewed } from '../scripts/evaluate-reviewed.mjs';
import { MANAGED_MODEL, PROMPT_VERSION, RULES_VERSION } from '../../lib/cloud-contract.js';

test('empty independent corpus keeps managed AI closed',async()=>{
  const result=await evaluateReviewed(new URL('../evaluation/reviewed-corpus.json',import.meta.url));
  assert.equal(result.approved,false);assert.equal(result.examples.benign,0);assert.equal(result.examples.phishing,0);
});
test('evaluation gate checks frozen inputs, added detections, false advice and latency',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'blackfish-gate-fixture-')),corpusPath=path.join(folder,'corpus.json'),responsePath=path.join(folder,'responses.json');
  const examples=[];
  for(const [label,count]of [['benign',200],['phishing',100]])for(let i=0;i<count;i++){
    const domain=label+'-'+i+'.com',split=i<count/4?'retrieval':i<count/2?'tuning':'evaluation';
    examples.push({id:label+'-'+i,label,split,features:{hostname:domain,signalIds:label==='phishing'?['insecure-credential-form']:['cross-origin-credential-form'],hasCredentials:true},explanation:'Synthetic gate-test fixture only.',reviewer:'fixture operator',evidence:'Synthetic unit-test assertions, not production review.',family:domain,domainGroup:domain,independentlyReviewed:true,synthetic:false});
  }
  const raw=JSON.stringify({examplesVersion:'301',examples});await writeFile(corpusPath,raw);
  const responses={corpusSha:createHash('sha256').update(raw).digest('hex'),examplesVersion:'301',model:MANAGED_MODEL,promptVersion:PROMPT_VERSION,rulesVersion:RULES_VERSION,results:examples.filter(item=>item.split==='evaluation').map(item=>({id:item.id,status:'complete',escalate:item.label==='phishing',reason:'Synthetic predicted advice.',latencyMs:100}))};
  await writeFile(responsePath,JSON.stringify(responses));assert.equal((await evaluateReviewed(corpusPath,responsePath)).approved,true);
  const benign=responses.results.find(row=>row.id.startsWith('benign'));benign.escalate=true;
  await writeFile(responsePath,JSON.stringify(responses));assert.equal((await evaluateReviewed(corpusPath,responsePath)).approved,false);
  benign.escalate=false;responses.corpusSha='0'.repeat(64);
  await writeFile(responsePath,JSON.stringify(responses));assert.equal((await evaluateReviewed(corpusPath,responsePath)).approved,false);
  responses.corpusSha=createHash('sha256').update(raw).digest('hex');for(const row of responses.results)row.latencyMs=3100;
  await writeFile(responsePath,JSON.stringify(responses));assert.equal((await evaluateReviewed(corpusPath,responsePath)).approved,false);
});
test('a template crossing tuning/evaluation is rejected before any approval',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'blackfish-leak-fixture-')),corpusPath=path.join(folder,'corpus.json');
  const base={label:'benign',explanation:'Synthetic fixture.',reviewer:'fixture',evidence:'Synthetic unit fixture.',family:'shared-template',independentlyReviewed:true,synthetic:false};
  await writeFile(corpusPath,JSON.stringify({examplesVersion:'1',examples:[{...base,id:'one',split:'tuning',domainGroup:'one.com',features:{hostname:'one.com',signalIds:[],hasCredentials:false}},{...base,id:'two',split:'evaluation',domainGroup:'two.com',features:{hostname:'two.com',signalIds:[],hasCredentials:false}}]}));
  await assert.rejects(evaluateReviewed(corpusPath),/split leakage/);
});
