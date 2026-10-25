import { evidenceFingerprint } from '../lib/heuristics/score.js';
import { createXelu, createMark, xeluMessage } from '../ui/brand.js';
import { OVERLAY_CSS } from '../ui/overlay-style.js';
import { COVERAGE_NOTICE, coverageLabel } from '../ui/coverage.js';

export function createOverlay(doc, onTrust) {
  let host, root, banner, dialog, pendingResolve, previousFocus;
  let dismissed = '', lastBanner = '', activeKey = '';
  function node(tag, text, className) {
    const el = doc.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function brand() {
    const lockup = node('div', undefined, 'brand-lockup');
    lockup.append(createMark(doc), node('span', 'BLACKFISH'));
    return lockup;
  }
  function mascot(className) {
    const slot = node('div', undefined, className);
    slot.setAttribute('aria-hidden', 'true');
    slot.append(createXelu(doc));
    return slot;
  }
  function ensure() {
    if (!doc.documentElement) return false;
    if (host?.isConnected) return true;
    // Never reuse a page-created node or expose the closed root through DOM properties.
    host = doc.createElement('div');
    host.dataset.blackfishUi = '';
    root = host.attachShadow({ mode: 'closed' });
    root.append(node('style', OVERLAY_CSS));
    doc.documentElement.append(host);
    banner = null; dialog = null; lastBanner = '';
    return true;
  }
  function clearBanner() { banner?.remove(); banner = null; lastBanner = ''; }
  function settle(approved) {
    const resolve = pendingResolve; pendingResolve = null;
    dialog?.remove(); dialog = null; activeKey = '';
    if (previousFocus?.isConnected) previousFocus.focus();
    resolve?.(approved);
  }
  function render(scored, state = 'complete', reputation = { status: 'off' }, truncated = false) {
    const confirmed = reputation.status === 'confirmed' && reputation.expiresAt > Date.now() && reputation.freshUntil > Date.now();
    const key = evidenceFingerprint(scored) + (confirmed ? ':threat:' + reputation.id + ':' + reputation.revision : '');
    if (state === 'trusted' || scored.level === 'LOW' && !confirmed) { clearBanner(); return; }
    if (key === dismissed) return;
    const renderKey = key + ':' + state + ':' + truncated;
    if (!ensure() || renderKey === lastBanner && banner?.isConnected) return;
    clearBanner(); lastBanner = renderKey;
    banner = node('aside', undefined, 'banner');
    banner.dataset.level = confirmed ? 'HIGH' : scored.level;
    banner.setAttribute('role', 'status'); banner.setAttribute('aria-label', 'BlackFish: Xelu phishing warning');
    const header = node('div', undefined, 'banner-header');
    header.append(brand(), node('span', 'by xelulabs', 'brand-credit'));
    const stage = node('div', undefined, 'banner-stage');
    stage.append(
      node('div', confirmed ? "i've seen this bait before." : xeluMessage('complete', scored.level), 'speech-bubble'),
      mascot('banner-mascot'),
      node('p', confirmed ? 'PREVIOUSLY CONFIRMED PHISHING' : (scored.level === 'HIGH' ? 'HIGH PHISHING RISK' : 'RISK INDICATORS DETECTED') + ' / ' + scored.score + ' OF 100', 'banner-state')
    );
    const reasons = node('p', confirmed ? 'XeluLabs review: ' + reputation.provenance + ' Local risk indicator: ' + scored.score + '/100.' : scored.signals.filter(s => s.contribution > 0).slice(0, 2).map(s => s.detail).join(' '), 'banner-reasons');
    const actions = node('div', undefined, 'banner-actions');
    const trust = node('button', 'Trust this site', 'trust');
    trust.addEventListener('click', async e => { if (e.isTrusted) { trust.disabled = true; try { await onTrust(); clear(); } catch { trust.disabled = false; } } });
    const dismiss = node('button', 'Dismiss', 'dismiss');
    dismiss.addEventListener('click', () => { dismissed = key; clearBanner(); });
    const coverage = node('p', coverageLabel({ state, truncated }) + '. ' + COVERAGE_NOTICE, 'coverage banner-coverage');
    actions.append(trust, dismiss); banner.append(header, stage, reasons, coverage, actions); root.append(banner);
  }
  function prompt({ key, scored, reason, frameHost }) {
    if (activeKey === key && pendingResolve) return Promise.resolve(false);
    settle(false);
    if (!ensure()) return Promise.resolve(false);
    activeKey = key;
    previousFocus = doc.activeElement;
    dialog = node('div', undefined, 'backdrop');
    const card = node('section', undefined, 'card');
    card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'bf-dialog-title'); card.setAttribute('aria-describedby', 'bf-dialog-description');
    const header = node('div', undefined, 'card-header');
    header.append(brand(), node('span', 'a xelulabs project', 'brand-credit'));
    const content = node('div', undefined, 'card-content');
    const scene = node('div', undefined, 'card-scene');
    scene.append(node('p', 'XELU / ON WATCH', 'eyebrow'), node('div', "hey. don't send that yet.", 'speech-bubble'), mascot('card-mascot'));
    const body = node('div', undefined, 'card-body');
    const heading = node('h1', 'Check this credential submission'); heading.id = 'bf-dialog-title';
    const desc = node('p', reason, 'description'); desc.id = 'bf-dialog-description';
    body.append(node('p', 'FORM SUBMISSION PAUSED', 'eyebrow'), heading, desc);
    if (frameHost) {
      const caption = node('p', 'FORM FRAME', 'frame-caption');
      caption.append(node('strong', frameHost));
      body.append(caption);
    }
    const list = node('ul', undefined, 'reasons');
    for (const s of scored.signals.filter(s => s.contribution > 0).slice(0, 4)) list.append(node('li', s.detail));
    body.append(node('p', 'What Xelu noticed', 'reason-heading'), list);
    const actions = node('div', undefined, 'actions');
    const cancel = node('button', 'Cancel submission', 'cancel');
    const proceed = node('button', 'Submit once anyway', 'proceed');
    cancel.addEventListener('click', () => settle(false));
    proceed.addEventListener('click', e => { if (e.isTrusted) settle(true); });
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      if (e.key === 'Tab') { e.preventDefault(); (root.activeElement === cancel ? proceed : cancel).focus(); }
    });
    actions.append(cancel, proceed); body.append(actions); content.append(scene, body);
    const footer = node('div', undefined, 'card-footer');
    footer.append(node('span', 'Local protection. Your decision.'), node('span', 'RISK INDICATOR ' + scored.score + ' / 100'), node('p', COVERAGE_NOTICE, 'coverage'));
    card.append(header, content, footer); dialog.append(card); root.append(dialog); cancel.focus();
    return new Promise(resolve => { pendingResolve = resolve; });
  }
  function clear() { clearBanner(); settle(false); }
  function dispose() { clear(); host?.remove(); host = null; root = null; }
  return { render, prompt, clear, dispose, isOwnNode: n => !!host && (n === host || host.contains(n)), cancelPrompt: () => settle(false) };
}
