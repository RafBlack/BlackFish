import { parse } from 'tldts';
import { toUnicode } from 'punycode/punycode.es6.js';
import { CONFUSABLES } from '../vendor/confusables.js';
export function domainInfo(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const parsed = parse(host, { allowPrivateDomains: true, extractHostname: false });
  return { host, domain: parsed.domain || host, label: parsed.domainWithoutSuffix || host, unicodeLabel: toUnicode(parsed.domainWithoutSuffix || host), suffix: parsed.publicSuffix || '', isIp: !!parsed.isIp, isPrivate: !!parsed.isPrivate, subdomain: parsed.subdomain || '', unicode: toUnicode(host) };
}
export function bfGetRegistrableDomain(host) { return domainInfo(host).domain; }
export function bfIsIPHost(host) { return domainInfo(host).isIp; }
export function normalizeDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || /[\s<>"'\[\]{}\\@?#]/u.test(value)) return null;
  try {
    const url = new URL(value.includes('://') ? value : 'https://' + value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password || !['', '/'].includes(url.pathname)) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const info = domainInfo(host);
    if (info.isIp || !info.suffix || host === info.suffix || host.length > 253 || !host.split('.').every(l => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
    return host;
  } catch { return null; }
}
export function confusableSkeleton(value) {
  return [...toUnicode(value).normalize('NFD')].map(c => CONFUSABLES[c] || c).join('').normalize('NFD').toLowerCase();
}
