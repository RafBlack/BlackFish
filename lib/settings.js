import { normalizeDomain } from './heuristics/domain.js';
import { publicHostname } from './cloud-contract.js';
export const SETTINGS_VERSION = 3;
export const DEFAULTS = Object.freeze({ bf_settings_version: 3, bf_allowlist: [], bf_custom_brands: [], bf_ai_enabled: false, bf_ai_endpoint: '', bf_ai_model: '', bf_ai_key: '', bf_cloud_origin: '', bf_cloud_token: '', bf_cloud_lookup: false, bf_cloud_reports: false, bf_managed_ai: false, bf_rejected_settings: [] });
export function cloudOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && publicHostname(url.hostname) && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}
export function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && (value === u.origin || value === u.origin + '/') ? u.origin : null; } catch { return null; }
}
export function endpointInfo(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || u.search) return null;
    const local = ['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol === 'http:';
    const cloud = u.origin === 'https://api.x.ai';
    if (!local && !cloud) return null;
    return { endpoint: u.href, origin: u.origin, permission: u.origin + '/*', local };
  } catch { return null; }
}
export function sanitizeSettings(raw = {}, { migrate = false } = {}) {
  const rejected = Array.isArray(raw.bf_rejected_settings) ? raw.bf_rejected_settings.filter(v => typeof v === 'string').slice(0, 100) : [];
  function clean(key, normalize, max) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) rejected.push(key + ': invalid list');
    if (Array.isArray(raw[key]) && raw[key].length > max) rejected.push(key + ': limited to ' + max + ' entries.');
    return [...new Set((Array.isArray(raw[key]) ? raw[key] : []).slice(0, max).map(v => {
      const valid = normalize(v);
      if (!valid) rejected.push(key + ': rejected ' + String(v).slice(0, 100));
      return valid;
    }).filter(Boolean))];
  }
  const s = { ...DEFAULTS, bf_allowlist: clean('bf_allowlist', normalizeOrigin, 1000), bf_custom_brands: clean('bf_custom_brands', normalizeDomain, 100) };
  s.bf_ai_endpoint = typeof raw.bf_ai_endpoint === 'string' ? raw.bf_ai_endpoint.slice(0, 500).trim() : '';
  s.bf_ai_model = typeof raw.bf_ai_model === 'string' ? raw.bf_ai_model.slice(0, 100).trim() : '';
  s.bf_ai_key = typeof raw.bf_ai_key === 'string' ? raw.bf_ai_key.slice(0, 1000).trim() : '';
  const endpoint = endpointInfo(s.bf_ai_endpoint);
  s.bf_ai_enabled = raw.bf_ai_enabled === true && !!endpoint && !!s.bf_ai_model && (endpoint.local || !!s.bf_ai_key);
  if (raw.bf_ai_enabled === true && !s.bf_ai_enabled) rejected.push('AI disabled: incomplete or unsupported endpoint configuration.');
  if (migrate && (!raw.bf_settings_version || raw.bf_settings_version < 2) && raw.bf_ai_enabled) {
    s.bf_ai_enabled = false;
    rejected.push('AI changed to advisory-only. Review settings before enabling it again.');
  }
  s.bf_cloud_origin = cloudOrigin(raw.bf_cloud_origin) || '';
  s.bf_cloud_token = /^[a-f0-9]{64}$/.test(raw.bf_cloud_token || '') ? raw.bf_cloud_token : '';
  for (const key of ['bf_cloud_lookup','bf_cloud_reports','bf_managed_ai']) {
    s[key] = raw[key] === true && !!s.bf_cloud_origin && !!s.bf_cloud_token;
    if (raw[key] === true && !s[key]) rejected.push('Cloud feature disabled: enter a deployed Workers API origin and valid invitation token.');
  }
  if (s.bf_managed_ai) s.bf_ai_enabled = false;
  s.bf_rejected_settings = [...new Set(rejected)].slice(-100);
  return s;
}
export function publicSettings(s) {
  return { bf_allowlist: s.bf_allowlist, bf_custom_brands: s.bf_custom_brands };
}
export class SerialQueue {
  constructor() { this.tail = Promise.resolve(); }
  run(work) { const next = this.tail.then(work); this.tail = next.catch(() => {}); return next; }
}
