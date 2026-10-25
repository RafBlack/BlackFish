import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = '<!doctype html><title>Local reload fixture</title><form id="login"><input type="password" value="fixture-only"><button>Submit</button></form><section id="widget"></section><script>window.submissions=[];function capture(event){event.preventDefault();window.submissions.push(event.target.id)}document.addEventListener("submit",capture);const shadow=document.getElementById("widget").attachShadow({mode:"open"});shadow.innerHTML=\'<form id="shadow-login"><input type="password" value="fixture-only"><button>Submit shadow</button></form>\';shadow.addEventListener("submit",capture);</script>';
async function waitFor(check, label, timeout=10000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,60)); }
  throw new Error('Timed out waiting for '+label);
}
async function treeText(context, page) {
  const session=await context.newCDPSession(page);
  try {
    const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function text(node) { return (node.nodeType===3?node.nodeValue:'')+(node.children||[]).map(text).join(' ')+(node.shadowRoots||[]).map(text).join(' '); }
    return text(root);
  } finally { await session.detach(); }
}
async function complete(api) {
  return waitFor(()=>api.evaluate(async()=>{
    for(const tab of await chrome.tabs.query({})) {
      const frame=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0}).catch(()=>null);
      if(frame?.url!=='https://paypa1.com/reload')continue;
      const result=await chrome.runtime.sendMessage({type:'GET_TAB_STATUS',tabId:tab.id});
      if(result.state==='complete' && result.scored.score===60)return result;
    }
    return null;
  }),'fresh document verdict');
}

for(const width of [1440,390]) test('extension reload retires old scans and guards until page refresh at '+width+'px',async()=>{
  const profile=await mkdtemp(path.join(tmpdir(),'blackfish-reload-'));
  const context=await chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,viewport:{width,height:844},
    args:['--disable-extensions-except='+root,'--load-extension='+root]
  });
  const errors=[];
  try {
    await context.route('**/*',route=>/^https?:/.test(route.request().url()) ? route.fulfill({contentType:'text/html',body:fixture}) : route.continue());
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    const manager=await context.newPage();await manager.goto('chrome://extensions/');
    await manager.evaluate(()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));
    await manager.close();
    const api=await context.newPage();await api.goto('chrome-extension://'+extensionId+'/options/options.html');
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
    await page.goto('https://paypa1.com/reload');await complete(api);
    await page.locator('#login button').click();
    await waitFor(async()=>(await treeText(context,page)).includes('Check this credential submission'),'pending guard dialog');
    assert.deepEqual(await page.evaluate(()=>window.submissions),[]);
    await worker.evaluate(()=>{
      const original=chrome.webNavigation.getAllFrames.bind(chrome.webNavigation);
      chrome.webNavigation.getAllFrames=async(...args)=>{
        globalThis.pendingFixtureScan=true;
        await new Promise(()=>{});
        return original(...args);
      };
    });
    await page.evaluate(()=>document.body.append(document.createElement('p')));
    await waitFor(()=>worker.evaluate(()=>globalThis.pendingFixtureScan),'pending scan report');
    await worker.evaluate(()=>chrome.runtime.reload()).catch(error=>{
      if(!/closed|destroyed|Target/.test(error.message))throw error;
    });
    const freshApi=await context.newPage();
    await waitFor(async()=>{
      try {
        await freshApi.goto('chrome-extension://'+extensionId+'/options/options.html');
        return await freshApi.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_SETTINGS'})).ok);
      } catch (error) {
        if(!/ERR_BLOCKED_BY_CLIENT|context|closed|destroyed/i.test(error.message))throw error;
        return false;
      }
    },'replacement extension worker');
    await page.evaluate(()=>document.body.append(document.createElement('p')));
    await waitFor(()=>page.locator('[data-blackfish-ui]').count().then(count=>count===0),'retired warning UI');
    assert.deepEqual(await page.evaluate(()=>window.submissions),[],'pending approval never replays after reload');
    await page.locator('#login button').click();
    await page.locator('#widget #shadow-login button').click();
    await waitFor(()=>page.evaluate(()=>window.submissions.length===2),'normal submissions after guard cleanup');
    assert.deepEqual(await page.evaluate(()=>window.submissions),['login','shadow-login']);
    await page.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      document.dispatchEvent(new Event('visibilitychange'));
      document.body.append(document.createElement('p'));
    });
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('[data-blackfish-ui]').count(),0);
    assert.deepEqual(errors,[],'retired content scripts produce no warnings or errors');
    await page.reload();await complete(freshApi);
    await page.locator('#login button').click();
    await waitFor(async()=>(await treeText(context,page)).includes('Check this credential submission'),'guard restored after page refresh');
    assert.deepEqual(await page.evaluate(()=>window.submissions),[]);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);
    const diagnostics=await context.newPage();await diagnostics.goto('chrome://extensions/');
    assert.deepEqual(await diagnostics.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.find(item=>item.id===id).runtimeErrors.map(error=>error.message)))),extensionId),[],'Chrome records no extension errors after reload');
    await diagnostics.close();
  } finally { await context.close(); }
});
