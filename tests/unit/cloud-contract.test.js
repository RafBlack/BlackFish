import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, publicHostname, digest, adviceKey } from '../../lib/cloud-contract.js';
import { PersistentCache } from '../../lib/persistent-cache.js';

const context={hostname:'login.example.com',signalIds:['cross-origin-credential-form'],hasCredentials:true};

test('public URL normalization preserves query and path boundaries while removing fragments',async()=>{
  assert.equal(canonicalUrl('https://EXAMPLE.com:443/a?x=1#part').url,'https://example.com/a?x=1');
  assert.notEqual(await digest(canonicalUrl('https://example.com/a?x=1').url),await digest(canonicalUrl('https://example.com/a?x=2').url));
  for(const url of ['file:///etc/passwd','https://user:secret@example.com/','http://localhost/','http://127.1/','http://2130706433/','http://10.1.2.3/','http://172.16.1.1/','http://192.168.1.1/','http://[::1]/','http://[::ffff:192.168.1.1]/','https://intranet/','https://device.local/','http://hidden.onion/','http://hidden.i2p/','https://printer.localdomain/','https://employee.corp/'])assert.equal(canonicalUrl(url),null,url);
  assert.equal(publicHostname('xn--bcher-kva.de'),true);
  assert.equal(publicHostname('example.com/path'),false);
});

test('persistent cache evicts expired then least recently used entries and never stores settings',async()=>{
  let now=1000,saved;
  const cache=new PersistentCache({now:()=>now,maxEntries:2,maxBytes:1024,save:async entries=>{saved=entries;}});
  await cache.put('a','threat',{status:'unknown'},2000);now++;
  await cache.put('b','advice',{reason:'advisory'},3000);now++;cache.get('a');now++;
  await cache.put('c','threat',{status:'unknown'},4000);
  assert.equal(cache.get('b'),null);assert.ok(cache.get('a'));assert.ok(cache.get('c'));
  const restored=new PersistentCache({entries:saved,now:()=>2500});assert.equal(restored.get('a'),null);assert.ok(restored.get('c'));
  await cache.put('oversize','advice',{reason:'x'.repeat(2000)},4000);assert.ok(cache.stats().bytes<=1024);
  await cache.clear();assert.equal(cache.stats().entries,0);
});

test('versioned advice keys change for every policy dependency without depending on rule order',async()=>{
  const base={rules:'2',model:'model',prompt:'1',examples:'1'};
  const key=await adviceKey(context,base);
  for(const field of Object.keys(base))assert.notEqual(await adviceKey(context,{...base,[field]:'changed'}),key);
  assert.equal(await adviceKey({...context,signalIds:[...context.signalIds].reverse()},base),key);
});
