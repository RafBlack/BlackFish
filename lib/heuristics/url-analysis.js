import { domainInfo } from './domain.js';
import { BF_LURE_KEYWORDS } from './brand-list.js';
import { signal } from './score.js';
export { bfGetRegistrableDomain, bfIsIPHost } from './domain.js';
const ABUSED = new Set(['tk','ml','ga','cf','gq','xyz','top','work','click','zip','mov','icu','cam','cyou','rest','loan']);
export const BF_EXECUTABLE_EXT = new Set(['exe','scr','bat','cmd','js','jar','msi','com','pif','vbs','hta','ps1']);
export function bfAnalyzeUrl(rawUrl) {
  const signals = [];
  try {
    const url = new URL(rawUrl);
    const info = domainInfo(url.hostname);
    if (url.username || url.password) signals.push(signal('at-symbol-in-url', 'URL includes user information before the actual host.'));
    if (info.isIp) signals.push(signal('ip-literal-host', 'Site uses an IP address (' + info.host + ').'));
    if (info.subdomain.split('.').filter(Boolean).length >= 3) signals.push(signal('deep-subdomain', 'Hostname has an unusually deep subdomain chain.'));
    if (ABUSED.has(info.suffix)) signals.push(signal('abused-tld', 'Domain uses a frequently abused suffix (.' + info.suffix + '); this alone does not imply phishing.'));
    if ((info.host.replace(/xn--/g, '').match(/-/g) || []).length >= 3) signals.push(signal('excessive-hyphens', 'Hostname contains several hyphens.'));
    const tokens = (info.host + url.pathname).toLowerCase().split(/[^a-z]+/);
    const lure = BF_LURE_KEYWORDS.filter(k => tokens.includes(k));
    if (lure.length >= 2) signals.push(signal('lure-keywords', 'Address contains multiple login or urgency terms (' + lure.slice(0, 4).join(', ') + ').'));
    const ext = url.pathname.split('.').pop().toLowerCase();
    if (BF_EXECUTABLE_EXT.has(ext)) signals.push(signal('executable-download', 'Address points to a downloadable .' + ext + ' file (context only).'));
    if (url.protocol === 'http:') signals.push(signal('not-https', 'Page is served over HTTP.'));
    return { signals, hostname: info.host, registrableDomain: info.domain };
  } catch { return { signals, hostname: '', registrableDomain: '' }; }
}
