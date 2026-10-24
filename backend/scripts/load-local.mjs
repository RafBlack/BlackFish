import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CloudClient } from '../../lib/cloud-client.js';
import { PersistentCache } from '../../lib/persistent-cache.js';
import { DAY, digest } from '../../lib/cloud-contract.js';

const target='https://known-phishing.example.org/login?campaign=fixture';
const tokens=Array.from({length:25},(_,i)=>(i+1).toString(16).padStart(64,'0'));
if(process.argv.includes('--seed')){
  const sql=['DELETE FROM reports;','DELETE FROM threats;','DELETE FROM examples;','DELETE FROM example_groups;','DELETE FROM ai_jobs;','DELETE FROM usage;','DELETE FROM installations;',"UPDATE service_meta SET value='1' WHERE key='examples_version';"];
  for(let i=0;i<tokens.length;i++)sql.push("INSERT INTO installations(id,token_hash,created_at) VALUES('fixture-"+i+"','"+await digest(tokens[i])+"',"+Date.now()+');');
  const now=Date.now();sql.push("INSERT INTO threats(id,scope,hostname,url_hash,provenance,reviewer,reviewed_at,expires_at) VALUES('fixture-threat','url','known-phishing.example.org','"+await digest(target)+"','Synthetic local review','fixture',"+now+','+(now+DAY)+');');
  await mkdir(new URL('../.wrangler/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.wrangler/test-seed.sql',import.meta.url),sql.join('\n')+'\n');
  console.log('Prepared synthetic test seed only. Apply it to blackfish-local-test with --local; never apply it to production.');
}else{
  const base=process.argv[2]||'http://127.0.0.1:8788';
  if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('The load fixture may only target a local test service.');
  const latencies=[],networkTimes=[];let lookups=0;
  const clients=tokens.map(token=>({settings:{bf_cloud_origin:base,bf_cloud_token:token,bf_cloud_lookup:true,bf_managed_ai:true},client:new CloudClient({cache:new PersistentCache(),permission:async()=>true,fetcher:async(...args)=>{const start=performance.now();if(args[0].endsWith('/lookup'))lookups++;const response=await fetch(...args);networkTimes.push(performance.now()-start);return response;}})}));
  const first=await Promise.all(clients.map(async({client,settings})=>{const start=performance.now(),result=await client.lookup(target,settings);latencies.push(performance.now()-start);return result;}));
  assert.equal(first.every(row=>row.status==='confirmed'),true);
  const repeated=await Promise.all(clients.flatMap(({client,settings})=>Array.from({length:100},()=>client.lookup(target,settings))));
  assert.equal(repeated.every(row=>row.status==='confirmed'&&row.cached),true);assert.equal(lookups,25);
  const context={hostname:'unknown-login.example.org',signalIds:['cross-origin-credential-form'],hasCredentials:true};
  await Promise.all(clients.map(({client,settings})=>client.triage(context,settings)));
  let stats;const end=Date.now()+3000;
  do{stats=await(await fetch(base+'/__test/stats')).json();if(stats.completed)break;await new Promise(resolve=>setTimeout(resolve,30));}while(Date.now()<end);
  const advice=await Promise.all(clients.map(({client,settings})=>client.triage(context,settings)));
  assert.equal(advice.every(row=>row.status==='complete'),true);assert.equal(stats.modelCalls,1);
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  const report={synthetic:true,environment:'local Wrangler/D1 with a fake model; no production accuracy claim',testers:25,reputationRequests:2525,reputationNetworkCalls:lookups,reputationLocalCacheHitRate:2500/2525,reputationFirstLookupP95Ms:p95(latencies),networkP95Ms:p95(networkTimes),managedModelCalls:stats.modelCalls,managedRequests:50,completedAdvice:advice.length,reviewBacklog:stats.backlog};
  await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../artifacts/load-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
