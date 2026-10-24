import { domainInfo } from '../lib/heuristics/domain.js';
import { BF_BRANDS, approvedFor, bfSameBrandFamily } from '../lib/heuristics/brand-list.js';
import { BF_EXECUTABLE_EXT } from '../lib/heuristics/url-analysis.js';
import { signal } from '../lib/heuristics/score.js';
export const LIMITS = Object.freeze({ nodes: 6000, roots: 40, forms: 100, fields: 100, anchors: 800, iframes: 100 });
// Walk incrementally, rather than materializing an unbounded querySelectorAll result.
// Open shadow roots are included; closed page roots are intentionally inaccessible.
export function collectElements(doc) {
  const elements = [], roots = [doc], coverage = { truncated: false, shadowRoots: 0 };
  for (let r = 0; r < roots.length && elements.length < LIMITS.nodes; r++) {
    const walker = doc.createTreeWalker(roots[r], 1);
    let el;
    while ((el = walker.nextNode())) {
      elements.push(el);
      if (el.shadowRoot) {
        if (roots.length < LIMITS.roots) { roots.push(el.shadowRoot); coverage.shadowRoots++; }
        else coverage.truncated = true;
      }
      if (elements.length >= LIMITS.nodes) { coverage.truncated = true; break; }
    }
  }
  return { elements, roots, coverage };
}
export function isVisible(el) {
  if (el.disabled || el.type === 'hidden') return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.getClientRects().length > 0;
}
export function credentialKind(input) {
  const type = (input.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return 'password';
  if ((input.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).includes('one-time-code')) return 'otp';
  return null;
}
export function formFields(form) {
  const credentials = [], ordinary = [];
  // Hidden fields must not push an actual password out of the retained sample.
  for (let i = 0; i < Math.min(form.elements.length, LIMITS.nodes); i++) {
    const field = form.elements[i];
    const target = credentialKind(field) ? credentials : ordinary;
    if (target.length < LIMITS.fields) target.push(field);
  }
  return [...credentials, ...ordinary].slice(0, LIMITS.fields);
}
export function formDestination(form, submitter = null) {
  const override = submitter?.hasAttribute('formaction');
  const action = override ? submitter.formAction : form.action;
  const rawMethod = submitter?.hasAttribute('formmethod') ? submitter.formMethod : form.method;
  const method = (rawMethod || 'get').toLowerCase();
  let url;
  try { url = new URL(action || form.ownerDocument.location.href, form.ownerDocument.baseURI); } catch { return null; }
  const target = submitter?.hasAttribute('formtarget') ? submitter.formTarget : form.target;
  const enctype = submitter?.hasAttribute('formenctype') ? submitter.formEnctype : form.enctype;
  return { url, method, target: target || '', enctype: enctype || '', fingerprint: [url.href, method, target || '', enctype || ''].join('|') };
}
export function scanSingleForm(form, submitter = null, brands = BF_BRANDS) {
  const fields = formFields(form);
  const kinds = fields.filter(isVisible).map(credentialKind).filter(Boolean);
  if (!kinds.length) return { signals: [], credential: false, password: false, destination: null };
  const signals = [signal('credential-presence', 'Page collects a password or a one-time authentication code.')];
  const destination = formDestination(form, submitter);
  const page = new URL(form.ownerDocument.location.href);
  if (destination && destination.method !== 'dialog') {
    const target = destination.url;
    if (!['https:', 'http:'].includes(target.protocol)) {
      signals.push(signal('insecure-credential-form', 'Credential form uses an unsupported or insecure destination scheme.'));
    } else {
      if (domainInfo(page.hostname).domain !== domainInfo(target.hostname).domain && !bfSameBrandFamily(page.hostname, target.hostname, brands)) signals.push(signal('cross-origin-credential-form', 'Credential form submits to a different site (' + target.hostname + ').'));
      if (target.protocol !== 'https:' || page.protocol !== 'https:') signals.push(signal('insecure-credential-form', 'Credentials are entered or submitted over an insecure HTTP connection.'));
    }
  }
  if (fields.filter(f => f.type === 'hidden').length >= 5) signals.push(signal('many-hidden-fields', 'Credential form contains several hidden fields (context only).'));
  return { signals, credential: true, password: kinds.includes('password'), destination };
}
function mentions(text, alias) {
  return text.split(/[^\p{L}\p{N}-]+/u).includes(alias.toLowerCase());
}
export function scanBrandMismatch(doc, hostname, hasCredentials, brands = BF_BRANDS) {
  const meta = doc.querySelector('meta[property="og:site_name"]')?.content || '';
  const text = (doc.title + ' ' + meta).toLowerCase().slice(0, 2000);
  const result = [];
  for (const brand of brands) {
    if (approvedFor(brand, hostname)) continue;
    if (brand.aliases.some(alias => alias.length >= 4 && mentions(text, alias))) {
      result.push(signal(hasCredentials ? 'brand-name-domain-mismatch' : 'brand-mention', hasCredentials ? 'Login page claims the ' + brand.aliases[0] + ' identity on an unrelated site (' + hostname + ').' : 'Page mentions ' + brand.aliases[0] + ' (context only).', { brand: brand.id }));
    }
  }
  return result.slice(0, 10);
}
export function scanDom(doc, brands = BF_BRANDS) {
  const collected = collectElements(doc);
  const groups = { forms: [], branding: [], iframes: [] };
  const forms = collected.elements.filter(e => e.localName === 'form');
  const fields = collected.elements.filter(e => e.localName === 'input');
  if (forms.length > LIMITS.forms || fields.length > LIMITS.fields * LIMITS.forms) collected.coverage.truncated = true;
  for (const f of forms.slice(0, LIMITS.forms)) {
    if (f.elements.length > LIMITS.fields) collected.coverage.truncated = true;
    groups.forms.push(...scanSingleForm(f, null, brands).signals);
  }
  if (fields.some(f => credentialKind(f) && isVisible(f))) groups.forms.push(signal('credential-presence', 'Page collects a password or a one-time authentication code.'));
  groups.branding = scanBrandMismatch(doc, new URL(doc.location.href).hostname, groups.forms.some(s => s.id === 'credential-presence'), brands);
  let hidden = 0;
  const iframes = collected.elements.filter(e => e.localName === 'iframe');
  if (iframes.length > LIMITS.iframes) collected.coverage.truncated = true;
  for (const iframe of iframes.slice(0, LIMITS.iframes)) {
    try {
      const r = iframe.getBoundingClientRect(), style = doc.defaultView.getComputedStyle(iframe);
      if ((r.width <= 2 || r.height <= 2 || style.opacity === '0' || style.visibility === 'hidden') && iframe.src && new URL(iframe.src).origin !== doc.location.origin) hidden++;
    } catch {}
  }
  if (hidden) groups.iframes.push(signal('hidden-cross-origin-iframe', hidden + ' hidden external iframe(s) (context only).'));
  return { groups, collected, coverage: collected.coverage };
}
export function scanAnchors(doc, collected, brands = BF_BRANDS, cancelled = () => false) {
  const anchors = [];
  for (const el of collected.elements) if (el.localName === 'a' && el.hasAttribute('href')) { if (anchors.length === LIMITS.anchors) { collected.coverage.truncated = true; break; } anchors.push(el); }
  return new Promise(resolve => {
    const signals = [];
    let i = 0;
    function step() {
      if (cancelled()) return resolve(null);
      const start = performance.now();
      while (i < anchors.length && performance.now() - start < 6) {
        const a = anchors[i++];
        const text = (a.textContent || '').trim().toLowerCase().slice(0, 300);
        let claimed = null;
        try {
          if (/^(https?:\/\/|www\.)[^\s]+$/.test(text)) claimed = new URL(text.startsWith('www.') ? 'https://' + text : text).hostname;
          else {
            const brand = brands.find(b => b.aliases.some(alias => alias.length >= 4 && alias === text) || b.approvedDomains.includes(text));
            if (brand) claimed = brand.approvedDomains[0];
          }
          const href = new URL(a.href, doc.baseURI);
          if (claimed && ['http:', 'https:'].includes(href.protocol) && domainInfo(claimed).domain !== domainInfo(href.hostname).domain && !bfSameBrandFamily(claimed, href.hostname, brands)) signals.push(signal('anchor-text-href-mismatch', 'Link claims ' + claimed + ' but targets ' + href.hostname + '.'));
          const ext = href.pathname.split('.').pop().toLowerCase();
          if (BF_EXECUTABLE_EXT.has(ext)) signals.push(signal('executable-download-link', 'Page links to a .' + ext + ' download (context only).'));
        } catch {}
      }
      if (i < anchors.length) schedule(step); else resolve(signals);
    }
    function schedule(cb) { if (doc.defaultView.requestIdleCallback) doc.defaultView.requestIdleCallback(cb, { timeout: 250 }); else setTimeout(cb, 0); }
    schedule(step);
  });
}
