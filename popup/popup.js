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
function render(result) {
  if (!result) return;
  if (result.documentId === documentId && (result.version ?? 0) < version) return;
  documentId = result.documentId; version = result.version ?? 0;
  const state = result.state;
  const scored = result.scored;
  document.getElementById('xeluLine').textContent = xeluMessage(state, scored?.level);
  verdictEl.className = 'verdict ' + (scored?.level.toLowerCase() || 'low');
  score.textContent = ['unsupported','failed','trusted'].includes(state) ? '-' : String(scored?.score ?? '-');
  level.textContent = {
    unsupported: 'Page cannot be scanned', failed: 'Scan failed', scanning: 'Scanning...',
    trusted: 'Trusted site: protection paused'
  }[state] || { LOW: 'No strong phishing indicators detected', MEDIUM: 'Risk indicators detected', HIGH: 'High phishing risk' }[scored?.level] || 'Waiting for scan';
  try { host.textContent = new URL(result.url).hostname; } catch { host.textContent = ''; }
  reasons.replaceChildren();
  for (const s of scored?.signals || []) {
    const li = document.createElement('li');
    const copy = document.createElement('span');
    copy.textContent = s.detail;
    if (s.frameId || s.occurrences > 1) {
      const meta = document.createElement('span'); meta.className = 'reason-meta';
      meta.textContent = [s.frameId ? 'frame: ' + s.frameHost : '', s.occurrences > 1 ? 'Repeated evidence counted once' : ''].filter(Boolean).join(' / ');
      copy.append(meta);
    }
    const points = document.createElement('span'); points.className = 'reason-points';
    points.textContent = s.contribution > 0 ? '+' + s.contribution : 'info';
    points.setAttribute('aria-label', s.contribution + ' score points');
    li.append(copy, points);
    reasons.append(li);
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
  trust.disabled = ['unsupported','trusted','failed'].includes(state);
  rescan.disabled = state === 'unsupported';
}
async function request(type) { return chrome.runtime.sendMessage({ type, tabId }); }
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'TAB_STATUS_UPDATED' && msg.tabId === tabId && !disposed) render(msg.result);
});
rescan.addEventListener('click', async () => {
  rescan.disabled = true; level.textContent = 'Scanning...';
  try {
    const reply = await request('RESCAN_ACTIVE_TAB');
    if (reply.result) render(reply.result);
    if (!reply.ok) { note.hidden = false; note.textContent = reply.error || 'Rescan did not complete. Reload this page.'; }
  } catch (error) { note.hidden = false; note.textContent = error.message; }
  finally { rescan.disabled = false; }
});
trust.addEventListener('click', async () => {
  const reply = await request('TRUST_SITE');
  if (!reply?.ok) { note.hidden = false; note.textContent = reply?.error || 'Could not trust this site.'; }
  else render(await request('GET_TAB_STATUS'));
});
document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
window.addEventListener('pagehide', () => { disposed = true; });
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId != null) render(await request('GET_TAB_STATUS'));
})().catch(error => { level.textContent = 'Status unavailable'; note.hidden = false; note.textContent = error.message; });
import { mountBrand, xeluMessage } from '../ui/brand.js';
mountBrand(document);
