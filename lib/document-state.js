import { bfAggregateScore, RULES } from './heuristics/score.js';
export function sanitizeSignals(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 64).filter(s => s && RULES[s.id] && typeof s.detail === 'string').map(s => ({ id: s.id, detail: s.detail.slice(0, 400), ...(typeof s.brand === 'string' ? { brand: s.brand.slice(0, 100) } : {}) }));
}
export class DocumentState {
  constructor(saved = {}) { this.tabs = new Map(Object.entries(saved.tabs || {}).map(([id, v]) => [Number(id), v])); }
  ensure(tabId, top) {
    let tab = this.tabs.get(tabId);
    if (!tab || tab.documentId !== top.documentId) {
      tab = { documentId: top.documentId, origin: new URL(top.url).origin, frames: {}, ai: { status: 'off' }, navigation: [], updatedAt: Date.now() };
      this.tabs.set(tabId, tab);
    }
    return tab;
  }
  accept(tabId, top, frame, msg) {
    if (!Number.isSafeInteger(msg.revision) || msg.revision < 1) return false;
    const tab = this.ensure(tabId, top);
    if (frame.frameId !== 0 && !tab.frames[frame.frameId] && Object.keys(tab.frames).length >= 63) { tab.frameLimitReached = true; return false; }
    const old = tab.frames[frame.frameId];
    if (old?.documentId === frame.documentId && old.revision >= msg.revision) return false;
    tab.frames[frame.frameId] = {
      documentId: frame.documentId, frameId: frame.frameId, parentFrameId: frame.parentFrameId ?? -1,
      revision: msg.revision, origin: new URL(frame.url).origin, signals: sanitizeSignals(msg.signals),
      state: ['scanning','complete','failed','trusted'].includes(msg.state) ? msg.state : 'failed',
      truncated: msg.truncated === true, trusted: msg.trusted === true
    };
    tab.updatedAt = Date.now();
    return true;
  }
  removeFrame(tabId, frameId, documentId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const remove = new Set([frameId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of Object.values(tab.frames)) if (remove.has(f.parentFrameId) && !remove.has(f.frameId)) { remove.add(f.frameId); changed = true; }
    }
    for (const id of remove) if (!(id === frameId && tab.frames[id]?.documentId === documentId)) delete tab.frames[id];
  }
  result(tabId, allowlist = []) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    const trusted = allowlist.includes(tab.origin);
    const frames = Object.values(tab.frames);
    const main = tab.frames[0];
    const signals = trusted ? [] : frames.filter(f => !allowlist.includes(f.origin) && !f.trusted).flatMap(f => f.signals.map(s => ({ ...s, frameId: f.frameId, frameHost: new URL(f.origin).hostname })));
    const state = trusted ? 'trusted' : tab.failed || frames.some(f => f.state === 'failed') ? 'failed' : !main ? 'scanning' : frames.some(f => f.state === 'scanning') ? 'scanning' : 'complete';
    return {
      tabId, documentId: tab.documentId, version: tab.version || 0, url: tab.origin, state, scored: bfAggregateScore([signals]),
      truncated: tab.frameLimitReached === true || frames.some(f => f.truncated), frameCount: frames.length,
      ai: trusted ? { status: 'off' } : tab.ai?.status === 'complete' && (tab.ai.expiresAt <= Date.now() || tab.ai.policyFreshUntil <= Date.now()) ? { status: 'expired' } : tab.ai,
      reputation: trusted ? { status: 'off' } : tab.reputation?.freshUntil <= Date.now() ? { status: 'expired' } : tab.reputation || { status: 'off' },
      navigation: tab.navigation, updatedAt: tab.updatedAt
    };
  }
  serialize() { return { tabs: Object.fromEntries(this.tabs) }; }
}
