import { brandsWithCustom, BF_BRANDS } from '../lib/heuristics/brand-list.js';
import { bfAnalyzeUrl } from '../lib/heuristics/url-analysis.js';
import { bfCheckLookalikeDomain } from '../lib/heuristics/lookalike-domain.js';
import { EvidenceStore } from '../lib/heuristics/score.js';
import { scanDom, scanAnchors } from './dom-scanner.js';
import { createOverlay } from './overlay.js';
import { installFormGuard } from './form-guard.js';

const isTop = window === window.top;
const evidence = new EvidenceStore();
let config = { bf_allowlist: [], bf_custom_brands: [] }, brands = BF_BRANDS;
let configToken = '', loaded = false, trusted = false, ownDocumentId = '';
let generation = 0, revision = 0, lastVersion = -1, parentIdentity = [];
let configRequest = 0;
let trailing, maximum, discovery, stopped = false, disposed = false, loadPromise;
const lifecycle = new AbortController();
const messageCancelled = error => /message (?:channel|port) closed before a response/i.test(error.message);
async function send(msg) {
  if (!contextActive()) throw new Error('Extension context invalidated.');
  try { return await chrome.runtime.sendMessage(msg); }
  catch (error) {
    if (error.message?.includes('Extension context invalidated')) dispose();
    throw error;
  }
}
function contextActive() {
  if (disposed) return false;
  try { if (chrome.runtime.id) return true; } catch {}
  dispose();
  return false;
}
function dispose() {
  if (disposed) return;
  disposed = true; stopped = true; generation++; configRequest++;
  loaded = false; parentIdentity = []; evidence.clear();
  clearTimeout(trailing); clearTimeout(maximum); clearInterval(discovery);
  lifecycle.abort(); observer.disconnect(); guard.dispose(); overlay?.dispose();
  try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
}
const effectiveUrl = () => /^https?:/.test(location.href) ? location.href : document.baseURI;
const origin = () => { try { return new URL(effectiveUrl()).origin; } catch { return 'null'; } };
const overlay = isTop ? createOverlay(document, async () => {
  const reply = await send({ type: 'TRUST_SITE' });
  if (!reply?.ok) throw new Error(reply?.error || 'Trust update failed.');
  await refreshConfig(); await runScan();
}) : null;
function getContext() { return { active: contextActive(), loaded, trusted, brands, parentIdentity }; }
async function refreshConfig() {
  const request = ++configRequest;
  const response = await send({ type: 'GET_SCAN_CONFIG' });
  if (!contextActive() || request !== configRequest) return;
  if (!response?.ok) throw new Error(response?.error || 'Cannot load detection settings.');
  config = response.settings; configToken = response.configToken;
  ownDocumentId = response.documentId;
  brands = brandsWithCustom(config.bf_custom_brands);
  trusted = response.topTrusted || config.bf_allowlist.includes(origin());
  loaded = true;
  if (trusted) { evidence.clear(); parentIdentity = []; overlay?.clear(); }
}
function ready() {
  if (!loadPromise) loadPromise = refreshConfig().catch(error => { loadPromise = null; throw error; });
  return loadPromise;
}
const guard = installFormGuard({
  doc: document, getContext, ready,
  requestDecision: async risk => {
    const response = await send({ type: 'GUARD_REQUEST', configToken, fingerprint: risk.fingerprint, signals: risk.scored.signals, reason: risk.reason }).catch(error => {
      if (!messageCancelled(error)) throw error;
      overlay?.cancelPrompt();
      return { approved: false };
    });
    return response?.approved === true;
  },
  report: () => runScan()
});
async function report(state, coverage = {}) {
  const scored = evidence.score();
  const response = await send({ type: 'SCAN_RESULT', configToken, revision: ++revision, state, signals: trusted ? [] : scored.signals, truncated: coverage.truncated === true });
  if (response?.refreshSettings) { loadPromise = null; await ready(); schedule(); }
  if (isTop && response?.result) renderResult(response.result);
  return response;
}
function renderResult(result) {
  if (!contextActive() || stopped || result.documentId !== ownDocumentId || result.version < lastVersion) return;
  lastVersion = result.version;
  parentIdentity = result.scored.signals.filter(s => s.category === 'identity' && s.frameId === 0);
  overlay?.render(result.scored, result.state, result.reputation, result.truncated);
}
async function runScan() {
  if (stopped || !contextActive()) return { ok: false, inactive: true };
  const current = ++generation;
  try {
    await ready();
    if (current !== generation || stopped) return { ok: false, stale: true };
    if (trusted) { evidence.clear(); await report('trusted'); return { ok: true }; }
    const url = bfAnalyzeUrl(effectiveUrl());
    evidence.replace('url', url.signals);
    evidence.replace('identity', bfCheckLookalikeDomain(url.registrableDomain, url.hostname, brands));
    evidence.replace('anchors', []);
    const dom = scanDom(document, brands);
    for (const [source, signals] of Object.entries(dom.groups)) evidence.replace(source, signals);
    for (const root of dom.collected.roots) { observe(root); guard.observe(root); }
    await report('scanning', dom.coverage);
    if (current !== generation || stopped) return { ok: false, stale: true };
    const anchors = await scanAnchors(document, dom.collected, brands, () => current !== generation || stopped);
    if (!anchors || current !== generation) return { ok: false, stale: true };
    evidence.replace('anchors', anchors);
    await report('complete', dom.coverage);
    return { ok: true };
  } catch (error) {
    if (stopped || !contextActive()) return { ok: false, inactive: true };
    if (messageCancelled(error)) return { ok: false, cancelled: true };
    console.warn('BlackFish scan failed:', error.message);
    try { await report('failed'); } catch {}
    return { ok: false, error: error.message };
  }
}
function schedule() {
  if (stopped || !contextActive()) return;
  clearTimeout(trailing);
  trailing = setTimeout(flush, 250);
  if (!maximum) maximum = setTimeout(flush, 1000);
}
function flush() { clearTimeout(trailing); clearTimeout(maximum); trailing = maximum = null; void runScan(); }
const observed = new WeakSet();
const observer = new MutationObserver(records => {
  if (records.every(r => overlay?.isOwnNode(r.target) || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].length && [...r.addedNodes, ...r.removedNodes].every(n => overlay?.isOwnNode(n)))) return;
  schedule();
});
function observe(root) {
  if (observed.has(root)) return;
  observed.add(root);
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['action','method','target','enctype','formaction','formmethod','formtarget','formenctype','form','type','autocomplete','disabled','href','src','style','class','hidden','content','aria-label','aria-labelledby','id','alt'] });
}
observe(document);
function onMessage(msg, sender, respond) {
  if (!contextActive() || sender.id !== chrome.runtime.id) return;
  const reply = value => { if (contextActive()) respond(value); };
  if (msg.type === 'RESCAN_REQUEST') { runScan().then(reply); return true; }
  if (msg.type === 'SETTINGS_CHANGED') {
    generation++; loaded = false; trusted = false; overlay?.clear(); loadPromise = null;
    ready().then(runScan).then(reply).catch(e => reply({ ok: false, error: e.message })); return true;
  }
  if (msg.type === 'VERDICT_UPDATE') {
    if (isTop) renderResult(msg.result);
    else parentIdentity = msg.result.scored.signals.filter(s => s.category === 'identity' && s.frameId === 0);
  }
  if (msg.type === 'GUARD_PROMPT' && isTop) {
    if (msg.documentId !== ownDocumentId || trusted) { reply({ approved: false }); return; }
    overlay.prompt({ key: msg.requestId, scored: msg.scored, reason: msg.reason, frameHost: msg.frameHost }).then(approved => reply({ approved }));
    return true;
  }
}
chrome.runtime.onMessage.addListener(onMessage);
document.addEventListener('DOMContentLoaded', () => void runScan(), { once: true, signal: lifecycle.signal });
window.addEventListener('pageshow', event => { if (!contextActive()) return; stopped = false; if (event.persisted) { loadPromise = null; void runScan(); } }, { signal: lifecycle.signal });
window.addEventListener('pagehide', () => { stopped = true; generation++; overlay?.clear(); clearTimeout(trailing); clearTimeout(maximum); trailing = maximum = null; }, { signal: lifecycle.signal });
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); }, { signal: lifecycle.signal });
// Discover roots attached to an existing host (attachShadow itself emits no DOM mutation).
discovery = setInterval(() => { if (!contextActive()) return; if (!document.hidden && !trusted) schedule(); }, 15000);
void runScan();
