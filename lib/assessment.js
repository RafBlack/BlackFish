export const STRONG_IDENTITY_RULES = Object.freeze(['homograph-domain', 'typosquat-domain', 'brand-in-subdomain']);
export function credentialPolicy(signals = []) {
  const ids = new Set(signals.map(s => s.id));
  const credential = ids.has('credential-presence');
  return {
    insecure: credential && ids.has('insecure-credential-form'),
    impersonation: credential && STRONG_IDENTITY_RULES.some(id => ids.has(id))
  };
}
export function confirmedThreat(reputation = {}, now = Date.now()) {
  return reputation.status === 'confirmed' && reputation.expiresAt > now && reputation.freshUntil > now;
}
export function assessEvidence({ scored = { signals: [] }, state = 'complete', reputation } = {}) {
  const result = (kind, severity, title, action, frameIds = []) => ({ kind, severity, title, action, frameIds, alert: severity === 'danger' || severity === 'warning' });
  if (state === 'trusted') return result('trusted', 'neutral', 'Trusted site: protection paused', 'Remove trust in Settings to resume checks.');
  if (confirmedThreat(reputation)) return result('confirmed', 'danger', 'Previously confirmed phishing', 'Avoid entering credentials. Review the address and leave this page.');
  const frames = new Map();
  for (const s of scored.signals) {
    const id = s.frameId ?? 0;
    if (!frames.has(id)) frames.set(id, []);
    frames.get(id).push(s);
  }
  const matching = predicate => [...frames].filter(([, signals]) => predicate(signals)).map(([id]) => id);
  const insecure = matching(signals => credentialPolicy(signals).insecure);
  if (insecure.length) return result('transport', 'danger', 'Insecure credential collection detected', 'Do not send passwords or sign-in codes here. Supported form submissions are paused for review.', insecure);
  const impersonation = matching(signals => credentialPolicy(signals).impersonation);
  if (impersonation.length) return result('impersonation', 'danger', 'Impersonation indicators with credential collection', 'Verify the sign-in address through a known source. Supported submissions on the affected document are paused for review.', impersonation);
  const identity = matching(signals => signals.some(s => STRONG_IDENTITY_RULES.includes(s.id) || s.id === 'brand-name-domain-mismatch'));
  if (identity.length) return result('identity', 'warning', 'Domain or branding mismatch detected', 'Check the address through a known source before signing in. A brand claim alone does not prove phishing.', identity);
  if (state !== 'complete') return result(state, 'neutral', ({ failed: 'Scan failed', unsupported: 'Page cannot be scanned', scanning: 'Scanning...' })[state] || 'Waiting for scan', 'Protection has incomplete evidence. No safety verdict is available.');
  const destination = matching(signals => signals.some(s => s.id === 'cross-origin-credential-form'));
  if (destination.length) return result('destination', 'info', 'Credentials go to another site', 'Check the destination before submitting. This can be normal for single sign-on; it does not establish phishing.', destination);
  const links = matching(signals => signals.some(s => s.id === 'anchor-text-href-mismatch'));
  if (links.length) return result('link', 'info', 'A link label differs from its destination', 'Check that link before opening it. This finding does not assess every link on the page.', links);
  return result('none', 'neutral', 'No strong phishing indicators detected', 'Stay alert. These checks cannot establish that a page or its links are safe.');
}
