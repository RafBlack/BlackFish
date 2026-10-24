import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentCache } from '../../lib/persistent-cache.js';
import { sanitizeSettings, publicSettings } from '../../lib/settings.js';
import { AiAssist } from '../../lib/ai-assist.js';

const settings={bf_cloud_origin:'https://blackfish-api.xelulabs.workers.dev',bf_cloud_token:'a'.repeat(64),bf_cloud_lookup:true,bf_cloud_reports:true,bf_managed_ai:true};
const context={hostname:'login.example.com',signalIds:['cross-origin-credential-form'],hasCredentials:true};

test('settings preserve personal configuration and require independent cloud opt-ins',()=>{
  const personal=sanitizeSettings({bf_settings_version:2,bf_ai_enabled:true,bf_ai_endpoint:'http://localhost:11434/v1/chat/completions',bf_ai_model:'local',bf_ai_key:'saved'},{migrate:true});
  assert.equal(personal.bf_ai_enabled,true);assert.equal(personal.bf_cloud_lookup,false);
  const enabled=sanitizeSettings({...settings,bf_ai_enabled:true,bf_ai_endpoint:personal.bf_ai_endpoint,bf_ai_model:'local'});
  assert.equal(enabled.bf_managed_ai,true);assert.equal(enabled.bf_ai_enabled,false);
  assert.equal(enabled.bf_ai_model,'local');assert.equal(publicSettings(enabled).bf_cloud_token,undefined);
  assert.equal(sanitizeSettings({...settings,bf_cloud_origin:'https://evil.com'}).bf_cloud_lookup,false);
});

test('personal AI advice persists across new documents without model calls or shared labels',async()=>{
  let calls=0;const results=[];
  const cache=new PersistentCache();
  const personal={bf_ai_enabled:true,bf_ai_endpoint:'http://localhost:11434/v1/chat/completions',bf_ai_model:'fixture'};
  const args={permission:async()=>true,onResult:(...values)=>results.push(values.at(-1)),cache,fetcher:async()=>{calls++;return Response.json({choices:[{message:{content:'{"escalate":true,"reason":"Advisory only"}'}}]});}};
  await new AiAssist(args).consider({tabId:1,documentId:'one',fingerprint:'one',context,settings:personal});
  await new AiAssist({...args,budget:{start:Date.now(),count:30}}).consider({tabId:2,documentId:'two',fingerprint:'two',context,settings:personal});
  assert.equal(calls,1);assert.equal(results.at(-1).status,'complete');assert.equal([...cache.entries.values()].every(entry=>entry.kind==='advice'),true);
});
