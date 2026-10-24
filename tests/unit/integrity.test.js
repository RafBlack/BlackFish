import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CONFUSABLES } from '../../lib/vendor/confusables.js';
import { domainInfo } from '../../lib/heuristics/domain.js';
test('vendored Unicode source and generated mapping match the pinned checksum',async()=>{
  const raw=await readFile(new URL('../../lib/vendor/confusables-17.0.0.txt',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'091c7f82fc39ef208faf8f94d29c244de99254675e09de163160c810d13ef22a');
  const expected={};
  const decode=s=>String.fromCodePoint(...s.trim().split(/\s+/).map(x=>parseInt(x,16)));
  for(const line of raw.toString().split('\n')){
    const clean=line.split('#')[0].trim();if(!clean)continue;
    const[a,b]=clean.split(';');expected[decode(a)]=decode(b);
  }
  assert.deepEqual(CONFUSABLES,expected);
});
test('corpus has 200 benign and 100 phishing cases with no domain/family split leakage',async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL('../../evaluation/corpus.json',import.meta.url),'utf8'));
  assert.equal(fixtures.filter(f=>f.label==='benign').length,200);
  assert.equal(fixtures.filter(f=>f.label==='phishing').length,100);
  const families=new Map(),domains=new Map(),ids=new Set();
  for(const f of fixtures){
    assert.equal(ids.has(f.id),false);ids.add(f.id);
    for(const[map,key]of [[families,f.family],[domains,domainInfo(new URL(f.url).hostname).domain]]){
      if(map.has(key))assert.equal(map.get(key),f.split,key);else map.set(key,f.split);
    }
  }
});
