import { normalizeDomain, domainInfo } from './domain.js';
const families = [
  ['google', ['google.com', 'gmail.com', 'youtube.com'], ['google', 'gmail']],
  ['microsoft', ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com'], ['microsoft', 'outlook', 'office']],
  ['apple', ['apple.com', 'icloud.com'], ['apple', 'icloud']],
  ['meta', ['facebook.com', 'instagram.com', 'whatsapp.com'], ['facebook', 'instagram', 'whatsapp']],
  ['amazon', ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.co.jp', 'amazon.in', 'amazonaws.com'], ['amazon']],
  ['x', ['x.com', 'twitter.com'], ['twitter']],
  ['stripe.com', ['stripe.com'], ['stripe'], ['m.stripe.network']]
];
const domains = ['yahoo.com','aol.com','protonmail.com','proton.me','paypal.com','chase.com','bankofamerica.com','wellsfargo.com','citibank.com','capitalone.com','americanexpress.com','discover.com','usbank.com','hsbc.com','barclays.co.uk','coinbase.com','binance.com','kraken.com','venmo.com','revolut.com','wise.com','westernunion.com','dropbox.com','box.com','adobe.com','salesforce.com','slack.com','zoom.us','github.com','gitlab.com','atlassian.com','notion.so','linkedin.com','netflix.com','ebay.com','walmart.com','fedex.com','ups.com','usps.com','dhl.com','verizon.com','att.com','t-mobile.com','comcast.com'];
export const BF_BRANDS = Object.freeze([
  ...families.map(([id, approvedDomains, aliases, approvedHosts = []]) => ({ id, approvedDomains, aliases, approvedHosts })),
  ...domains.map(d => ({ id: d, approvedDomains: [d], aliases: [domainInfo(d).label] }))
]);
export function brandsWithCustom(custom = []) {
  return [...BF_BRANDS, ...custom.map(normalizeDomain).filter(Boolean).filter(d => !BF_BRANDS.some(b => b.approvedDomains.includes(d) || b.approvedHosts?.includes(d))).map(d => ({ id: 'custom:' + d, approvedDomains: [d], aliases: [domainInfo(d).label] }))];
}
export function approvedFor(brand, hostname) {
  return brand.approvedHosts?.includes(hostname) || brand.approvedDomains.some(d => hostname === d || (hostname.endsWith('.' + d) && domainInfo(hostname).domain === domainInfo(d).domain));
}
export function bfSameBrandFamily(a, b, brands = BF_BRANDS) {
  return a === b || brands.some(brand => approvedFor(brand, a) && approvedFor(brand, b));
}
export const BF_LURE_KEYWORDS = ['login','signin','verify','verification','secure','security','account','update','confirm','billing','payment','suspended','unlock','reset','password','support','webscr','authenticate'];
