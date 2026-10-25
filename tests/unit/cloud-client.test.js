import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, DAY, validateThreat, RULES_VERSION } from '../../lib/cloud-contract.js';
import { CloudClient } from '../../lib/cloud-client.js';
import { PersistentCache } from '../../lib/persistent-cache.js';

const settings={bf_cloud_origin:'https://blackfish-api.xelulabs.workers.dev',bf_cloud_token:'a'.repeat(64),bf_cloud_lookup:true,bf_cloud_reports:true,bf_managed_ai:true};
const context={hostname:'login.example.com',signalIds:['cross-origin-credential-form'],hasCredentials:true};

test('no network calls without consent or for excluded/private contexts',async()=>{
  let calls=0;
  const client=new CloudClient({cache:new PersistentCache(),permission:async()=>true,fetcher:async()=>{calls++;throw new Error('unexpected');}});
  assert.equal((await client.lookup('https://example.com/',{...settings,bf_cloud_lookup:false})).status,'off');
  await client.lookup('http://10.0.0.1/',settings);await client.lookup('https://example.com/',settings,true);await client.triage(context,settings,true);
  assert.equal(calls,0);
});

test('parallel lookups share a request and confirmed records expire at the freshness boundary',async()=>{
  let calls=0,now=Date.now(),saved;
  const url='https://login.example.com/a?token=private',urlHash=await digest(url);
  const cache=new PersistentCache({now:()=>now,save:async entries=>{saved=entries;}});
  const client=new CloudClient({cache,now:()=>now,permission:async()=>true,fetcher:async(endpoint,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.url,undefined);assert.equal(JSON.stringify(payload).includes('private'),false);
    return Response.json({status:'confirmed',id:'one',scope:'url',hostname:'login.example.com',urlHash,revision:1,reviewedAt:now,expiresAt:now+DAY,provenance:'Independent review'});
  }});
  const results=await Promise.all(Array.from({length:100},()=>client.lookup(url,settings)));
  assert.equal(calls,1);assert.equal(results[0].status,'confirmed');
  const restored=new CloudClient({cache:new PersistentCache({entries:saved,now:()=>now}),permission:async()=>true,fetcher:()=>{throw new Error('unexpected');},now:()=>now});
  assert.equal((await restored.lookup(url,settings)).cached,true);
  now+=900001;await client.lookup(url,settings);assert.equal(calls,2);
  assert.throws(()=>validateThreat(results[0],{hostname:'other.example.com',urlHash}));
});

test('late responses after cancellation cannot repopulate a cleared cache',async()=>{
  let release,started;
  const began=new Promise(resolve=>{started=resolve;});
  const cache=new PersistentCache();
  const client=new CloudClient({cache,permission:async()=>true,fetcher:async()=>{started();await new Promise(resolve=>{release=resolve;});return Response.json({status:'unknown'});}});
  const request=client.lookup('https://example.com/',settings);await began;client.cancel();await cache.clear();release();
  assert.equal((await request).status,'interrupted');assert.equal(cache.stats().entries,0);
});

test('a hanging permission check and a stalled body cannot exceed the request deadline',async()=>{
  const client=new CloudClient({cache:new PersistentCache(),permission:()=>new Promise(()=>{}),fetcher:()=>{throw new Error('must not fetch');}});
  assert.equal((await client.call(settings,'/v1/config',null,20)).status,'timeout');
  const body=new CloudClient({cache:new PersistentCache(),permission:async()=>true,fetcher:async()=>new Response(new ReadableStream({start(){}}))});
  assert.equal((await body.call(settings,'/v1/config',null,20)).status,'timeout');
});

test('managed AI shares one three-second budget across configuration and inference',async()=>{
  const client=new CloudClient({cache:new PersistentCache(),permission:async()=>true,fetcher:async endpoint=>{
    if(endpoint.endsWith('/config')){await new Promise(resolve=>setTimeout(resolve,800));return Response.json({schema:1,rulesVersion:RULES_VERSION,model:'fixture',promptVersion:'1',examplesVersion:'1',managedEnabled:true});}
    return new Promise(()=>{});
  }});
  const start=performance.now();assert.equal((await client.triage(context,settings)).status,'timeout');assert.ok(performance.now()-start<3500);
});

test('opting out during URL hashing cannot start a request afterward',async()=>{
  let calls=0;
  const client=new CloudClient({cache:new PersistentCache(),permission:async()=>true,fetcher:async()=>{calls++;return Response.json({status:'unknown'});}});
  const pending=client.lookup('https://example.com/private?token=fixture',settings);client.cancel();
  assert.equal((await pending).status,'interrupted');assert.equal(calls,0);
});

test('server retry cooldowns survive construction of a new worker client',async()=>{
  const cache=new PersistentCache();let calls=0;
  const client=new CloudClient({cache,permission:async()=>true,fetcher:async()=>{calls++;return Response.json({status:'limited'},{status:429,headers:{'Retry-After':'3600'}});}});
  assert.equal((await client.lookup('https://one.example.com/',settings)).status,'limited');
  const fresh=new CloudClient({cache:new PersistentCache({entries:[...cache.entries.values()]}),permission:async()=>true,fetcher:async()=>{calls++;throw new Error('must respect cooldown');}});
  assert.equal((await fresh.lookup('https://two.example.com/',settings)).status,'limited');assert.equal(calls,1);
});

test('cached managed advice does not extend the capability freshness window',async()=>{
  let now=Date.now(),calls=0;
  const cache=new PersistentCache({now:()=>now});
  const client=new CloudClient({cache,now:()=>now,permission:async()=>true,fetcher:async(endpoint,options)=>{
    calls++;
    return endpoint.endsWith('/config')?Response.json({schema:1,rulesVersion:RULES_VERSION,model:'fixture',promptVersion:'1',examplesVersion:'1',managedEnabled:true}):Response.json({status:'complete',escalate:false,reason:'Bounded advice.',versions:JSON.parse(options.body).versions});
  }});
  const first=await client.triage(context,settings);now+=14*60000;
  const reused=await client.triage(context,settings);assert.equal(reused.cached,true);assert.equal(reused.policyFreshUntil,first.policyFreshUntil);assert.equal(calls,2);
});
