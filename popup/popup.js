const verdictEl = document.getElementById('verdict');
const level = document.getElementById('levelLabel');
const host = document.getElementById('hostLabel');
const score = document.getElementById('scoreNum');
const reasons = document.getElementById('reasonList');
const note = document.getElementById('emptyState');
const aiNote = document.getElementById('aiNote');
const rescan = document.getElementById('rescanBtn');
const trust = document.getElementById('trustBtn');
let tabId, version = -1, documentId = '', disposed = false;
let reportRequestId = '';
function render(result) {
  if (!result) return;
  if (result.documentId === documentId && (result.version ?? 0) < version) return;
  documentId = result.documentId; version = result.version ?? 0;
  const state = result.state;
  const scored = result.scored;
  const assessment = assessEvidence(result);
  document.getElementById('coverageStatus').textContent = coverageLabel(result);
  document.getElementById('xeluLine').textContent = xeluMessage(state, assessment);
  verdictEl.className = 'verdict ' + ({ danger: 'high', warning: 'medium' }[assessment.severity] || 'low');
  score.textContent = ['unsupported','failed','trusted'].includes(state) ? '-' : String(scored?.score ?? '-');
  level.textContent = assessment.title;
  document.getElementById('actionLabel').textContent = assessment.action;
  try { host.textContent = new URL(result.url).hostname; } catch { host.textContent = ''; }
  reasons.replaceChildren();
  document.getElementById('technicalList').replaceChildren();
  for (const s of scored?.signals || []) {
    const li = document.createElement('li');
    const copy = document.createElement('span');
    copy.textContent = s.detail;
    if (s.frameId || s.occurrences > 1) {
      const meta = document.createElement('span'); meta.className = 'reason-meta';
      meta.textContent = [s.frameId ? 'frame: ' + s.frameHost : '', s.occurrences > 1 ? 'Repeated evidence counted once' : ''].filter(Boolean).join(' / ');
      copy.append(meta);
    }
    const category = document.createElement('span'); category.className = 'reason-points';
    category.textContent = s.category;
    li.append(copy, category);
    reasons.append(li);
    const technical = document.createElement('li');
    technical.textContent = s.id + ': +' + s.contribution + ' in frame ' + (s.frameId ?? 0) + (s.frameHost ? ' (' + s.frameHost + ')' : '') + '. ' + s.occurrences + ' observation(s); counted once per frame.';
    document.getElementById('technicalList').append(technical);
  }
  const text = [];
  if (state === 'unsupported') text.push('Browser pages, the Web Store, and some viewers do not permit scanning.');
  if (state === 'failed') text.push('Reload the page and try again. A failed scan is not a safe verdict.');
  if (state === 'trusted') text.push('Scanning and submission warnings are paused for this exact origin and its embedded frames. Remove trust in Settings to resume.');
  if (result.truncated) text.push('Large page: scan limits reached. Coverage is partial.');
  if (result.navigation?.length) text.push(...result.navigation);
  if (!text.length && !scored?.signals.length && state === 'complete') text.push('No matching indicators. This is not a guarantee of safety.');
  note.textContent = text.join(' '); note.hidden = !text.length;
  const ai = result.ai || { status: 'off' };
  aiNote.textContent = ai.status === 'complete' ? 'Experimental AI advice: ' + (ai.escalate ? 'additional concern. ' : 'no additional concern. ') + ai.reason : 'AI advice: ' + ai.status + '.';
  const reputation = result.reputation || { status: 'off' };
  const confirmed = assessment.kind === 'confirmed';
  document.getElementById('reputationPanel').hidden = !confirmed;
  document.getElementById('reputationDetails').textContent = confirmed ? reputation.provenance + ' Match: ' + reputation.scope + '. Review expires ' + new Date(reputation.expiresAt).toLocaleString() + '.' : '';
  document.getElementById('reputationNote').hidden = confirmed;
  document.getElementById('reputationNote').textContent = 'Shared threat memory: ' + reputation.status + '. Unknown is not a safe verdict.';
  trust.disabled = ['unsupported','trusted','failed'].includes(state);
  rescan.disabled = state === 'unsupported';
  document.getElementById('reportBtn').disabled = ['unsupported','trusted','failed'].includes(state);
}
async function request(type) { return chrome.runtime.sendMessage({ type, tabId }); }
function showFailure(message) {
  level.textContent = 'Scan failed'; score.textContent = '-';
  verdictEl.className = 'verdict low';
  document.getElementById('actionLabel').textContent = 'No current assessment is available. Reload the page and try again.';
  document.getElementById('xeluLine').textContent = xeluMessage('failed');
  document.getElementById('reputationPanel').hidden = true;
  reasons.replaceChildren(); document.getElementById('technicalList').replaceChildren();
  document.getElementById('coverageStatus').textContent = coverageLabel({ state: 'failed' });
  trust.disabled = true; document.getElementById('reportBtn').disabled = true;
  note.hidden = false; note.textContent = message;
}
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'TAB_STATUS_UPDATED' && msg.tabId === tabId && !disposed) render(msg.result);
});
rescan.addEventListener('click', async () => {
  rescan.disabled = true; level.textContent = 'Scanning...';
  try {
    const reply = await request('RESCAN_ACTIVE_TAB');
    if (reply.result) render(reply.result);
    if (!reply.ok) showFailure(reply.error || 'Rescan did not complete. Reload this page.');
  } catch (error) { showFailure(error.message); }
  finally { rescan.disabled = false; }
});
trust.addEventListener('click', async () => {
  const reply = await request('TRUST_SITE');
  if (!reply?.ok) { note.hidden = false; note.textContent = reply?.error || 'Could not trust this site.'; }
  else render(await request('GET_TAB_STATUS'));
});
document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('reportBtn').addEventListener('click', async () => {
  const status = document.getElementById('reportStatus');
  try {
    const preview = await request('GET_REPORT_PREVIEW');
    if (!preview?.ok) throw new Error(preview?.error || 'Reporting unavailable. Enable reports in Settings.');
    reportRequestId = preview.requestId;
    document.getElementById('reportUrl').value = preview.url;
    document.getElementById('reportConsent').checked = false;
    document.getElementById('confirmReport').disabled = true;
    status.textContent = '';
    document.getElementById('reportDialog').showModal();
  } catch (error) { note.hidden = false; note.textContent = error.message; }
});
document.getElementById('reportConsent').addEventListener('change', event => { document.getElementById('confirmReport').disabled = !event.target.checked; });
document.getElementById('cancelReport').addEventListener('click', () => document.getElementById('reportDialog').close());
document.getElementById('confirmReport').addEventListener('click', async () => {
  document.getElementById('confirmReport').disabled = true;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'SUBMIT_REPORT', requestId: reportRequestId, confirmed: true, reuseConsent: document.getElementById('reportConsent').checked });
    if (!reply?.ok) throw new Error(reply?.error || 'Report not accepted.');
    document.getElementById('reportStatus').textContent = 'Sent for review. This does not change the verdict.';
  } catch (error) { document.getElementById('reportStatus').textContent = error.message; }
});
window.addEventListener('pagehide', () => { disposed = true; });
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId != null) render(await request('GET_TAB_STATUS'));
})().catch(error => { showFailure(error.message); });
import { mountBrand, xeluMessage } from '../ui/brand.js';
import { COVERAGE_NOTICE, coverageLabel } from '../ui/coverage.js';
import { assessEvidence } from '../lib/assessment.js';
mountBrand(document);
document.getElementById('coverageNotice').textContent = COVERAGE_NOTICE;
