import { canonicalUrl, digest, normalizeFeatures } from '../../lib/cloud-contract.js';
import { domainInfo, normalizeDomain } from '../../lib/heuristics/domain.js';

export function validateExample(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid reviewed example.');
  const features = normalizeFeatures(value.features);
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !['benign','phishing'].includes(value.label) || !['retrieval','tuning','evaluation'].includes(value.split) || typeof value.family !== 'string' || !value.family.trim() || value.family.length > 100 || value.domainGroup !== domainInfo(features.hostname).domain || value.independentlyReviewed !== true || value.synthetic !== false) throw new Error('An independent reviewed example with a domain group and family is required.');
  for (const field of ['reviewer','evidence','explanation']) if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > (field === 'explanation' ? 200 : 300) || /[\u0000-\u001f]/.test(value[field])) throw new Error('Invalid reviewed example ' + field);
  if (/https?:\/\//i.test(value.explanation)) throw new Error('Use minimized features in example explanations, not raw URLs.');
  return { id: value.id, label: value.label, features, explanation: value.explanation, reviewer: value.reviewer, evidence: value.evidence, family: value.family, domainGroup: value.domainGroup, split: value.split, independentlyReviewed: true, synthetic: false };
}
export function exampleFromRow(row) {
  return validateExample({ id: row.id, label: row.label, features: JSON.parse(row.features), explanation: row.explanation, reviewer: row.reviewer, evidence: row.evidence, family: row.family, domainGroup: row.domain_group, split: row.split, independentlyReviewed: true, synthetic: false });
}
export async function threatReview(report, { scope, reviewer, provenance }) {
  if (!report || report.status === 'rejected' || !['url','hostname'].includes(scope) || typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 100 || typeof provenance !== 'string' || !provenance.trim() || provenance.length > 300) throw new Error('Report, explicit scope, reviewer and independent evidence are required.');
  const target = canonicalUrl(report.url);
  if (!target || scope === 'hostname' && normalizeDomain(target.hostname) !== target.hostname) throw new Error('A public suffix cannot be marked as an unsafe hostname.');
  return { hostname: target.hostname, urlHash: scope === 'url' ? await digest(target.url) : null, scope, reviewer, provenance };
}
