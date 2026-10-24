import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let context, api, extensionId;
const routes = new Map(), errors = [];
const form = '<form id="login"><label>Password<input name="password" type="password" required value="fixture-only"></label><button id="submit" name="choice" value="login">Sign in</button></form><script>window.submissions=[];document.addEventListener("submit",e=>{e.preventDefault();window.submissions.push({submitter:e.submitter?.name,value:e.submitter?.value,action:e.target.action})});</script>';
function html(body, title='Fixture') { return '<!doctype html><html><head><meta charset="utf-8"><title>'+title+'</title></head><body>'+body+'</body></html>'; }
function route(url, body) { routes.set(url,body); }
async function waitFor(fn, message='condition', timeout=10000) {
  const deadline=Date.now()+timeout;let result;
  while(Date.now()<deadline) { result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,60)); }
  throw new Error('Timed out waiting for '+message);
}
async function idFor(page) {
  const url=page.url();
  return waitFor(()=>api.evaluate(async expected=>{
    for(const tab of await chrome.tabs.query({})) {
      try { const f=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});if(f?.url===expected)return tab.id; } catch {}
    }
    return null;
  },url),'tab ID');
}
async function status(page) { const tabId=await idFor(page);return api.evaluate(tabId=>chrome.runtime.sendMessage({type:'GET_TAB_STATUS',tabId}),tabId); }
async function complete(page, predicate=()=>true) { return waitFor(async()=>{const s=await status(page);return s && ['complete','trusted'].includes(s.state) && predicate(s) && s;},'completed verdict'); }
async function open(url, body, title='Fixture') {
  route(url,html(body,title));const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await complete(page);return page;
}
async function treeText(page) {
  const session=await context.newCDPSession(page);
  try {
    const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function text(n) { return (n.nodeType===3?n.nodeValue:'')+(n.children||[]).map(text).join(' ')+(n.shadowRoots||[]).map(text).join(' '); }
    return text(root);
  } finally { await session.detach(); }
}
async function dialog(page) { return waitFor(async()=> (await treeText(page)).includes('Check this credential submission'),'guard dialog'); }
async function cancel(page) { await page.keyboard.press('Escape');await waitFor(async()=>!(await treeText(page)).includes('Check this credential submission'),'dialog closing'); }
async function proceed(page) { await page.keyboard.press('Tab');await page.keyboard.press('Enter'); }
async function settings(patch) { return api.evaluate(settings=>chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings}),patch); }

before(async()=>{
  await mkdir(path.join(root,'test-results'),{recursive:true});
  const profile=await mkdtemp(path.join(tmpdir(),'blackfish-browser-'));
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root]});
  await context.route('**/*',async r=>{
    const u=r.request().url();
    if(!/^https?:/.test(u))return r.continue();
    const body=routes.get(u) ?? html('<p>Local fixture</p>');
    await r.fulfill({status:200,contentType:'text/html',body,headers:{'Cache-Control':'no-store'}});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  extensionId=new URL(worker.url()).host;
  api=await context.newPage();await api.goto('chrome-extension://'+extensionId+'/options/options.html');
  const reply=await api.evaluate(()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}));
  assert.equal(reply?.ok,true,JSON.stringify({reply,body:await api.locator('body').innerText()}));
  await api.evaluate(()=>document.fonts.ready);
  await api.screenshot({path:path.join(root,'test-results/settings-desktop.png'),fullPage:true});
  await api.setViewportSize({width:390,height:844});
  assert.equal(await api.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'settings fit a narrow viewport');
  await api.screenshot({path:path.join(root,'test-results/settings-mobile.png'),fullPage:true});
  await api.setViewportSize({width:1280,height:800});
});
after(async()=>{await context?.close();assert.deepEqual(errors,[],'page JavaScript errors');});

test('stable rescans, clean iframe isolation, evidence removal and live popup',async()=>{
  route('https://frame.example.org/',html('<p>Clean embedded frame</p>'));
  const page=await open('https://paypa1.com/',form+'<iframe src="https://frame.example.org/"></iframe>');
  const first=await complete(page,s=>s.frameCount===2);
  assert.equal(first.scored.score,60);
  await page.screenshot({path:path.join(root,'test-results/page-warning.png')});
  const tabId=await idFor(page);
  for(let i=0;i<4;i++) {
    const r=await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'RESCAN_ACTIVE_TAB',tabId}),tabId);
    assert.equal(r.ok,true);assert.equal(r.result.scored.score,60);
  }
  const popup=await context.newPage();
  await popup.addInitScript(({tabId})=>{
    const original=chrome.tabs.query;
    chrome.tabs.query=(q,...args)=>q.active && q.currentWindow ? Promise.resolve([{id:tabId}]) : original(q,...args);
  },{tabId});
  await popup.setViewportSize({width:400,height:600});
  await popup.goto('chrome-extension://'+extensionId+'/popup/popup.html');
  await popup.getByText('High phishing risk',{exact:true}).waitFor();
  await popup.evaluate(()=>document.fonts.ready);
  await popup.screenshot({path:path.join(root,'test-results/popup.png')});
  await page.evaluate(()=>document.getElementById('login').remove());
  assert.equal((await complete(page,s=>s.scored.score===45)).scored.level,'MEDIUM');
  await popup.getByText('Risk indicators detected',{exact:true}).waitFor();
  await page.evaluate(()=>document.querySelector('iframe').remove());
  await complete(page,s=>s.frameCount===1);
  await popup.close();await page.close();
});

test('malicious child frames are attributed and their removal lowers the parent score',async()=>{
  route('https://paypa1.com/child',html(form));
  const page=await open('https://neutral.example.org/', '<iframe src="https://paypa1.com/child"></iframe>');
  const result=await complete(page,s=>s.scored.score===60);
  assert.ok(result.scored.signals.some(s=>s.frameId>0 && s.frameHost==='paypa1.com'));
  assert.equal(await page.frames()[1].locator('[data-blackfish-ui]').count(),0);
  await page.evaluate(()=>document.querySelector('iframe').remove());
  await complete(page,s=>s.scored.score===0);
  await page.close();
});

for (const width of [1440,390]) test('verified Stripe iframe clears false warnings and deceptive frames still warn at '+width+'px',async()=>{
  const verified='https://m.stripe.network/fixture', deceptive='https://m.stripe.network.evil.com/fixture';
  route(verified,html('<p>Embedded payment fixture</p>','Stripe'));
  route(deceptive,html('<p>Deceptive frame fixture</p>'));
  const page=await open('https://dash.cloudflare.com/billing','<iframe hidden src="'+verified+'"></iframe>');
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.setViewportSize({width,height:844});
  const first=await complete(page,s=>s.frameCount===2 && s.scored.score===0);
  assert.equal(first.state,'complete');
  assert.equal(first.scored.signals.some(s=>s.category==='identity'),false);
  assert.equal((await treeText(page)).includes('RISK INDICATORS DETECTED'),false);
  const tabId=await idFor(page), popup=await context.newPage();
  popup.on('pageerror',e=>errors.push(e.message));
  popup.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await popup.addInitScript(({tabId})=>{
    const original=chrome.tabs.query;
    chrome.tabs.query=(q,...args)=>q.active && q.currentWindow ? Promise.resolve([{id:tabId}]) : original(q,...args);
  },{tabId});
  await popup.setViewportSize({width:400,height:600});
  await popup.goto('chrome-extension://'+extensionId+'/popup/popup.html');
  await popup.getByText('No strong phishing indicators detected',{exact:true}).waitFor();
  await page.evaluate(url=>document.querySelector('iframe').src=url,deceptive);
  const suspicious=await complete(page,s=>s.frameCount===2 && s.scored.level==='MEDIUM');
  assert.ok(suspicious.scored.signals.some(s=>s.brand==='stripe.com' && s.frameHost==='m.stripe.network.evil.com' && s.contribution>0));
  await popup.getByText('Risk indicators detected',{exact:true}).waitFor();
  await waitFor(async()=>(await treeText(page)).includes('RISK INDICATORS DETECTED'),'frame warning');
  await page.evaluate(url=>document.querySelector('iframe').src=url,verified);
  await complete(page,s=>s.frameCount===2 && s.scored.score===0);
  await popup.getByText('No strong phishing indicators detected',{exact:true}).waitFor();
  await waitFor(async()=>!(await treeText(page)).includes('RISK INDICATORS DETECTED'),'obsolete warning removal');
  const rescanned=await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'RESCAN_ACTIVE_TAB',tabId}),tabId);
  assert.equal(rescanned.ok,true);assert.equal(rescanned.result.scored.score,0);
  assert.equal((await api.evaluate(()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}))).settings.bf_allowlist.includes('https://dash.cloudflare.com'),false);
  await popup.close();await page.close();
});

test('verified Stripe host still interrupts insecure password submissions',async()=>{
  const page=await open('https://m.stripe.network/guard',form.replace('<form id="login">','<form id="login" action="http://m.stripe.network/collect">'),'Stripe');
  const result=await complete(page);
  assert.equal(result.scored.signals.some(s=>s.category==='identity'),false);
  assert.ok(result.scored.signals.some(s=>s.id==='insecure-credential-form'));
  await page.locator('#submit').click();await dialog(page);
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await cancel(page);await page.close();
});

test('cancel never grants submission approval; same-site phishing needs an explicit one-time override',async()=>{
  const page=await open('https://paypa1.com/guard',form);
  await page.locator('#submit').click();await dialog(page);
  await page.screenshot({path:path.join(root,'test-results/submission-warning.png')});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(root,'test-results/submission-warning-mobile.png')});
  await page.setViewportSize({width:1280,height:720});
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await cancel(page);
  await page.locator('#submit').click();await dialog(page);
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await proceed(page);await waitFor(()=>page.evaluate(()=>window.submissions.length===1),'approved submit');
  assert.deepEqual(await page.evaluate(()=>window.submissions[0]),{submitter:'choice',value:'login',action:'https://paypa1.com/guard'});
  await page.locator('#submit').click();await dialog(page);
  assert.equal(await page.evaluate(()=>window.submissions.length),1);
  await cancel(page);await page.close();
});

test('destination changes invalidate pending approval and validation is preserved',async()=>{
  const page=await open('https://paypa1.com/change',form);
  await page.locator('input').fill('');
  await page.locator('#submit').click();
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  assert.equal((await treeText(page)).includes('Check this credential submission'),false);
  await page.locator('input').fill('fixture-only');
  await page.locator('#submit').click();await dialog(page);
  await page.evaluate(()=>document.querySelector('form').action='https://collector.example.net/');
  await proceed(page);
  await complete(page,s=>s.scored.signals.some(s=>s.id==='cross-origin-credential-form'));
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await page.locator('#submit').click();await dialog(page);await cancel(page);await page.close();
});

test('HTTP passwords are interrupted; cross-site HTTPS SSO alone is not interrupted',async()=>{
  const insecure=await open('http://intranet.example.org/',form);
  await insecure.locator('#submit').click();await dialog(insecure);await cancel(insecure);await insecure.close();
  const sso=await open('https://portal.example.org/',form.replace('<form id="login">','<form id="login" action="https://identity.example.net/login">'));
  await sso.locator('#submit').click();
  await waitFor(()=>sso.evaluate(()=>window.submissions.length===1),'legitimate SSO submission');
  assert.equal((await treeText(sso)).includes('Check this credential submission'),false);
  await sso.close();
});

test('base URLs, external form controls, submitter overrides, and displayed URL paths resolve correctly',async()=>{
  const body='<base href="https://identity.example.net/base/"><form id="login" action="login"></form><input name="password" type="password" form="login" value="fixture-only"><button id="submit" form="login" formaction="https://other.example.net/override">Sign in</button><a href="https://paypal.com/account">https://paypal.com/account</a><script>window.submissions=[];document.addEventListener("submit",e=>{e.preventDefault();window.submissions.push(e.submitter.formAction)});</script>';
  const page=await open('https://portal.example.org/base',body);
  const result=await complete(page);
  assert.ok(result.scored.signals.some(s=>s.id==='cross-origin-credential-form'));
  assert.equal(result.scored.signals.some(s=>s.id==='anchor-text-href-mismatch'),false);
  await page.locator('#submit').click();
  await waitFor(()=>page.evaluate(()=>window.submissions.length===1),'submitter override');
  assert.equal(await page.evaluate(()=>window.submissions[0]),'https://other.example.net/override');
  await page.close();
});

test('trust changes refresh running scans and the guard; invalid brands are surfaced',async()=>{
  const page=await open('https://paypa1.com/trust',form);
  const reply=await api.evaluate(async tabId=>chrome.runtime.sendMessage({type:'TRUST_SITE',tabId}),await idFor(page));
  assert.equal(reply.ok,true);
  await complete(page,s=>s.state==='trusted');
  await page.locator('#submit').click();await waitFor(()=>page.evaluate(()=>window.submissions.length===1),'trusted submission');
  await settings({bf_allowlist:[]});
  await complete(page,s=>s.scored.score===60);
  await page.locator('#submit').click();await dialog(page);await cancel(page);
  const saved=await settings({bf_custom_brands:['[abc.com','acme.example']});
  assert.equal(saved.ok,true);assert.deepEqual(saved.settings.bf_custom_brands,['acme.example']);
  assert.ok(saved.settings.bf_rejected_settings.length>0);
  await settings({bf_custom_brands:[],bf_rejected_settings:[]});
  await page.close();
});

test('SPA changes, back navigation and worker termination retain the current document verdict',async()=>{
  const page=await open('https://paypa1.com/history',form);
  route('https://paypa1.com/login/verify',html(form));
  await page.evaluate(()=>history.pushState({},'', '/login/verify'));
  await complete(page,s=>s.scored.signals.some(s=>s.id==='lure-keywords'));
  const before=await complete(page);
  const cdp=await context.newCDPSession(api);
  await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
  const recovered=await complete(page);
  assert.equal(recovered.documentId,before.documentId);assert.equal(recovered.scored.score,before.scored.score);
  route('https://neutral.example.org/next',html('<p>Next page</p>'));
  await page.goto('https://neutral.example.org/next');await complete(page,s=>s.scored.score===0);
  await page.goBack();await complete(page,s=>s.scored.score>=60);
  await page.close();
});

test('host collision/removal and hostile settings markup cannot crash or inject warning controls',async()=>{
  const page=await open('https://paypa1.com/host','<div id="__blackfish_host__">Page-controlled collision</div>'+form);
  assert.equal(await page.locator('[data-blackfish-ui]').count(),1);
  await page.evaluate(()=>{document.querySelector('[data-blackfish-ui]').remove();document.body.append(document.createElement('p'));});
  await waitFor(()=>page.locator('[data-blackfish-ui]').count().then(n=>n===1),'warning host recreation');
  const reply=await settings({bf_custom_brands:['<img src=x onerror=alert(1)>.com']});
  assert.deepEqual(reply.settings.bf_custom_brands,[]);
  await page.locator('#submit').click();await dialog(page);await cancel(page);
  await page.close();
});

test('open-shadow password and OTP forms are discovered, and attribute mutations remove evidence',async()=>{
  const page=await open('https://paypa1.com/shadow','<section id="widget"></section><script>const root=document.getElementById("widget").attachShadow({mode:"open"});root.innerHTML=' + JSON.stringify(form.replace(/<script>[\s\S]*<\/script>/, '')) + ';</script>');
  await complete(page,s=>s.scored.score===60);
  await page.locator('#widget #submit').click();await dialog(page);await cancel(page);
  await page.evaluate(()=>document.getElementById('widget').shadowRoot.querySelector('input').type='text');
  await complete(page,s=>s.scored.score===45);
  await page.evaluate(()=>document.getElementById('widget').shadowRoot.querySelector('input').autocomplete='one-time-code');
  await complete(page,s=>s.scored.score===60);
  await page.close();
});

test('failed navigation retains the current page verdict and unsupported pages are explicit',async()=>{
  const page=await open('https://paypa1.com/failed-navigation',form);
  const first=await complete(page);
  const tabId=await idFor(page);
  await page.route('https://unreachable.example.org/',r=>r.abort('failed'));
  await page.goto('https://unreachable.example.org/').catch(()=>{});
  // Chromium may keep the old page or commit a browser error page; neither is a safe verdict.
  const result=await waitFor(()=>api.evaluate(async({tabId,oldDoc})=>{
    const s=await chrome.runtime.sendMessage({type:'GET_TAB_STATUS',tabId});
    return s.state==='unsupported'||s.state==='failed'||s.documentId!==oldDoc?s:null;
  },{tabId,oldDoc:first.documentId}),'browser error page commit');
  assert.ok(['unsupported','failed','scanning'].includes(result.state));
  await page.goto('https://paypa1.com/failed-navigation');
  await complete(page,s=>s.scored.score===first.scored.score);
  await page.goto('chrome://version/');
  const id=await api.evaluate(async()=>{
    for(const tab of await chrome.tabs.query({}))try{const f=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});if(f?.url==='chrome://version/')return tab.id;}catch{}
  });
  const unsupported=await api.evaluate(tabId=>chrome.runtime.sendMessage({type:'GET_TAB_STATUS',tabId}),id);
  assert.equal(unsupported.state,'unsupported');await page.close();
});

test('continuous mutations cannot starve scans and large pages disclose partial coverage',async()=>{
  const page=await open('https://paypa1.com/mutation-budget','<div id="container"></div>');
  await page.evaluate(()=>{
    document.getElementById('container').innerHTML='<form><input type="password"></form>';
    window.changeTimer=setInterval(()=>{document.getElementById('container').dataset.tick=String(Math.random());document.getElementById('container').className='c'+Math.random();},30);
  });
  await complete(page,s=>s.scored.score===60);
  await page.evaluate(()=>{
    clearInterval(window.changeTimer);
    const fragment=document.createDocumentFragment();
    for(let i=0;i<6500;i++)fragment.append(document.createElement('div'));
    document.body.append(fragment);
  });
  await complete(page,s=>s.truncated===true);await page.close();
});

test('hidden-field stuffing cannot push a credential outside the guard sample',async()=>{
  const page=await open('https://paypa1.com/field-stuffing',form.replace('<form id="login">','<form id="login">'+'<input type="hidden">'.repeat(200)));
  await page.locator('#submit').click();await dialog(page);
  assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await cancel(page);await page.close();
});

test('concurrent protected-domain edits preserve every addition and removal',async()=>{
  const values=Array.from({length:8},(_,i)=>'organization-'+i+'.example');
  const saved=await api.evaluate(async values=>{
    await Promise.all(values.map(value=>chrome.runtime.sendMessage({type:'ADD_PROTECTED_DOMAIN',value})));
    return chrome.runtime.sendMessage({type:'GET_SETTINGS'});
  },values);
  assert.deepEqual([...saved.settings.bf_custom_brands].sort(),[...values].sort());
  const removed=await api.evaluate(async values=>{
    await Promise.all(values.map(value=>chrome.runtime.sendMessage({type:'REMOVE_PROTECTED_DOMAIN',value})));
    return chrome.runtime.sendMessage({type:'GET_SETTINGS'});
  },values);
  assert.deepEqual(removed.settings.bf_custom_brands,[]);
});
