import { scanSingleForm, scanBrandMismatch } from './dom-scanner.js';
import { bfAnalyzeUrl } from '../lib/heuristics/url-analysis.js';
import { bfCheckLookalikeDomain } from '../lib/heuristics/lookalike-domain.js';
import { bfAggregateScore, evidenceFingerprint } from '../lib/heuristics/score.js';
import { credentialPolicy } from '../lib/assessment.js';

export function submissionRisk(form, submitter, brands, options = {}) {
  const analysis = scanSingleForm(form, submitter, brands);
  const url = bfAnalyzeUrl(form.ownerDocument.location.href);
  const identity = bfCheckLookalikeDomain(url.registrableDomain, url.hostname, brands);
  const title = scanBrandMismatch(form.ownerDocument, url.hostname, analysis.credential, brands, { ...options, form });
  const scored = bfAggregateScore([url.signals, identity, title, analysis.signals]);
  const policy = credentialPolicy(scored.signals);
  const interrupt = analysis.destination?.method !== 'dialog' && (policy.insecure || policy.impersonation);
  const fingerprint = [analysis.destination?.fingerprint, evidenceFingerprint(scored), analysis.password, analysis.credential].join('|');
  return { ...analysis, scored, interrupt, fingerprint, reason: policy.insecure ? 'This password or sign-in code is entered or submitted over an insecure or unsupported connection.' : 'Strong domain impersonation indicators accompany credential collection in this document.' };
}
export function installFormGuard({ doc, getContext, ready, requestDecision, report }) {
  const overrides = new WeakMap();
  let pending = null;
  const win = doc.defaultView;
  const lifecycle = new win.AbortController();
  let disposed = false;
  async function approveAndReplay(form, submitter, expected, ask) {
    if (ask) {
      const approved = await requestDecision(expected);
      if (!approved) return;
    }
    const context = getContext();
    if (disposed || context.active === false) return;
    if (!form.isConnected || submitter && (!submitter.isConnected || submitter.form !== form)) return;
    const now = submissionRisk(form, submitter, context.brands);
    if (!context.trusted && now.fingerprint !== expected.fingerprint) { void report(); return; }
    overrides.set(form, { submitter, fingerprint: now.fingerprint, trusted: context.trusted, expires: performance.now() + 100 });
    try {
      // Preserve validation, site handlers, submitter name/value, and form* overrides.
      win.HTMLFormElement.prototype.requestSubmit.call(form, submitter || undefined);
    } finally { overrides.delete(form); }
  }
  function listener(event) {
    if (disposed) return;
    const form = event.composedPath().find(n => n instanceof win.HTMLFormElement);
    if (!form) return;
    const context = getContext();
    if (context.active === false || context.trusted) return;
    const risk = submissionRisk(form, event.submitter, context.brands);
    if (!risk.credential) return;
    const override = overrides.get(form);
    overrides.delete(form); // consumed even if the form changed
    if (override && override.expires >= performance.now() && override.submitter === event.submitter && override.fingerprint === risk.fingerprint && override.trusted === context.trusted) return;
    if (context.loaded && !risk.interrupt) { void report(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (pending) return;
    pending = (async () => {
      await ready();
      const freshContext = getContext();
      if (disposed || freshContext.active === false) return;
      const fresh = submissionRisk(form, event.submitter, freshContext.brands);
      if (freshContext.trusted) return approveAndReplay(form, event.submitter, fresh, false);
      void report();
      return approveAndReplay(form, event.submitter, fresh, fresh.interrupt);
    })().catch(error => { if (!disposed && getContext().active !== false) console.warn('BlackFish could not resume this submission:', error.message); }).finally(() => { pending = null; });
  }
  // Submit is not composed across shadow roots; attach to each discovered open root as well.
  const observed = new WeakSet();
  function observe(root) {
    if (disposed || observed.has(root)) return;
    observed.add(root); root.addEventListener('submit', listener, { capture: true, signal: lifecycle.signal });
  }
  observe(doc);
  return { observe, dispose: () => { disposed = true; lifecycle.abort(); } };
}
