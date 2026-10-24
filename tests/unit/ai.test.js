import test from 'node:test';
import assert from 'node:assert/strict';
import { AiAssist, parseAiResponse } from '../../lib/ai-assist.js';
const settings={bf_ai_enabled:true,bf_ai_endpoint:'http://localhost:11434/v1/chat/completions',bf_ai_model:'fixture',bf_ai_key:''};
const response = reason => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({escalate:true,reason})}}]}));
const tick=()=>new Promise(r=>setImmediate(r));
const context={hostname:'fixture.test',signalIds:[],hasCredentials:false};
async function until(check) { const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw new Error('AI did not reach the expected request state');await tick();} }
test('AI schema requires an actual boolean and bounded reason',()=>{
  assert.throws(()=>parseAiResponse({choices:[{message:{content:'{"escalate":"false","reason":"fake"}'}}]}));
  assert.throws(()=>parseAiResponse({choices:[{message:{content:JSON.stringify({escalate:true,reason:'x'.repeat(301)})}}]}));
});
test('duplicate requests share one slot; cached responses do not refetch or add weights',async()=>{
  let calls=0,release;const results=[];
  const ai=new AiAssist({permission:async()=>true,onResult:(...args)=>results.push(args),fetcher:async()=>{calls++;await new Promise(r=>release=r);return response('Advisory only');}});
  const args={tabId:1,documentId:'doc',fingerprint:'one',context:{hostname:'fixture.test',signalIds:['typosquat-domain'],hasCredentials:false},settings};
  const first=ai.consider(args);await until(()=>calls===1);await ai.consider(args);assert.equal(calls,1);release();await first;await ai.consider(args);assert.equal(calls,1);
  assert.equal(results.at(-1)[3].reason,'Advisory only');assert.equal(results.at(-1)[3].weight,undefined);
});
test('stale documents never receive completed advice; denied permissions make no network request',async()=>{
  let release;const results=[];
  const ai=new AiAssist({permission:async()=>true,onResult:(...args)=>results.push(args),fetcher:async()=>{await new Promise(r=>release=r);return response('stale');}});
  const first=ai.consider({tabId:1,documentId:'old',fingerprint:'a',context,settings});await until(()=>!!release);ai.forget(1);release();await first;
  assert.equal(results.some(r=>r[3].status==='complete'),false);
  let calls=0;const denied=new AiAssist({permission:async()=>false,onResult:()=>{},fetcher:()=>{calls++;}});
  await denied.consider({tabId:2,documentId:'doc',fingerprint:'a',context,settings});assert.equal(calls,0);
});
test('deadline covers response body; metadata contains no title, full URL, or field value',async()=>{
  const results=[];let body;
  const ai=new AiAssist({permission:async()=>true,onResult:(...x)=>results.push(x),fetcher:async(url,options)=>{
    body=JSON.parse(options.body);
    return new Response(new ReadableStream({start(controller){ options.signal.addEventListener('abort',()=>controller.error(new Error('aborted'))); }}));
  }});
  await ai.consider({tabId:1,documentId:'doc',fingerprint:'a',context:{hostname:'fixture.test',signalIds:[],hasCredentials:true},settings});
  assert.equal(results.at(-1)[3].status,'timeout');
  assert.deepEqual(JSON.parse(body.messages[1].content),{hostname:'fixture.test',signalIds:[],hasCredentials:true});
});
test('request reservations and completed advice survive worker restart',async()=>{
  let snapshot,calls=0;
  const args={tabId:7,documentId:'same-document',fingerprint:'same-evidence',context,settings};
  const original=new AiAssist({permission:async()=>true,onResult:()=>{},saveCache:async value=>{snapshot=JSON.parse(JSON.stringify(value));},fetcher:async()=>{calls++;return response('Cached advice');}});
  await original.consider(args);
  const restored=new AiAssist({permission:async()=>true,onResult:()=>{},documents:snapshot,fetcher:async()=>{calls++;return response('Unwanted duplicate');}});
  await restored.consider(args);assert.equal(calls,1);
  const interrupted=new AiAssist({permission:async()=>true,onResult:()=>{},documents:{7:{id:'same-document',cache:[['same-evidence',{status:'pending'}]]}},fetcher:async()=>{calls++;return response('Unwanted retry');}});
  await interrupted.consider(args);assert.equal(calls,1);
});
