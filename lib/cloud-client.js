import { adviceKey, boundedJson, canonicalUrl, CLOUD_SCHEMA, DAY, digest, FRESHNESS, normalizeFeatures, RULES_VERSION, validateAdvice, validateThreat } from './cloud-contract.js';

export class CloudClient {
  constructor({ cache, permission, fetcher = (...args) => fetch(...args), now = Date.now }) {
    this.cache = cache; this.permission = permission; this.fetcher = fetcher; this.now = now;
    this.pending = new Map(); this.controllers = new Set(); this.generation = 0;
  }
  cancel() { this.generation++; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); this.pending.clear(); }
  async call(settings, path, body, timeout = 1000, generation = this.generation) {
    const origin = settings.bf_cloud_origin;
    if (!origin || !settings.bf_cloud_token) return { status: 'limited' };
    const cooldownKey = 'cooldown:' + await digest(origin + path);
    const previous = this.cache.get(cooldownKey);
    if (generation !== this.generation) return { status: 'interrupted' };
    if (previous?.until > this.now()) return { status: previous.status };
    const controller = new AbortController();
    let timedOut = false;
    const interrupted = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve({ status: timedOut ? 'timeout' : 'interrupted' }), { once: true }));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout); this.controllers.add(controller);
    const work = async () => { try {
      if (!await this.permission(origin + '/*') || generation !== this.generation || controller.signal.aborted) return { status: 'permission-denied' };
      const response = await this.fetcher(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + settings.bf_cloud_token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const data = await boundedJson(response);
      if (generation !== this.generation || controller.signal.aborted) return { status: 'interrupted' };
      if (!response.ok) {
        const retry = Math.min(DAY / 1000, Math.max(60, Number(response.headers.get('Retry-After')) || 60));
        const until = this.now() + retry * 1000;
        const status = response.status === 429 ? 'limited' : response.status === 409 ? 'version-changed' : response.status === 401 || response.status === 403 ? 'unauthorized' : 'unavailable';
        if (status !== 'version-changed') await this.cache.put(cooldownKey, 'cooldown', { status, until }, until);
        return { status };
      }
      return data;
    } catch { return { status: controller.signal.aborted ? timedOut ? 'timeout' : 'interrupted' : 'unavailable' }; } };
    try { return await Promise.race([work(), interrupted]); }
    finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  async once(key, work) {
    if (this.pending.has(key)) return this.pending.get(key);
    const job = Promise.resolve().then(work); this.pending.set(key, job);
    try { return await job; } finally { if (this.pending.get(key) === job) this.pending.delete(key); }
  }
  async lookup(url, settings, excluded = false) {
    const target = canonicalUrl(url);
    if (!settings.bf_cloud_lookup || excluded || !target) return { status: 'off' };
    const generation = this.generation;
    target.urlHash = await digest(target.url);
    const key = 'threat:' + await digest(settings.bf_cloud_origin + ':' + target.urlHash);
    if (generation !== this.generation) return { status: 'interrupted' };
    const cached = this.cache.get(key);
    if (cached) { try { return { ...validateThreat(cached, target, this.now()), cached: true, freshUntil: this.cache.expiry(key) }; } catch {} }
    return this.once(key, async () => {
      const data = await this.call(settings, '/v1/reputation/lookup', { schema: CLOUD_SCHEMA, hostname: target.hostname, urlHash: target.urlHash }, 1000, generation);
      if (!['confirmed','unknown'].includes(data?.status)) return data;
      try {
        const result = validateThreat(data, target, this.now());
        if (generation !== this.generation) return { status: 'interrupted' };
        const freshUntil = result.status === 'confirmed' ? Math.min(result.expiresAt, this.now() + FRESHNESS) : this.now() + 300000;
        await this.cache.put(key, 'threat', result, freshUntil);
        return { ...result, freshUntil };
      } catch { return { status: 'unavailable' }; }
    });
  }
  async triage(context, settings, excluded = false) {
    if (!settings.bf_managed_ai || excluded) return { status: 'off' };
    const started = performance.now(), remaining = () => Math.max(0, 3000 - (performance.now() - started));
    let timer;
    try { return await Promise.race([this.requestAdvice(context, settings, remaining), new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), 3000); })]); }
    finally { clearTimeout(timer); }
  }
  async requestAdvice(context, settings, remaining) {
    context = normalizeFeatures(context);
    const generation = this.generation;
    const configKey = 'config:' + await digest(settings.bf_cloud_origin);
    if (generation !== this.generation) return { status: 'interrupted' };
    let config = this.cache.get(configKey);
    if (!config) {
      config = await this.once(configKey, () => remaining() > 0 ? this.call(settings, '/v1/config', null, Math.min(1000, remaining()), generation) : { status: 'timeout' });
      if (config?.schema !== CLOUD_SCHEMA || typeof config.examplesVersion !== 'string' || config.examplesVersion.length > 100 || typeof config.model !== 'string' || config.model.length > 100 || typeof config.promptVersion !== 'string' || config.promptVersion.length > 100 || config.rulesVersion !== RULES_VERSION) return { status: 'unavailable' };
      if (generation !== this.generation) return { status: 'interrupted' };
      await this.cache.put(configKey, 'config', config, this.now() + FRESHNESS);
    }
    const policyFreshUntil = this.cache.expiry(configKey);
    if (config.managedEnabled !== true) return { status: 'evaluation-required', policyFreshUntil };
    const versions = { origin: settings.bf_cloud_origin, rules: RULES_VERSION, model: config.model, prompt: config.promptVersion, examples: config.examplesVersion };
    const key = 'advice:' + await adviceKey(context, versions);
    const cached = this.cache.get(key);
    if (cached) { try { return { ...validateAdvice(cached), cached: true, policyFreshUntil }; } catch {} }
    return this.once(key, async () => {
      if (remaining() <= 0) return { status: 'timeout' };
      const data = await this.call(settings, '/v1/ai/triage', { schema: CLOUD_SCHEMA, context, versions }, remaining(), generation);
      if (data?.status === 'version-changed') await this.cache.clear('config');
      if (data?.status !== 'complete') return data;
      try {
        const result = validateAdvice(data);
        if (Object.keys(versions).some(key => data.versions?.[key] !== versions[key]) || generation !== this.generation) return { status: 'interrupted' };
        await this.cache.put(key, 'advice', result, this.now() + DAY);
        return { ...result, policyFreshUntil };
      } catch { return { status: 'unavailable' }; }
    });
  }
  async report(preview, settings) {
    if (!settings.bf_cloud_reports || preview.confirmed !== true || preview.reuseConsent !== true || !canonicalUrl(preview.url)) return { status: 'consent-required' };
    return this.call(settings, '/v1/reports', { schema: CLOUD_SCHEMA, requestId: preview.requestId, url: canonicalUrl(preview.url).url, context: normalizeFeatures(preview.context), confirmed: true, reuseConsent: true }, 3000);
  }
}
