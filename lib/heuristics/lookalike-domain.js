import { domainInfo, confusableSkeleton } from './domain.js';
import { BF_BRANDS, approvedFor } from './brand-list.js';
import { signal } from './score.js';
export function bfLevenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length];
}
export function bfCheckLookalikeDomain(registrableDomain, hostname, brands = BF_BRANDS) {
  const target = domainInfo(registrableDomain);
  if (!target.host || target.isIp) return [];
  const found = [];
  for (const brand of brands) {
    if (approvedFor(brand, hostname)) continue;
    for (const approved of brand.approvedDomains) {
      const ref = domainInfo(approved);
      if (ref.unicodeLabel.length < 4 || Math.abs(target.unicodeLabel.length - ref.unicodeLabel.length) > 3) continue;
      const targetSkeleton = confusableSkeleton(target.label), refSkeleton = confusableSkeleton(ref.label);
      if (targetSkeleton === refSkeleton && target.label !== ref.label) {
        found.push(signal('homograph-domain', 'Domain ' + target.domain + ' uses characters confusable with ' + approved + '.', { brand: brand.id }));
      } else if (target.label === ref.label && target.domain !== ref.domain) {
        found.push(signal('typosquat-domain', 'Domain uses the ' + ref.label + ' name under an unapproved suffix (' + target.domain + ').', { brand: brand.id }));
      } else {
        const distance = bfLevenshtein(target.unicodeLabel, ref.unicodeLabel);
        const limit = ref.label.length >= 9 ? 2 : 1;
        if (distance > 0 && distance <= limit && distance / ref.label.length < 0.3) found.push(signal('typosquat-domain', 'Domain ' + target.domain + ' resembles ' + approved + ' (' + distance + ' edit(s)).', { brand: brand.id }));
      }
    }
    const subLabels = domainInfo(hostname).subdomain.split('.');
    if (brand.aliases.some(a => a.length >= 4 && subLabels.includes(a))) found.push(signal('brand-in-subdomain', 'A protected brand name appears before the unrelated domain ' + target.domain + '.', { brand: brand.id }));
  }
  return [...new Map(found.sort((a,b) => a.weight-b.weight).map(s => [s.id, s])).values()];
}
