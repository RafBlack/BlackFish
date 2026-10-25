import { DocumentState } from '../lib/document-state.js';
import { AiAssist } from '../lib/ai-assist.js';
import { bfIsBorderline, evidenceFingerprint, bfAggregateScore } from '../lib/heuristics/score.js';
import { domainInfo, normalizeDomain } from '../lib/heuristics/domain.js';
import { sanitizeSettings, publicSettings, normalizeOrigin, SerialQueue, endpointInfo, DEFAULTS } from '../lib/settings.js';
import { PersistentCache } from '../lib/persistent-cache.js';
import { CloudClient } from '../lib/cloud-client.js';
import { canonicalUrl, digest, FRESHNESS, RULES_VERSION } from '../lib/cloud-contract.js';

const writes = new SerialQueue();
const stateQueue = new SerialQueue();
let settings, state, ai, cache, cloud;
let cloudGeneration = 0;
let nextExpiry = 0;
const lookups = new Map(), managed = new Map(), reportPreviews = new Map();
const ready = initialize();
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [raw, session] = await Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(['bf_runtime', 'bf_ai_budget', 'bf_ai_cache'])]);
  settings = sanitizeSettings(raw, { migrate: true });
  state = new DocumentState(session.bf_runtime);
  cache = new PersistentCache({ entries: raw.bf_persistent_cache, save: entries => chrome.storage.local.set({ bf_persistent_cache: entries }) });
  cloud = new CloudClient({ cache, permission: origin => chrome.permissions.contains({ origins: [origin] }) });
  await chrome.storage.local.set(settings);
  ai = new AiAssist({
    cache,
    permission: origin => chrome.permissions.contains({ origins: [origin] }),
    budget: session.bf_ai_budget || { start: Date.now(), count: 0 },
    saveBudget: budget => chrome.storage.session.set({ bf_ai_budget: budget }),
    documents: session.bf_ai_cache || {},
    saveCache: cache => chrome.storage.session.set({ bf_ai_cache: cache }),
    onResult: (tabId, docId, fingerprint, result) => {
      stateQueue.run(async () => {
        const tab = state.tabs.get(tabId);
        const current = state.result(tabId, settings.bf_allowlist);
        if (!tab || tab.documentId !== docId || current.state !== 'complete' || current.reputation.status === 'confirmed' || await aiFingerprint(current) !== fingerprint || !settings.bf_ai_enabled || settings.bf_managed_ai) return;
        tab.ai = result;
        await publish(tabId);
      }).catch(console.error);
    }
  });
  // Retain only documents still active in this browser session.
  for (const [tabId, tab] of state.tabs) {
    if (tab.rulesVersion !== RULES_VERSION) { tab.ai = { status: 'off' }; delete tab.aiFingerprint; tab.cloudFingerprints = []; tab.rulesVersion = RULES_VERSION; }
    try { const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }); if (top?.documentId !== tab.documentId) state.tabs.delete(tabId); }
    catch { state.tabs.delete(tabId); }
  }
  await persist();
  for (const tabId of state.tabs.keys()) await publish(tabId);
}
function configToken() { return JSON.stringify(publicSettings(settings)); }
function extensionPage(sender) { return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')); }
function webPage(url) { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } }
function topEvidence(result) { return bfAggregateScore([result.scored.signals.filter(s => s.frameId === 0)]); }
function aiFingerprint(result) { return digest(RULES_VERSION + '|' + evidenceFingerprint(topEvidence(result))); }
function features(top, result) { const scored = topEvidence(result); return { hostname: new URL(top.url).hostname, signalIds: scored.signals.map(s => s.id).sort(), hasCredentials: scored.signals.some(s => s.id === 'credential-presence') }; }
async function eligible(tabId, top) {
  if (!canonicalUrl(top.url) || settings.bf_allowlist.includes(new URL(top.url).origin)) return false;
  return !(await chrome.tabs.get(tabId)).incognito;
}
function resetCloud() { cloudGeneration++; cloud.cancel(); lookups.clear(); managed.clear(); reportPreviews.clear(); }
function scheduleExpiry() {
  const deadlines = [...state.tabs.values()].filter(tab => tab.reputation?.status === 'confirmed' && tab.reputation.freshUntil > Date.now()).map(tab => tab.reputation.freshUntil);
  const next = deadlines.length ? Math.min(...deadlines) : 0;
  if (next === nextExpiry) return;
  nextExpiry = next;
  if (next) void chrome.alarms.create('bf-reputation-expiry', { when: next });
  else void chrome.alarms.clear('bf-reputation-expiry');
}
function startLookup(tabId, top) {
  if (!settings.bf_cloud_lookup) return;
  const generation = cloudGeneration, configuration = settings;
  void (async () => {
    if (!await eligible(tabId, top) || generation !== cloudGeneration) return;
    const target = canonicalUrl(top.url), urlHash = await digest(target.url);
    if (generation !== cloudGeneration) return;
    const key = top.documentId + ':' + urlHash;
    const last = lookups.get(tabId);
    if (last?.key === key && last.until > Date.now()) return;
    lookups.set(tabId, { key, until: Date.now() + 60000 });
    const result = await cloud.lookup(top.url, configuration);
    await stateQueue.run(async () => {
      const current = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      const tab = state.tabs.get(tabId);
      if (generation !== cloudGeneration || !tab || current?.documentId !== top.documentId || canonicalUrl(current.url)?.url !== target.url || settings.bf_allowlist.includes(target.origin)) return;
      const freshUntil = result.status === 'confirmed' ? Math.min(result.expiresAt, result.freshUntil, Date.now() + FRESHNESS) : Date.now() + 60000;
      tab.reputation = { ...result, freshUntil };
      lookups.set(tabId, { key, until: freshUntil });
      if (result.status === 'confirmed') { ai.cancel(tabId); if (!managed.get(tabId)?.pending) managed.delete(tabId); tab.ai = { status: 'not-needed' }; }
      await publish(tabId);
    });
  })().catch(() => {});
}
function startManaged(tabId, top, result, fingerprint) {
  const generation = cloudGeneration, configuration = settings;
  const old = managed.get(tabId);
  const tab = state.tabs.get(tabId);
  if (!canonicalUrl(top.url) || settings.bf_allowlist.includes(new URL(top.url).origin)) { tab.ai = { status: 'off' }; return; }
  if (old?.pending) { tab.ai = { status: 'pending' }; return; }
  if (old?.documentId === top.documentId && old.fingerprint === fingerprint && old.until > Date.now() && old.result) { tab.ai = old.result; return; }
  tab.cloudFingerprints ||= [];
  if (!tab.cloudFingerprints.includes(fingerprint)) {
    if (tab.cloudFingerprints.length >= 8) { tab.ai = { status: 'limited' }; return; }
    tab.cloudFingerprints.push(fingerprint);
  }
  const request = { documentId: top.documentId, fingerprint, pending: true }; managed.set(tabId, request); tab.ai = { status: 'pending' };
  void (async () => {
    if (!await eligible(tabId, top) || generation !== cloudGeneration) return;
    const advice = await cloud.triage(features(top, result), configuration);
    request.pending = false; request.result = advice; request.until = Math.min(Date.now() + FRESHNESS, advice.policyFreshUntil || Date.now() + 60000);
    await stateQueue.run(async () => {
      const currentTop = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      const tab = state.tabs.get(tabId), current = state.result(tabId, settings.bf_allowlist);
      if (generation !== cloudGeneration || managed.get(tabId) !== request || !tab || !currentTop || tab.documentId !== currentTop.documentId || current.state !== 'complete' || current.reputation?.status === 'confirmed') return;
      const latest = await aiFingerprint(current);
      if (latest !== fingerprint || currentTop.url !== top.url || currentTop.documentId !== top.documentId) {
        if (bfIsBorderline(topEvidence(current).score)) startManaged(tabId, currentTop, current, latest);
        await publish(tabId); return;
      }
      tab.ai = advice; await publish(tabId);
    });
  })().catch(() => {}).finally(() => { request.pending = false; });
}
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
  scheduleExpiry();
  const assessment = result.assessment;
  const text = assessment.alert ? '!' : result.state === 'failed' ? '?' : '';
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: assessment.severity === 'danger' ? '#b3261e' : '#a66a00' });
    await chrome.action.setTitle({ tabId, title: 'BlackFish: ' + assessment.title + '. ' + result.state + (result.truncated ? ', partial coverage' : '') });
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
  if (previous !== top.documentId) { ai.forget(tabId); if (!managed.get(tabId)?.pending) managed.delete(tabId); lookups.delete(tabId); }
  const tab = state.tabs.get(tabId);
  const targetHash = canonicalUrl(top.url) && await digest(canonicalUrl(top.url).url);
  if (tab.reputationUrlHash !== targetHash) { tab.reputation = { status: 'off' }; tab.reputationUrlHash = targetHash; lookups.delete(tabId); if (!managed.get(tabId)?.pending) managed.delete(tabId); }
  startLookup(tabId, top);
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
    const fingerprint = await aiFingerprint(result);
    tab.rulesVersion = RULES_VERSION;
    const aiEnabled = settings.bf_ai_enabled || settings.bf_managed_ai;
    if (tab.aiFingerprint !== fingerprint) { tab.ai = { status: aiEnabled ? 'idle' : 'off' }; tab.aiFingerprint = fingerprint; }
    const browserTab = await chrome.tabs.get(tabId);
    if (!browserTab.incognito && result.state === 'complete' && result.reputation.status !== 'confirmed' && bfIsBorderline(topEvidence(result).score)) {
      if (settings.bf_managed_ai) startManaged(tabId, top, result, fingerprint);
      else if (endpointInfo(settings.bf_ai_endpoint)?.local || canonicalUrl(top.url)) void ai.consider({ tabId, documentId: top.documentId, fingerprint, settings: { ...settings }, context: features(top, result) });
    } else { ai.cancel(tabId); tab.ai = { status: managed.get(tabId)?.pending ? 'pending' : aiEnabled ? 'not-needed' : 'off' }; }
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
  if (managed.get(tabId) && !managed.get(tabId).pending) managed.get(tabId).until = 0;
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
    const changedSecrets = ['bf_ai_key','bf_ai_endpoint','bf_ai_model','bf_cloud_origin','bf_cloud_token'].some(key => settings[key] !== next[key]);
    const changedCloudIdentity = ['bf_cloud_origin','bf_cloud_token'].some(key => settings[key] !== next[key]);
    resetCloud();
    for (const tabId of state.tabs.keys()) ai.forget(tabId);
    settings = next;
    if (changedSecrets || !next.bf_ai_enabled && !next.bf_managed_ai) await cache.clear('advice');
    if (changedCloudIdentity || !next.bf_cloud_lookup) await cache.clear('threat');
    if (changedCloudIdentity) await cache.clear('cooldown');
    await cache.clear('config');
    await chrome.storage.local.set(next);
    // Listens in every frame, including trusted documents, and reloads only public configuration.
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' }).catch(() => {});
    }).catch(() => {});
    await stateQueue.run(async () => {
      for (const [tabId, tab] of state.tabs) {
        tab.ai = { status: next.bf_ai_enabled || next.bf_managed_ai ? 'idle' : 'off' };
        tab.reputation = { status: 'off' };
        tab.cloudFingerprints = [];
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
  if (msg.type === 'GET_CACHE_STATUS') return { ok: true, cache: cache.stats() };
  if (msg.type === 'CLEAR_LOCAL_CACHE') {
    resetCloud(); for (const tabId of state.tabs.keys()) ai.forget(tabId); await cache.clear();
    for (const [tabId, tab] of state.tabs) { ai.forget(tabId); tab.reputation = { status: 'off' }; tab.ai = { status: 'off' }; tab.cloudFingerprints = []; await publish(tabId); }
    return { ok: true, cache: cache.stats() };
  }
  if (msg.type === 'GET_REPORT_PREVIEW') {
    const tabId = await activeTab(msg), top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!settings.bf_cloud_reports || !top || !await eligible(tabId, top)) throw new Error('Reporting is unavailable for this page. Enable reports in Settings.');
    for (const [key, preview] of reportPreviews) if (preview.expiresAt <= Date.now()) reportPreviews.delete(key);
    if (reportPreviews.size >= 25) reportPreviews.delete(reportPreviews.keys().next().value);
    const requestId = crypto.randomUUID(), preview = { requestId, tabId, documentId: top.documentId, url: canonicalUrl(top.url).url, context: features(top, state.result(tabId, settings.bf_allowlist)), expiresAt: Date.now() + 120000 };
    reportPreviews.set(requestId, preview);
    return { ok: true, requestId, url: preview.url };
  }
  if (msg.type === 'SUBMIT_REPORT') {
    const preview = reportPreviews.get(msg.requestId);
    if (!preview || preview.expiresAt <= Date.now() || msg.confirmed !== true || msg.reuseConsent !== true) throw new Error('Review and confirm a fresh report preview.');
    const top = await chrome.webNavigation.getFrame({ tabId: preview.tabId, frameId: 0 });
    if (top?.documentId !== preview.documentId || canonicalUrl(top.url)?.url !== preview.url || !await eligible(preview.tabId, top)) throw new Error('Page changed. Open a new report preview.');
    reportPreviews.delete(msg.requestId);
    const result = await cloud.report({ ...preview, confirmed: true, reuseConsent: true }, settings);
    return { ok: result.status === 'pending', result, error: result.status === 'pending' ? undefined : 'Report was not accepted: ' + result.status };
  }
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
  ready.then(() => stateQueue.run(async () => { state.tabs.delete(tabId); ai.forget(tabId); managed.delete(tabId); lookups.delete(tabId); await persist(); scheduleExpiry(); })).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'bf-reputation-expiry') return;
  ready.then(() => stateQueue.run(async () => {
    nextExpiry = 0;
    for (const [tabId, tab] of state.tabs) if (tab.reputation?.status === 'confirmed' && tab.reputation.freshUntil <= Date.now()) { tab.reputation = { status: 'expired' }; lookups.delete(tabId); await publish(tabId); }
    scheduleExpiry();
  })).catch(() => {});
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  ready.then(async () => {
    await stateQueue.run(async () => { state.tabs.delete(removed); ai.forget(removed); await reconcile(added); await publish(added); });
    void rescan(added);
  }).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(key => Object.hasOwn(DEFAULTS, key))) return;
  ready.then(() => writes.run(async () => {
    const raw = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const next = sanitizeSettings(raw);
    if (JSON.stringify(next) !== JSON.stringify(settings)) await applySettings(next);
  })).catch(console.error);
});
