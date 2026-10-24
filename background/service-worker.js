import { DocumentState } from '../lib/document-state.js';
import { AiAssist } from '../lib/ai-assist.js';
import { bfIsBorderline, evidenceFingerprint, bfAggregateScore } from '../lib/heuristics/score.js';
import { domainInfo, normalizeDomain } from '../lib/heuristics/domain.js';
import { sanitizeSettings, publicSettings, normalizeOrigin, SerialQueue } from '../lib/settings.js';

const writes = new SerialQueue();
const stateQueue = new SerialQueue();
let settings, state, ai;
const ready = initialize();
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [raw, session] = await Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(['bf_runtime', 'bf_ai_budget', 'bf_ai_cache'])]);
  settings = sanitizeSettings(raw, { migrate: true });
  state = new DocumentState(session.bf_runtime);
  await chrome.storage.local.set(settings);
  ai = new AiAssist({
    permission: origin => chrome.permissions.contains({ origins: [origin] }),
    budget: session.bf_ai_budget || { start: Date.now(), count: 0 },
    saveBudget: budget => chrome.storage.session.set({ bf_ai_budget: budget }),
    documents: session.bf_ai_cache || {},
    saveCache: cache => chrome.storage.session.set({ bf_ai_cache: cache }),
    onResult: (tabId, docId, fingerprint, result) => {
      stateQueue.run(async () => {
        const tab = state.tabs.get(tabId);
        const current = state.result(tabId, settings.bf_allowlist);
        if (!tab || tab.documentId !== docId || current.state === 'trusted' || evidenceFingerprint(current.scored) !== fingerprint || !settings.bf_ai_enabled) return;
        tab.ai = result;
        await publish(tabId);
      }).catch(console.error);
    }
  });
  // Retain only documents still active in this browser session.
  for (const [tabId, tab] of state.tabs) {
    try { const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }); if (top?.documentId !== tab.documentId) state.tabs.delete(tabId); }
    catch { state.tabs.delete(tabId); }
  }
  await persist();
}
function configToken() { return JSON.stringify(publicSettings(settings)); }
function extensionPage(sender) { return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')); }
function webPage(url) { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } }
async function persist() { await chrome.storage.session.set({ bf_runtime: state.serialize() }); }
async function sendDocument(tabId, documentId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg, { documentId }); } catch { return null; }
}
async function publish(tabId) {
  const tab = state.tabs.get(tabId);
  if (tab) tab.version = (tab.version || 0) + 1;
  const result = state.result(tabId, settings.bf_allowlist);
  if (!result) return;
  await persist();
  const text = result.state === 'failed' ? '?' : result.state === 'trusted' || result.scored.level === 'LOW' ? '' : String(result.scored.score);
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: result.scored.level === 'HIGH' ? '#b3261e' : '#a66a00' });
    await chrome.action.setTitle({ tabId, title: 'BlackFish: ' + (result.state === 'trusted' ? 'trusted site' : result.state + ', risk indicator ' + result.scored.score) });
  } catch {}
  // Do not await a content scan inside the state queue: it reports back through that queue.
  for (const frame of Object.values(tab.frames)) void sendDocument(tabId, frame.documentId, { type: 'VERDICT_UPDATE', result });
  chrome.runtime.sendMessage({ type: 'TAB_STATUS_UPDATED', tabId, result }).catch(() => {});
}
async function pruneFrames(tabId, top) {
  const tab = state.ensure(tabId, top);
  const current = await chrome.webNavigation.getAllFrames({ tabId });
  if (!current) return;
  const ids = new Map(current.map(f => [f.frameId, f.documentId]));
  for (const [id, frame] of Object.entries(tab.frames)) if (ids.get(Number(id)) !== frame.documentId) delete tab.frames[id];
}
async function reconcile(tabId) {
  const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!top || !webPage(top.url)) {
    state.tabs.delete(tabId); ai.forget(tabId); await persist();
    try { await chrome.action.setBadgeText({ tabId, text: '' }); } catch {}
    return null;
  }
  const previous = state.tabs.get(tabId)?.documentId;
  await pruneFrames(tabId, top);
  state.tabs.get(tabId).failed = top.errorOccurred === true;
  if (previous !== top.documentId) ai.forget(tabId);
  return top;
}
async function scanMessage(msg, sender) {
  return stateQueue.run(async () => {
    const tabId = sender.tab.id;
    const top = await reconcile(tabId);
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId });
    if (!top || !frame || frame.documentId !== sender.documentId || (frame.documentLifecycle && frame.documentLifecycle !== 'active')) return { ok: false, stale: true };
    const latestTop = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (latestTop?.documentId !== top.documentId || sender.frameId === 0 && frame.documentId !== top.documentId) return { ok: false, stale: true };
    if (msg.configToken !== configToken()) return { ok: false, refreshSettings: true };
    const trusted = settings.bf_allowlist.includes(new URL(frame.url).origin) || settings.bf_allowlist.includes(new URL(top.url).origin);
    if (!webPage(frame.url)) {
      if (!webPage(sender.origin)) return { ok: false, unsupported: true };
      frame.url = sender.origin;
    }
    if (!state.accept(tabId, top, { ...frame, frameId: sender.frameId }, { ...msg, trusted, signals: trusted ? [] : msg.signals })) {
      if (state.tabs.get(tabId)?.frameLimitReached) await publish(tabId);
      return { ok: false, stale: true };
    }
    const result = state.result(tabId, settings.bf_allowlist);
    const tab = state.tabs.get(tabId);
    const fingerprint = evidenceFingerprint(result.scored);
    if (tab.aiFingerprint !== fingerprint) { tab.ai = { status: settings.bf_ai_enabled ? 'idle' : 'off' }; tab.aiFingerprint = fingerprint; }
    if (result.state !== 'trusted' && result.state === 'complete' && bfIsBorderline(result.scored.score)) {
      void ai.consider({ tabId, documentId: top.documentId, fingerprint, settings: { ...settings },
        context: { hostname: new URL(top.url).hostname, signalIds: result.scored.signals.map(s => s.id).sort(), hasCredentials: result.scored.signals.some(s => s.id === 'credential-presence') }
      });
    } else { ai.cancel(tabId); tab.ai = { status: settings.bf_ai_enabled ? 'not-needed' : 'off' }; }
    await publish(tabId);
    return { ok: true, result: state.result(tabId, settings.bf_allowlist) };
  });
}
async function activeTab(msg) {
  if (Number.isInteger(msg.tabId)) return msg.tabId;
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}
async function rescan(tabId) {
  if (tabId == null) return { ok: false, error: 'No active tab.' };
  await stateQueue.run(() => reconcile(tabId));
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length) return { ok: false, error: 'This page cannot be scanned.' };
  const replies = await Promise.all(frames.filter(f => webPage(f.url) || f.url === 'about:blank' || f.url === 'about:srcdoc').map(f => sendDocument(tabId, f.documentId, { type: 'RESCAN_REQUEST' })));
  return { ok: replies.some(r => r?.ok), result: state.result(tabId, settings.bf_allowlist), error: replies.some(r => r?.ok) ? undefined : 'Reload this page to activate BlackFish.' };
}
async function updateSettings(patch) {
  return writes.run(async () => {
    const edits = typeof patch === 'function' ? patch(settings) : patch;
    const next = sanitizeSettings({ ...settings, ...edits });
    return applySettings(next);
  });
}
// Called only while holding the settings queue, including storage notifications.
async function applySettings(next) {
    settings = next;
    await chrome.storage.local.set(next);
    for (const tabId of state.tabs.keys()) { ai.forget(tabId); }
    // Listens in every frame, including trusted documents, and reloads only public configuration.
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' }).catch(() => {});
    }).catch(() => {});
    await stateQueue.run(async () => {
      for (const [tabId, tab] of state.tabs) {
        tab.ai = { status: next.bf_ai_enabled ? 'idle' : 'off' };
        // Invalidate the old settings' evidence until fresh snapshots arrive.
        tab.frames = {};
        await publish(tabId);
      }
    });
    return next;
}
async function handle(msg, sender) {
  await ready;
  if (!msg || typeof msg.type !== 'string') return;
  const ui = extensionPage(sender);
  if (msg.type === 'GET_SCAN_CONFIG' && sender.tab && sender.documentId) {
    const top = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: 0 });
    return { ok: true, documentId: sender.documentId, settings: publicSettings(settings), configToken: configToken(), topTrusted: top && settings.bf_allowlist.includes(new URL(top.url).origin) };
  }
  if (msg.type === 'SCAN_RESULT' && sender.tab && sender.documentId) return scanMessage(msg, sender);
  if (msg.type === 'GUARD_REQUEST' && sender.tab && sender.documentId) {
    const tabId = sender.tab.id;
    const [top, frame] = await Promise.all([
      chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
      chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId })
    ]);
    if (!top || !frame || frame.documentId !== sender.documentId || msg.configToken !== configToken() || settings.bf_allowlist.includes(new URL(top.url).origin) || settings.bf_allowlist.includes(new URL(frame.url).origin)) return { approved: false };
    const reply = await sendDocument(tabId, top.documentId, {
      type: 'GUARD_PROMPT', documentId: top.documentId, requestId: crypto.randomUUID(),
      scored: bfAggregateScore([msg.signals || []]), frameHost: new URL(frame.url).hostname,
      reason: typeof msg.reason === 'string' ? msg.reason.slice(0, 300) : 'Check this credential submission.'
    });
    const [currentTop, currentFrame] = await Promise.all([
      chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
      chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId })
    ]);
    return { approved: reply?.approved === true && currentTop?.documentId === top.documentId && currentFrame?.documentId === sender.documentId && msg.configToken === configToken() };
  }
  if (msg.type === 'TRUST_SITE') {
    let origin;
    if (ui) {
      const tabId = await activeTab(msg), top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      origin = top && normalizeOrigin(new URL(top.url).origin);
    } else if (sender.tab && sender.frameId === 0) origin = normalizeOrigin(new URL(sender.url).origin);
    if (!origin) throw new Error('Cannot trust this page.');
    await updateSettings(current => ({ bf_allowlist: [...current.bf_allowlist, origin] }));
    return { ok: true };
  }
  if (!ui) return;
  if (msg.type === 'GET_SETTINGS') return { ok: true, settings };
  if (['ADD_PROTECTED_DOMAIN', 'REMOVE_PROTECTED_DOMAIN', 'REMOVE_TRUST'].includes(msg.type)) {
    const value = msg.type === 'REMOVE_TRUST' ? normalizeOrigin(msg.value) : normalizeDomain(msg.value);
    if (!value) throw new Error('Enter a valid domain or origin.');
    const key = msg.type === 'REMOVE_TRUST' ? 'bf_allowlist' : 'bf_custom_brands';
    const updated = await updateSettings(current => ({
      [key]: msg.type === 'ADD_PROTECTED_DOMAIN' ? [...new Set([...current[key], value])] : current[key].filter(v => v !== value)
    }));
    return { ok: true, settings: updated };
  }
  if (msg.type === 'SAVE_SETTINGS') {
    const p = msg.settings || {};
    const allowed = Object.fromEntries(Object.keys(sanitizeSettings()).filter(k => k !== 'bf_settings_version').filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]]));
    return { ok: true, settings: await updateSettings(allowed) };
  }
  if (msg.type === 'GET_TAB_STATUS') {
    const tabId = await activeTab(msg);
    if (tabId == null) return { state: 'unsupported' };
    const top = await stateQueue.run(() => reconcile(tabId));
    if (!top) return { tabId, state: 'unsupported' };
    const result = state.result(tabId, settings.bf_allowlist);
    if (!state.tabs.get(tabId).frames[0]) void rescan(tabId);
    return result;
  }
  if (msg.type === 'RESCAN_ACTIVE_TAB') return rescan(await activeTab(msg));
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'TAB_STATUS_UPDATED' || msg?.type === 'VERDICT_UPDATE') return;
  handle(msg, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.webNavigation.onCommitted.addListener(details => {
  ready.then(() => stateQueue.run(async () => {
    if (details.frameId !== 0) {
      state.removeFrame(details.tabId, details.frameId, details.documentId);
      await publish(details.tabId); return;
    }
    const previous = state.tabs.get(details.tabId);
    const previousSite = previous?.origin && domainInfo(new URL(previous.origin).hostname).domain;
    const top = await reconcile(details.tabId);
    if (!top || top.documentId !== details.documentId) return;
    const tab = state.tabs.get(details.tabId);
    const site = domainInfo(new URL(top.url).hostname).domain;
    tab.navigation = (details.transitionQualifiers || []).some(q => q.includes('redirect')) && previousSite && previousSite !== site
      ? ['Browser reported a redirected navigation between sites. Intermediate HTTP hops are not available.'] : [];
    await publish(details.tabId);
  })).catch(console.error);
});
function requestRefresh(details) {
  ready.then(async () => {
    await stateQueue.run(() => reconcile(details.tabId));
    if (details.documentId) void sendDocument(details.tabId, details.documentId, { type: 'RESCAN_REQUEST' });
  }).catch(() => {});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(requestRefresh);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(requestRefresh);
chrome.webNavigation.onErrorOccurred.addListener(details => { if (details.frameId === 0) requestRefresh({ ...details, documentId: state?.tabs.get(details.tabId)?.documentId }); });
chrome.webNavigation.onCompleted.addListener(details => { if (details.frameId === 0) ready.then(() => stateQueue.run(async () => { await reconcile(details.tabId); await publish(details.tabId); })).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => {
  ready.then(() => stateQueue.run(async () => { state.tabs.delete(tabId); ai.forget(tabId); await persist(); })).catch(() => {});
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  ready.then(async () => {
    await stateQueue.run(async () => { state.tabs.delete(removed); ai.forget(removed); await reconcile(added); await publish(added); });
    void rescan(added);
  }).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  ready.then(() => writes.run(async () => {
    const raw = await chrome.storage.local.get(null);
    const next = sanitizeSettings(raw);
    if (JSON.stringify(next) !== JSON.stringify(settings)) await applySettings(next);
  })).catch(console.error);
});
