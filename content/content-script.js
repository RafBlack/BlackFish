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
let trailing, maximum, stopped = false, loadPromise;
const send = msg => chrome.runtime.sendMessage(msg);
const effectiveUrl = () => /^https?:/.test(location.href) ? location.href : document.baseURI;
const origin = () => { try { return new URL(effectiveUrl()).origin; } catch { return 'null'; } };
const overlay = isTop ? createOverlay(document, async () => {
  const reply = await send({ type: 'TRUST_SITE' });
  if (!reply?.ok) throw new Error(reply?.error || 'Trust update failed.');
  await refreshConfig(); await runScan();
}) : null;
function getContext() { return { loaded, trusted, brands, parentIdentity }; }
async function refreshConfig() {
  const request = ++configRequest;
  const response = await send({ type: 'GET_SCAN_CONFIG' });
  if (request !== configRequest) return;
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
    const response = await send({ type: 'GUARD_REQUEST', configToken, fingerprint: risk.fingerprint, signals: risk.scored.signals, reason: risk.reason });
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
  if (result.documentId !== ownDocumentId || result.version < lastVersion) return;
  lastVersion = result.version;
  parentIdentity = result.scored.signals.filter(s => s.category === 'identity' && s.frameId === 0);
  overlay?.render(result.scored, result.state, result.reputation);
}
async function runScan() {
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
    console.warn('BlackFish scan failed:', error.message);
    try { await report('failed'); } catch {}
    return { ok: false, error: error.message };
  }
}
function schedule() {
  if (stopped) return;
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
    attributeFilter: ['action','method','target','enctype','formaction','formmethod','formtarget','formenctype','form','type','autocomplete','disabled','href','src','style','class','hidden','content'] });
}
observe(document);
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'RESCAN_REQUEST') { runScan().then(respond); return true; }
  if (msg.type === 'SETTINGS_CHANGED') {
    generation++; loaded = false; trusted = false; overlay?.clear(); loadPromise = null;
    ready().then(runScan).then(respond).catch(e => respond({ ok: false, error: e.message })); return true;
  }
  if (msg.type === 'VERDICT_UPDATE') {
    if (isTop) renderResult(msg.result);
    else parentIdentity = msg.result.scored.signals.filter(s => s.category === 'identity' && s.frameId === 0);
  }
  if (msg.type === 'GUARD_PROMPT' && isTop) {
    if (msg.documentId !== ownDocumentId || trusted) { respond({ approved: false }); return; }
    overlay.prompt({ key: msg.requestId, scored: msg.scored, reason: msg.reason, frameHost: msg.frameHost }).then(approved => respond({ approved }));
    return true;
  }
});
document.addEventListener('DOMContentLoaded', () => void runScan(), { once: true });
window.addEventListener('pageshow', event => { stopped = false; if (event.persisted) { loadPromise = null; void runScan(); } });
window.addEventListener('pagehide', () => { stopped = true; generation++; overlay?.clear(); clearTimeout(trailing); clearTimeout(maximum); trailing = maximum = null; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
// Discover roots attached to an existing host (attachShadow itself emits no DOM mutation).
setInterval(() => { if (!document.hidden && !trusted) schedule(); }, 15000);
void runScan();
