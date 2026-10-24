export const BF_RISK_THRESHOLDS = Object.freeze({ MEDIUM: 30, HIGH: 55 });
// Only this registry sets weights. Messages cannot invent rules or weights.
export const RULES = Object.freeze({
  'homograph-domain': [45, 'identity'], 'typosquat-domain': [40, 'identity'],
  'brand-in-subdomain': [35, 'identity'], 'brand-name-domain-mismatch': [30, 'identity'],
  'cross-origin-credential-form': [35, 'destination'],
  'insecure-credential-form': [25, 'transport'], 'credential-presence': [15, 'credential'],
  'anchor-text-href-mismatch': [10, 'support'], 'at-symbol-in-url': [15, 'support'],
  'ip-literal-host': [8, 'support'], 'deep-subdomain': [5, 'support'],
  'abused-tld': [4, 'support'], 'excessive-hyphens': [4, 'support'],
  'lure-keywords': [5, 'support'], 'not-https': [6, 'support'],
  'brand-mention': [0, 'context'], 'hidden-cross-origin-iframe': [0, 'context'],
  'many-hidden-fields': [0, 'context'], 'executable-download': [0, 'context'],
  'executable-download-link': [0, 'context']
});
export function signal(id, detail, extra = {}) {
  return { ...extra, id, detail: String(detail).slice(0, 400), weight: RULES[id]?.[0] ?? 0 };
}
export function bfAggregateScore(groups = []) {
  const byId = new Map();
  for (const s of groups.flat().filter(Boolean)) {
    const rule = RULES[s.id];
    if (!rule || typeof s.detail !== 'string') continue;
    const old = byId.get(s.id);
    if (old) { old.occurrences += Math.max(1, Math.min(1000, Number(s.occurrences) || 1)); continue; }
    byId.set(s.id, { ...s, weight: rule[0], category: rule[1], detail: s.detail.slice(0, 400), occurrences: Math.max(1, Math.min(1000, Number(s.occurrences) || 1)), contribution: 0 });
  }
  const signals = [...byId.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const used = new Map();
  let score = 0;
  for (const s of signals) {
    const cap = s.category === 'identity' ? 45 : s.category === 'support' ? 20 : 100;
    s.contribution = s.category === 'identity' ? (used.has('identity') ? 0 : s.weight) : Math.min(s.weight, cap - (used.get(s.category) || 0));
    used.set(s.category, (used.get(s.category) || 0) + s.contribution);
    score += s.contribution;
  }
  score = Math.min(100, score);
  return { score, level: score >= 55 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW', signals, timestamp: Date.now() };
}
export function bfIsBorderline(score) { return score >= 20 && score < 55; }
export function evidenceFingerprint(scored) {
  return scored.signals.map(s => [s.id, s.frameId ?? 0, s.frameHost ?? '', s.detail].join(':')).sort().join('|');
}
export class EvidenceStore {
  constructor() { this.sources = new Map(); }
  replace(source, signals) { this.sources.set(source, signals || []); }
  clear() { this.sources.clear(); }
  score() { return bfAggregateScore([...this.sources.values()]); }
}
