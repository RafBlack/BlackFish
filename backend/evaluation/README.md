# Independent review and AI acceptance

The reviewed corpus is deliberately empty. Existing `../../evaluation/corpus.json` contains 300 synthetic regressions; those are not independent real-world labels and cannot approve managed AI.

Use the administrator CLI to add independently reviewed public examples, then export a corpus to an ignored private location. Every example requires `id`, `label` (`benign` or `phishing`), `split` (`retrieval`, `tuning`, or `evaluation`), `features` (`hostname`, `signalIds`, `hasCredentials`), `explanation` (at most 200 characters, no URL), `reviewer`, `evidence`, `family`, `domainGroup`, `independentlyReviewed: true`, and `synthetic: false`. Domain groups use the same private-suffix-aware parser as the extension. Raw reports require the user's explicit consent and expire after 30 days.

Freeze at least 200 benign and 100 phishing cases, including at least 100 benign and 50 phishing held-out cases. No family or registrable domain may cross splits. Include legitimate SSO, difficult rule misses, hosted tenants and compromised-site paths. Retrieval examples must not include evaluation domains or template families.

Run `node scripts/evaluate-reviewed.mjs CORPUS RESPONSES`. A response file contains `corpusSha` (SHA-256 of the exact corpus file), `examplesVersion`, `model`, `rulesVersion`, `promptVersion`, and `results`: objects with `id`, `status: complete`, `escalate`, `reason`, and measured `latencyMs`. Use the separate collector with private Cloudflare credentials to obtain actual responses; never derive predictions from labels. Missing, timed-out or malformed eligible responses fail approval.

The gate requires additional held-out phishing, zero benign AI concern flags, and p95 latency at most three seconds. The displayed comparison is an advisory counterfactual; live AI never changes scores or interruptions. Exact-memory matches are excluded from unseen-case recall. Known-threat recurrence, cache-hit ratio and load latency are measured separately by `node scripts/load-local.mjs` against the local service.

Example-set changes increment its database version and invalidate previous approval. `admin approve-ai CORPUS RESPONSES` requires the matching service version and a prepared local deployment configuration; it writes configuration only. Deployment remains a separate operator action. Never advertise synthetic or small-beta results as production accuracy.

Local load measurement on 2026-10-25: 25 synthetic clients made 2,525 reputation checks with 25 API lookups (99.01% local cache hits); 50 advice requests shared one fake-model inference. First-lookup p95 was approximately 249 ms in the local Workers/D1 runtime; the seeded pending-review backlog was zero. This exercises quotas, persistence and deduplication, not model quality, internet latency or public-scale capacity. Reproduce it with the local load commands in `../README.md`; detailed artifacts remain ignored.
