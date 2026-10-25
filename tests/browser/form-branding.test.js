import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { FORM_BRANDING_CORPUS } from '../../evaluation/form-branding-corpus.js';
import { FORM_BRANDING_ENABLED } from '../../content/form-branding.js';
import { RULES_VERSION } from '../../lib/cloud-contract.js';

let browser, page, bundle;
const errors=[];
const fixtures=new Map(FORM_BRANDING_CORPUS.fixtures.map(item=>[item.id,item]));
before(async()=>{
  const built=await build({stdin:{contents:'export {analyze} from "./scripts/evaluation-entry.js"; export {submissionRisk} from "./content/form-guard.js"; export {BF_BRANDS} from "./lib/heuristics/brand-list.js";',resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'iife',globalName:'BrandingTest',target:'chrome116'});
  bundle=built.outputFiles[0].text;
  browser=await chromium.launch({channel:'chromium',headless:true});
  page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const pages=new Map(FORM_BRANDING_CORPUS.fixtures.map(item=>[item.url,item.html]));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:pages.get(route.request().url()) || '<!doctype html><p>Local resource</p>'}));
});
after(async()=>{await browser?.close();assert.deepEqual(errors,[]);});
async function open(id) { await page.goto(fixtures.get(id).url);await page.addScriptTag({content:bundle}); }
async function analyze(formContext) { return page.evaluate(options=>BrandingTest.analyze(options),{formContext}); }

test('candidate covers associated headings, legends, accessible names, OTP and open shadow roots',async()=>{
  for(const id of ['heading','legend','accessible-name','label-reference','otp','shadow']) {
    await open(id);
    assert.equal((await analyze(false)).score,15,id);
    const candidate=await analyze(true);
    assert.equal(candidate.score,45,id);assert.equal(candidate.interrupted,false,id);
    const guard=await page.evaluate(()=>{
      const form=document.querySelector('form') || document.getElementById('widget').shadowRoot.querySelector('form');
      const risk=BrandingTest.submissionRisk(form,null,BrandingTest.BF_BRANDS,[],{formContext:true});
      return {score:risk.scored.score,interrupted:risk.interrupt};
    });
    assert.deepEqual(guard,{score:45,interrupted:false},id);
  }
});
test('approved families, articles, hidden headings, logos and oversized or shared containers add no identity weight',async()=>{
  for(const id of ['microsoft','brand-sibling','stripe','ordinary-login','article','body-heading','logo-only','hidden-heading','multiple-forms','oversized-elements','oversized-text']) {
    await open(id);
    assert.equal((await analyze(true)).score,15,id);
  }
  for(const id of ['text-only-http','simulation-info']) { await open(id);const result=await analyze(true);assert.equal(result.level,'LOW',id);assert.equal(result.interrupted,false,id);assert.equal(result.signalIds.includes('credential-presence'),false,id); }
});
test('repeated branding remains one contribution; removal and rescan can lower the candidate score',async()=>{
  await open('repeated');
  const first=await analyze(true);assert.equal(first.score,45);
  assert.equal(first.signalIds.filter(id=>id==='brand-name-domain-mismatch').length,1);
  await open('heading');
  for(let i=0;i<100;i++)assert.equal((await analyze(true)).score,45);
  await page.locator('h1').evaluate(el=>el.textContent='Your account');
  assert.equal((await analyze(true)).score,15);
  await page.locator('form').evaluate(el=>el.remove());
  assert.equal((await analyze(true)).score,0);
});
test('candidate cannot use external hidden references or more than the bounded attribute text',async()=>{
  await open('label-reference');
  await page.locator('#identity').evaluate(el=>el.hidden=true);
  assert.equal((await analyze(true)).score,15);
  await open('accessible-name');
  await page.locator('form').evaluate(el=>el.setAttribute('aria-label','x'.repeat(1001)+' Apple'));
  assert.equal((await analyze(true)).score,15);
});
test('insecure password and strong same-site impersonation policies remain intact',async()=>{
  await open('insecure-password');assert.equal((await analyze(true)).interrupted,true);
  await open('lookalike');const risk=await analyze(true);
  assert.equal(risk.score,60);assert.equal(risk.interrupted,true);
  await open('sso');assert.equal((await analyze(true)).interrupted,false);
});
test('ambiguous enterprise branding fails the benign gate, so runtime defaults and AI policy stay unchanged',async()=>{
  await open('enterprise-login');
  assert.equal((await analyze(false)).score,15);
  assert.equal((await analyze(true)).score,45);
  assert.equal(FORM_BRANDING_ENABLED,false);
  assert.equal(RULES_VERSION,'2');
  assert.equal((await page.evaluate(()=>BrandingTest.analyze())).score,15);
});
