import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY, digest } from '../../lib/cloud-contract.js';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS='1';
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='https://blackfish-api.xelulabs.workers.dev';
const requests=[],known=new Set(),pages=new Map(),errors=[];
let context,worker,api,extensionId,delayed,releaseDelay,profile;
let managedGate=false,managedActive=0,managedPeak=0;
const form='<form id="login"><input type="password" value="fixture-only"><button id="submit">Submit</button></form><script>window.submissions=0;document.addEventListener("submit",e=>{e.preventDefault();window.submissions++});</script>';
async function until(fn) { const end=Date.now()+10000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Cloud fixture condition timed out'); }
async function idFor(page) { return api.evaluate(async url=>{for(const tab of await chrome.tabs.query({})){const frame=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});if(frame?.url===url)return tab.id;}},page.url()); }
async function status(page) { const tabId=await idFor(page);return api.evaluate(tabId=>chrome.runtime.sendMessage({type:'GET_TAB_STATUS',tabId}),tabId); }
async function complete(page) { return until(async()=>{const result=await status(page);return result?.state==='complete'&&result;}); }
async function save(patch) { const reply=await api.evaluate(settings=>chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings}),patch);assert.equal(reply.ok,true); }
async function open(url,body='<p>Clean fixture</p>') { pages.set(url,'<!doctype html><title>Fixture</title>'+body);const page=await context.newPage();await page.goto(url);await complete(page);return page; }
async function text(page) { const cdp=await context.newCDPSession(page);try{const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});const read=n=>(n.nodeType===3?n.nodeValue:'')+(n.children||[]).map(read).join(' ')+(n.shadowRoots||[]).map(read).join(' ');return read(root);}finally{await cdp.detach();} }
async function launch(){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:900},args:['--disable-extensions-except='+root,'--load-extension='+root]});
  context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});});
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(!/^https?:/.test(url))return route.continue();
    if(url==='https://api.x.ai/v1/chat/completions'){
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      requests.push({url,body:route.request().postDataJSON()});
      return route.fulfill({headers,json:{choices:[{message:{content:'{"escalate":true,"reason":"Personal AI fixture advice only."}'}}]}});
    }
    if(url.startsWith(origin+'/')){
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      const body=route.request().postDataJSON();requests.push({url,body});
      if(url.endsWith('/lookup')){
        if(body.urlHash===delayed)await new Promise(resolve=>{releaseDelay=resolve;});
        const now=Date.now();
        return route.fulfill({headers,json:known.has(body.urlHash)?{status:'confirmed',id:'reviewed-'+body.urlHash.slice(0,8),scope:'url',hostname:body.hostname,urlHash:body.urlHash,revision:1,reviewedAt:now,expiresAt:now+DAY,provenance:'Independent local fixture review'}:{status:'unknown'}});
      }
      if(url.endsWith('/reports'))return route.fulfill({status:202,headers,json:{status:'pending',reportId:'fixture-report'}});
      if(url.endsWith('/triage')){
        managedActive++;managedPeak=Math.max(managedPeak,managedActive);await new Promise(resolve=>setTimeout(resolve,600));managedActive--;
        return route.fulfill({headers,json:{status:'complete',escalate:false,reason:'Credential context: '+body.context.hasCredentials,versions:body.versions}});
      }
      return route.fulfill({headers,json:{schema:1,rulesVersion:'2',model:'fixture',promptVersion:'1',examplesVersion:'1',managedEnabled:managedGate}});
    }
    return route.fulfill({contentType:'text/html',body:pages.get(url)||'<!doctype html><title>Fixture</title><p>Clean fixture</p>'});
  });
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');extensionId=new URL(worker.url()).host;
  api=await context.newPage();await api.goto('chrome-extension://'+extensionId+'/options/options.html');
  await api.evaluate(()=>document.fonts.ready);
}
before(async()=>{profile=await mkdtemp(path.join(tmpdir(),'blackfish-cloud-'));await launch();});
after(async()=>{await context?.close();assert.deepEqual(errors,[],'cloud UI has no JavaScript or console errors');});

test('default browsing makes no cloud requests; settings fit desktop and narrow viewports',async()=>{
  const page=await open('https://default.example.com/');assert.equal(requests.length,0);
  await mkdir(path.join(root,'test-results'),{recursive:true});
  for(const width of [1440,390]){await api.setViewportSize({width,height:900});assert.equal(await api.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await api.screenshot({path:path.join(root,'test-results/cloud-settings-'+width+'.png'),fullPage:true});}
  await api.setViewportSize({width:1440,height:900});await page.close();
});
test('denied host permission does not enable cloud switches',async()=>{
  await api.evaluate(()=>{chrome.permissions.request=async()=>false;});
  await api.locator('#cloudOrigin').fill(origin);await api.locator('#cloudToken').fill('a'.repeat(64));await api.locator('#cloudLookup').check();await api.locator('#saveCloudBtn').click();
  await api.getByText('Network permission denied. Your saved cloud choices were kept.',{exact:true}).waitFor();
  const reply=await api.evaluate(()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}));assert.equal(reply.settings.bf_cloud_lookup,false);assert.equal(requests.length,0);
  await worker.evaluate(()=>{chrome.permissions.contains=async()=>true;});
  await save({bf_cloud_origin:origin,bf_cloud_token:'a'.repeat(64),bf_cloud_lookup:true});
});
test('confirmed memory warns without adding score or interrupting a clean same-site submission',async()=>{
  const url='https://known.example.com/login?campaign=one';known.add(await digest(url));
  const page=await open(url,form);
  const verdict=await until(async()=>{const s=await status(page);return s.reputation?.status==='confirmed'&&s;});
  assert.equal(verdict.scored.score,15);assert.equal(verdict.scored.level,'LOW');
  await until(async()=>(await text(page)).includes('PREVIOUSLY CONFIRMED PHISHING'));
  await page.locator('#submit').click();assert.equal(await page.evaluate(()=>window.submissions),1);
  assert.equal((await text(page)).includes('Check this credential submission'),false);
  const urlHash=await digest(url),payload=requests.find(request=>request.body?.urlHash===urlHash);
  assert.equal(payload.body.url,undefined);assert.equal(JSON.stringify(payload).includes('campaign=one'),false);
  await page.screenshot({path:path.join(root,'test-results/cloud-reputation-warning.png')});
  const tabId=await idFor(page),popup=await context.newPage();
  await popup.addInitScript(tabId=>{chrome.tabs.query=async()=>[{id:tabId}];},tabId);await popup.setViewportSize({width:400,height:600});
  await popup.goto('chrome-extension://'+extensionId+'/popup/popup.html');await popup.locator('#reputationPanel').waitFor({state:'visible'});
  assert.equal(await popup.locator('#scoreNum').textContent(),'15');assert.equal(await popup.locator('#levelLabel').textContent(),'No strong phishing indicators detected');
  await popup.screenshot({path:path.join(root,'test-results/cloud-popup.png'),fullPage:true});await popup.close();
  await page.close();
});
test('hash scopes, trusted origins and private addresses prevent unintended shared warnings or traffic',async()=>{
  const page=await open('https://known.example.com/login?campaign=two');
  await until(async()=>(await status(page)).reputation?.status==='unknown');assert.equal((await text(page)).includes('PREVIOUSLY CONFIRMED PHISHING'),false);
  await save({bf_allowlist:['https://trusted.example.com']});
  const before=requests.length;
  const trusted=await context.newPage();await trusted.goto('https://trusted.example.com/');await until(async()=>(await status(trusted)).state==='trusted');
  const privatePage=await open('http://192.168.1.7/');await privatePage.waitForTimeout(150);
  assert.equal(requests.length,before);await trusted.close();await privatePage.close();await page.close();
});
test('responses for an old SPA URL never alter the newer page',async()=>{
  const url='https://changing.example.com/old';delayed=await digest(url);known.add(delayed);
  const page=await open(url);await until(()=>!!releaseDelay);
  await page.evaluate(()=>history.pushState({},'', '/new'));await complete(page);
  releaseDelay();delayed=null;releaseDelay=null;
  await until(async()=>(await status(page)).reputation?.status==='unknown');
  assert.equal((await text(page)).includes('PREVIOUSLY CONFIRMED PHISHING'),false);await page.close();
});
test('browser-provided incognito status excludes automatic cloud traffic',async()=>{
  await worker.evaluate(()=>{globalThis.originalTabGet=chrome.tabs.get;chrome.tabs.get=async tabId=>({...await globalThis.originalTabGet(tabId),incognito:true});});
  const before=requests.length;const page=await open('https://incognito.example.com/',form);await page.waitForTimeout(100);assert.equal(requests.length,before);
  await page.close();await worker.evaluate(()=>{chrome.tabs.get=globalThis.originalTabGet;delete globalThis.originalTabGet;});
});
test('managed AI stays gated; reports require preview and current-document consent',async()=>{
  await save({bf_allowlist:[],bf_managed_ai:true,bf_cloud_reports:true});
  const page=await open('https://report.example.com/',form.replace('<form id="login">','<form id="login" action="https://identity.example.net/">'));
  await until(async()=>(await status(page)).ai?.status==='evaluation-required');
  assert.equal(requests.some(request=>request.url.endsWith('/triage')),false);
  const tabId=await idFor(page);
  const popup=await context.newPage();
  await popup.addInitScript(tabId=>{chrome.tabs.query=async()=>[{id:tabId}];},tabId);
  await popup.setViewportSize({width:400,height:600});await popup.goto('chrome-extension://'+extensionId+'/popup/popup.html');
  const beforePreview=requests.filter(request=>request.url.endsWith('/reports')).length;
  await popup.locator('#reportBtn').click();await popup.locator('#reportDialog').waitFor({state:'visible'});
  assert.equal(await popup.locator('#confirmReport').isDisabled(),true);assert.equal(await popup.locator('#reportUrl').inputValue(),page.url());
  await popup.locator('#cancelReport').click();assert.equal(requests.filter(request=>request.url.endsWith('/reports')).length,beforePreview);
  await popup.close();
  const preview=await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'GET_REPORT_PREVIEW',tabId}),tabId);assert.equal(preview.ok,true);
  const reportCount=requests.filter(request=>request.url.endsWith('/reports')).length;
  const denied=await api.evaluate(requestId=>chrome.runtime.sendMessage({type:'SUBMIT_REPORT',requestId,confirmed:true,reuseConsent:false}),preview.requestId);assert.equal(denied.ok,false);
  assert.equal(requests.filter(request=>request.url.endsWith('/reports')).length,reportCount);
  const accepted=await api.evaluate(requestId=>chrome.runtime.sendMessage({type:'SUBMIT_REPORT',requestId,confirmed:true,reuseConsent:true}),preview.requestId);assert.equal(accepted.ok,true);
  assert.equal((await status(page)).reputation.status,'unknown');
  const stale=await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'GET_REPORT_PREVIEW',tabId}),tabId);await page.evaluate(()=>history.pushState({},'', '/new'));
  const rejected=await api.evaluate(requestId=>chrome.runtime.sendMessage({type:'SUBMIT_REPORT',requestId,confirmed:true,reuseConsent:true}),stale.requestId);assert.equal(rejected.ok,false);
  await page.close();
});
test('managed advice serializes evidence changes and remains stable through rescans',async()=>{
  managedGate=true;await save({bf_managed_ai:true});
  const page=await open('https://google.managed-example.com/',form);
  await until(()=>requests.some(request=>request.url.endsWith('/triage')&&request.body.context.hostname==='google.managed-example.com'));
  await page.evaluate(()=>document.querySelector('input').type='text');
  await until(async()=>(await status(page)).scored.score===35);
  await until(async()=>(await status(page)).ai?.reason==='Credential context: false');
  assert.equal(managedPeak,1);
  const count=()=>requests.filter(request=>request.url.endsWith('/triage')&&request.body.context.hostname==='google.managed-example.com').length;
  assert.equal(count(),2);
  const tabId=await idFor(page);await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'RESCAN_ACTIVE_TAB',tabId}),tabId);
  await until(async()=>(await status(page)).ai?.reason==='Credential context: false');assert.equal(count(),2);
  await page.close();managedGate=false;
});
test('personal AI uses a correctly bound browser fetch and never receives page values',async()=>{
  await save({bf_managed_ai:false,bf_ai_enabled:true,bf_ai_endpoint:'https://api.x.ai/v1/chat/completions',bf_ai_model:'fixture',bf_ai_key:'fixture-only-key'});
  const page=await open('https://personal.example.com/',form.replace('<form id="login">','<form id="login" action="https://identity.example.net/">'));
  const result=await until(async()=>{const s=await status(page);return s.ai?.status==='complete'&&s;});
  assert.equal(result.scored.score,50);assert.equal(result.ai.reason,'Personal AI fixture advice only.');
  const request=requests.find(request=>request.url==='https://api.x.ai/v1/chat/completions');
  const metadata=JSON.parse(request.body.messages[1].content);
  assert.deepEqual(Object.keys(metadata).sort(),['hasCredentials','hostname','signalIds']);assert.equal(JSON.stringify(metadata).includes('fixture-only'),false);
  await page.close();
});
test('cache clearing preserves invitation credentials; opt-out stops subsequent cloud traffic',async()=>{
  const cleared=await api.evaluate(()=>chrome.runtime.sendMessage({type:'CLEAR_LOCAL_CACHE'}));assert.equal(cleared.ok,true);assert.equal(cleared.cache.entries,0);
  const stored=await api.evaluate(()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}));assert.equal(stored.settings.bf_cloud_token,'a'.repeat(64));
  await save({bf_cloud_lookup:false,bf_cloud_reports:false,bf_managed_ai:false});
  const before=requests.length;const page=await open('https://offline.example.com/');await page.waitForTimeout(150);assert.equal(requests.length,before);await page.close();
});
test('worker restart reuses persistent memory without extending review freshness',async()=>{
  await save({bf_cloud_lookup:true});
  const url='https://restart.example.com/login';known.add(await digest(url));
  const page=await open(url);const first=await until(async()=>{const s=await status(page);return s.reputation?.status==='confirmed'&&s;});
  const requestsBefore=requests.filter(request=>request.url.endsWith('/lookup')).length;
  const cdp=await context.newCDPSession(api);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
  const after=await until(async()=>{const s=await status(page);return s.reputation?.status==='confirmed'&&s;});
  assert.ok(after.reputation.freshUntil<=first.reputation.freshUntil);assert.equal(requests.filter(request=>request.url.endsWith('/lookup')).length,requestsBefore);
  await page.close();
});
test('persistent reputation survives a complete browser relaunch',async()=>{
  const before=requests.length;
  await context.close();await launch();
  const page=await open('https://restart.example.com/login');
  const result=await until(async()=>{const s=await status(page);return s.reputation?.status==='confirmed'&&s;});
  assert.equal(result.reputation.cached,true);assert.equal(requests.length,before);
  await page.close();
});
