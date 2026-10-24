# BlackFish invited beta service

Workers + D1 + Workers AI, prepared for the Cloudflare Free plan and at most 25 invited installations. Nothing deploys during the extension build or tests. Production managed AI defaults off and requires independent evaluation approval. No paid service, remote crawler, vector database or shared provider credential is included in the extension.

## Local verification

Install the root project first, then use Node >=22.16 for backend tooling:

```
npm ci
cd backend
npm ci
npm test
npm run deploy:check
```

The backend tests use the real SQLite migration and SQL triggers through a D1-shaped adapter. Node 22 may print its built-in SQLite experimental warning. A full local Workers/D1 load test additionally uses Wrangler's runtime. From `backend`:

```
node scripts/load-local.mjs --seed
npx wrangler d1 migrations apply blackfish-local-test --local --config wrangler.test.json --persist-to .wrangler/integration
npx wrangler d1 execute blackfish-local-test --local --config wrangler.test.json --persist-to .wrangler/integration --file .wrangler/test-seed.sql
npx wrangler dev --config wrangler.test.json --persist-to .wrangler/integration --port 8788 --ip 127.0.0.1
```

In another terminal in `backend`, run `node scripts/load-local.mjs`. This performs 2,525 reputation checks and 50 advice requests across 25 synthetic clients, verifies 25 reputation network requests and exactly one fake-model inference, and writes ignored `artifacts/load-report.json`. Stop the local server afterward. The test configuration has no real AI binding, cannot serve non-local hostnames, and must never be used for production. The seed resets only the explicitly selected local fixture database. Set `WRANGLER_SEND_METRICS=false` in your shell to disable Wrangler telemetry.

## Prepare deployment, then deploy separately

1. In your Cloudflare Free account, create D1 database `blackfish-beta`; do not upgrade to a paid plan. The committed all-zero UUID is an inert placeholder.
2. Run `npm run prepare:deployment -- DATABASE_UUID` inside `backend`. It creates ignored `wrangler.local.json` with managed AI disabled. Do not commit credentials or local account configuration.
3. After reviewing the bundle, apply `npx wrangler d1 migrations apply blackfish-beta --remote --config wrangler.local.json`, then `npm run deploy`. These are operator deployment actions; they are not executed by setup or tests.
4. Copy the resulting exact HTTPS origin, such as `https://blackfish-api.ACCOUNT.workers.dev`, into extension Settings. Only that configured origin is requested when a cloud feature is explicitly enabled. No deployment origin is preselected.
5. Issue individual invitations using the admin CLI. Keep deployment and administration credentials outside source control and outside the extension. Each invitation is an independent revocable token; only its hash is stored in D1. The CLI intentionally displays the new token once for private delivery.

## Administration

For a remote service, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_ID` and a narrowly scoped `CLOUDFLARE_API_TOKEN` privately. Run `node scripts/admin.mjs COMMAND`. The CLI uses the D1 API and parameterized SQL; it does not fetch any reported site. For an offline review sandbox, use `init-local --local PATH`, then append `--local PATH` to commands. This offline database is separate from Wrangler's runtime database.

Commands:

- `invite`; `revoke-installation ID`; `metrics`.
- `pending`; `confirm REPORT_ID url|hostname REVIEWER EVIDENCE`; `reject REPORT_ID`.
- `revoke-threat ID`; `renew-threat ID REVIEWER CURRENT_EVIDENCE`.
- `add-example FILE`; `revoke-example ID`; `export-examples FILE`.
- `approve-ai CORPUS RESPONSES`: validates the independent dataset and response metrics and updates prepared local configuration only; it never deploys.

Reviewers independently verify each report, explicitly choose exact-link or exact-hostname scope, and provide current evidence. No vote count, model output, trust action or submission override confirms a threat. Public suffixes cannot be flagged as whole hosts. Reviews expire within 24 hours; revocations reach active client warnings within their 15-minute freshness window. Export private examples outside tracked source; see `evaluation/README.md` for required fields and split isolation.

## API and limits

Every route requires `Authorization: Bearer INSTALLATION_TOKEN`. Authentication is not based on CORS or the extension ID.

- `GET /v1/config`: model/prompt/rules/example versions and the managed-AI evaluation gate; carries no browsing target.
- `POST /v1/reputation/lookup`: `{schema:1, hostname, urlHash}`; returns confirmed/unknown. Raw URLs are rejected.
- `POST /v1/reports`: `{schema:1, requestId, url, context, confirmed:true, reuseConsent:true}`; returns pending. Reports are idempotent per installation/request ID.
- `POST /v1/ai/triage`: `{schema:1, context, versions}`; returns advisory JSON, a cached result, or a controlled pending/limited/unavailable state. Context contains only hostname, known rule IDs and credential presence.

SQL enforces 1,000 lookups, five reports and ten new inferences per installation per UTC day, with 100 inferences globally. Reservations and quota consumption are atomic. Duplicate requests do not spend another inference slot; failed/time-out calls still consume their reservation. Pending advice can be checked with an explicit page rescan; there is no automatic polling loop. Successful advice lasts 24 hours, failed reservations one minute, and managed advice keys include all configuration versions. Clients recheck policy versions within 15 minutes.

The production AI request uses the selected Granite model with temperature zero, at most 160 output tokens and a 4 KiB prompt. At most four deterministically selected reviewed examples are included, balancing benign/phishing examples when available. Schema/length validation rejects malformed output; tool calls are never executed. The client waits at most three seconds; provider work may continue after a deadline and still counts toward its free allowance.

The daily cron removes raw reports older than 30 days, expired jobs, old counters and obsolete threat rows. Approved minimized examples persist until revoked. Application logs exclude addresses, bodies, prompts and credentials. Cloudflare may retain operational metadata; configure store disclosures and a public privacy contact before public distribution.

## AI acceptance remains closed

`evaluation/reviewed-corpus.json` is empty on purpose. The existing root corpus is synthetic and cannot meet the independent-label requirement. Collect and review at least 200 benign and 100 phishing examples, freeze domain/template-separated retrieval/tuning/evaluation sets, export them, and collect measured model responses with `node scripts/collect-advice.mjs CORPUS OUTPUT`. That collector is an explicit operator action using provider quota; it is never run by tests.

Approval requires additional unseen phishing detection, zero benign AI concern flags, and p95 response latency <=3 seconds. New or changed examples invalidate approval. Until approved and deliberately deployed, managed AI returns `evaluation-required`. Local checks and shared reputation do not depend on model approval. No production accuracy, internet latency or capacity beyond the tested 25-client local fixture is claimed.
