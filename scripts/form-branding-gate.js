import { BF_RISK_THRESHOLDS } from '../lib/heuristics/score.js';
export function formBrandingGate(rows) {
  const ids = new Set();
  const warnings = result => result.score >= BF_RISK_THRESHOLDS.MEDIUM;
  for (const row of rows) {
    if (!row.id || ids.has(row.id) || !['benign','phishing','transport'].includes(row.label)) throw new Error('Invalid comparison case.');
    ids.add(row.id);
    for (const result of [row.baseline, row.candidate]) {
      if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > 100 || typeof result.interrupted !== 'boolean') throw new Error('Invalid measured comparison.');
    }
  }
  const select = predicate => rows.filter(predicate).map(row => row.id);
  const additionalPhishing = select(row => row.label === 'phishing' && row.suite === 'targeted' && !warnings(row.baseline) && warnings(row.candidate));
  const additionalBenignWarnings = select(row => row.label === 'benign' && !warnings(row.baseline) && warnings(row.candidate));
  const benignInterruptions = select(row => row.label === 'benign' && row.candidate.interrupted);
  const lostPhishing = select(row => row.label === 'phishing' && warnings(row.baseline) && !warnings(row.candidate));
  const lostTransportProtection = select(row => row.label === 'transport' && row.baseline.interrupted && !row.candidate.interrupted);
  const passed = additionalPhishing.length > 0 && additionalBenignWarnings.length === 0 && benignInterruptions.length === 0 && lostPhishing.length === 0 && lostTransportProtection.length === 0;
  return { passed, additionalPhishing, additionalBenignWarnings, benignInterruptions, lostPhishing, lostTransportProtection };
}
