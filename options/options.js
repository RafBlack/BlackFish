import { normalizeDomain } from '../lib/heuristics/domain.js';
import { endpointInfo, cloudOrigin } from '../lib/settings.js';
import { mountBrand } from '../ui/brand.js';
import { COVERAGE_NOTICE } from '../ui/coverage.js';
mountBrand(document);
document.getElementById('coverageNotice').textContent = COVERAGE_NOTICE;
let settings;
const el = id => document.getElementById(id);
const send = async msg => {
  const reply = await chrome.runtime.sendMessage(msg);
  if (!reply?.ok) throw new Error(reply?.error || 'Settings request failed.');
  return reply.settings;
};
function message(text, error = false) { el('saveStatus').textContent = text; el('saveStatus').dataset.error = String(error); el('saveStatus').hidden = false; }
async function save(patch) { settings = await send({ type: 'SAVE_SETTINGS', settings: patch }); renderLists(); return settings; }
function renderList(id, values, key) {
  const list = el(id); list.replaceChildren();
  for (const value of values) {
    const li = document.createElement('li'), span = document.createElement('span'), button = document.createElement('button');
    span.textContent = value; button.textContent = 'Remove'; button.type = 'button'; button.setAttribute('aria-label', 'Remove ' + value);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { settings = await send({ type: key === 'bf_allowlist' ? 'REMOVE_TRUST' : 'REMOVE_PROTECTED_DOMAIN', value }); renderLists(); }
      catch (e) { message(e.message, true); button.disabled = false; }
    });
    li.append(span, button); list.append(li);
  }
}
function renderLists() {
  renderList('allowlist', settings.bf_allowlist, 'bf_allowlist');
  renderList('brandlist', settings.bf_custom_brands, 'bf_custom_brands');
  el('allowlistEmpty').hidden = settings.bf_allowlist.length > 0;
  el('rejected').textContent = settings.bf_rejected_settings.join('\n');
  el('rejected').hidden = !settings.bf_rejected_settings.length;
}
el('addBrandBtn').addEventListener('click', async () => {
  const domain = normalizeDomain(el('brandInput').value.trim());
  if (!domain) { message('Enter a valid domain without a path, port, or user information.', true); return; }
  try { settings = await send({ type: 'ADD_PROTECTED_DOMAIN', value: domain }); renderLists(); el('brandInput').value = ''; message('Protected domain added. Open pages are updating.'); }
  catch (e) { message(e.message, true); }
});
el('presetSelect').addEventListener('change', e => {
  if (e.target.value === 'grok') { el('aiEndpoint').value = 'https://api.x.ai/v1/chat/completions'; el('aiModel').value = ''; }
  if (e.target.value === 'local') { el('aiEndpoint').value = 'http://localhost:11434/v1/chat/completions'; el('aiModel').value = ''; }
});
el('saveBtn').addEventListener('click', async () => {
  const enabled = el('aiEnabled').checked, endpoint = el('aiEndpoint').value.trim(), model = el('aiModel').value.trim(), key = el('aiKey').value.trim();
  const info = endpointInfo(endpoint);
  if (enabled && (!info || !model || !info.local && !key)) { message('AI needs a supported endpoint, model name, and a cloud API key. Local models may omit a key.', true); return; }
  if (endpoint && !info) { message('Supported endpoints: https://api.x.ai, http://localhost, and http://127.0.0.1 only.', true); return; }
  el('saveBtn').disabled = true;
  try {
    // Permission request happens directly in this click handler, preserving the user gesture.
    if (enabled && !await chrome.permissions.request({ origins: [info.permission] })) { message('Network permission denied. Personal AI remains off.', true); el('aiEnabled').checked = false; await save({ bf_ai_enabled: false }); return; }
    await save({ bf_ai_enabled: enabled, bf_ai_endpoint: endpoint, bf_ai_model: model, bf_ai_key: key, ...(enabled ? { bf_managed_ai: false } : {}) });
    el('managedAi').checked = settings.bf_managed_ai;
    message('Saved. AI advice never changes the local score or blocks a submission.');
  } catch (error) { message(error.message, true); }
  finally { el('saveBtn').disabled = false; }
});
el('clearNotices').addEventListener('click', () => save({ bf_rejected_settings: [] }).catch(e => message(e.message, true)));
async function cacheStatus() {
  const reply = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATUS' });
  if (!reply?.ok) throw new Error(reply?.error || 'Could not read cache status.');
  el('cacheStatus').textContent = reply.cache.entries + ' cached entries / ' + Math.round(reply.cache.bytes / 1024) + ' KiB. Limit: 5,000 entries or 3 MiB. Settings and credentials are separate.';
}
el('saveCloudBtn').addEventListener('click', async () => {
  const origin = cloudOrigin(el('cloudOrigin').value.trim()), token = el('cloudToken').value.trim();
  const patch = { bf_cloud_origin: origin || '', bf_cloud_token: token, bf_cloud_lookup: el('cloudLookup').checked, bf_cloud_reports: el('cloudReports').checked, bf_managed_ai: el('managedAi').checked };
  const enabled = patch.bf_cloud_lookup || patch.bf_cloud_reports || patch.bf_managed_ai;
  if (enabled && (!origin || !/^[a-f0-9]{64}$/.test(token))) { message('Enter your deployed HTTPS Workers origin and 64-character invitation token.', true); return; }
  try {
    if (enabled && !await chrome.permissions.request({ origins: [origin + '/*'] })) { message('Network permission denied. Your saved cloud choices were kept.', true); return; }
    el('saveCloudBtn').disabled = true;
    await save({ ...patch, ...(patch.bf_managed_ai ? { bf_ai_enabled: false } : {}) });
    el('aiEnabled').checked = settings.bf_ai_enabled;
    message('Cloud choices saved. Managed AI stays unavailable until the service passes evaluation.');
    await cacheStatus();
  } catch (error) { message(error.message, true); }
  finally { el('saveCloudBtn').disabled = false; }
});
el('clearCacheBtn').addEventListener('click', async () => {
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'CLEAR_LOCAL_CACHE' });
    if (!reply?.ok) throw new Error(reply?.error || 'Could not clear caches.');
    await cacheStatus(); message('Local threat and AI caches cleared. Settings and credentials were kept.');
  } catch (error) { message(error.message, true); }
});
(async () => {
  settings = await send({ type: 'GET_SETTINGS' }); renderLists();
  el('aiEnabled').checked = settings.bf_ai_enabled;
  el('aiEndpoint').value = settings.bf_ai_endpoint;
  el('aiModel').value = settings.bf_ai_model;
  el('aiKey').value = settings.bf_ai_key;
  el('cloudOrigin').value = settings.bf_cloud_origin;
  el('cloudToken').value = settings.bf_cloud_token;
  el('cloudLookup').checked = settings.bf_cloud_lookup;
  el('cloudReports').checked = settings.bf_cloud_reports;
  el('managedAi').checked = settings.bf_managed_ai;
  await cacheStatus();
})().catch(e => message(e.message, true));
