import { RULES } from './heuristics/score.js';

export const CLOUD_SCHEMA = 1;
export const RULES_VERSION = '2';
export const PROMPT_VERSION = '1';
export const MANAGED_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';
export const DAY = 86400000;
export const FRESHNESS = 900000;
export const CLOUD_LIMITS = Object.freeze({ installations: 25, lookup: 1000, report: 5, ai: 10, globalAi: 100 });
export function publicHostname(value) {
  if (typeof value !== 'string' || value.length > 253) return false;
  let host;
  try { host = new URL('https://' + value).hostname; } catch { return false; }
  if (host !== value || /[\s/@?#]/.test(value)) return false;
  if (/^\[/.test(host)) return /^\[[23][0-9a-f]{3}:/.test(host) && !host.startsWith('[2001:db8:');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a,b,c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host) && !/\.(localhost|local|localdomain|internal|intranet|private|corp|lan|home|arpa|test|invalid|example|onion|i2p)$/.test(host);
}
export function canonicalUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !publicHostname(url.hostname)) return null;
    url.hash = '';
    return { url: url.href, hostname: url.hostname, origin: url.origin };
  } catch { return null; }
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function normalizeFeatures(value, { allowPrivate = false } = {}) {
  let validHost = publicHostname(value?.hostname);
  if (allowPrivate && typeof value?.hostname === 'string' && value.hostname.length <= 253 && !/[\s/@?#]/.test(value.hostname)) {
    try { validHost = new URL('https://' + value.hostname).hostname === value.hostname; } catch {}
  }
  if (!value || !validHost || !Array.isArray(value.signalIds) || value.signalIds.length > 64 || typeof value.hasCredentials !== 'boolean') throw new Error('Invalid detection metadata.');
  if (Object.keys(value).some(k => !['hostname','signalIds','hasCredentials'].includes(k)) || value.signalIds.some(id => !Object.hasOwn(RULES, id))) throw new Error('Unexpected detection metadata.');
  return { hostname: value.hostname, signalIds: [...new Set(value.signalIds)].sort(), hasCredentials: value.hasCredentials };
}
export async function adviceKey(context, versions, options) { return digest(JSON.stringify([CLOUD_SCHEMA, normalizeFeatures(context, options), Object.keys(versions).sort().map(key => [key,versions[key]])])); }
export function validateAdvice(value) {
  if (!value || typeof value.escalate !== 'boolean' || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 300) throw new Error('Invalid AI advice.');
  return { status: 'complete', escalate: value.escalate, reason: value.reason.replace(/[\u0000-\u001f]/g, ' ').trim() };
}
export function validateThreat(value, target, now = Date.now()) {
  if (value?.status === 'unknown') return { status: 'unknown' };
  if (value?.status !== 'confirmed' || !['url','hostname'].includes(value.scope) || value.hostname !== target.hostname || value.scope === 'url' && value.urlHash !== target.urlHash) throw new Error('Invalid threat match.');
  if (typeof value.id !== 'string' || value.id.length > 100 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.reviewedAt) || !Number.isSafeInteger(value.expiresAt) || value.reviewedAt > now + 300000 || value.expiresAt <= now || value.expiresAt > value.reviewedAt + DAY || typeof value.provenance !== 'string' || !value.provenance.trim() || value.provenance.length > 300) throw new Error('Invalid threat record.');
  return { status: 'confirmed', id: value.id, scope: value.scope, hostname: value.hostname, ...(value.scope === 'url' ? { urlHash: value.urlHash } : {}), revision: value.revision, reviewedAt: value.reviewedAt, expiresAt: value.expiresAt, provenance: value.provenance };
}
export async function boundedJson(response, limit = 16384) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('Response too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
