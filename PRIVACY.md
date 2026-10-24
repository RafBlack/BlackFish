# BlackFish beta privacy

Local phishing checks run without a network service. Cloud lookups, explicit reports and XeluLabs-managed AI each start disabled and require separate consent. Declining or losing cloud access leaves local protection running. Exact-origin trust pauses protection and cloud checks for that page and its embedded frames.

## What is shared

- Optional reputation lookups send the hostname and SHA-256 hash of the exact HTTP(S) address, including its query but excluding its fragment. Hashing does not make browsing anonymous. The service can associate requests with an invited installation. No raw address or page content is included in automatic lookups.
- Optional managed AI sends hostname, matched rule IDs and credential-field presence. Human-approved minimized examples can be included. No raw URLs, titles, HTML, screenshots, field values or credentials are sent to the model. Cloudflare hosts the API, database and model, and can see connection/operational metadata.
- Reports send the exact displayed address, including its query, and detection metadata only after preview and explicit confirmation of human review and approved feature reuse. Cancel if a query contains a login token, private identifier or other sensitive data. Reports start pending; reports and AI guesses are not confirmed threats.

Automatic cloud requests exclude incognito pages, localhost, private IP literals, intranet names and trusted origins. An ordinary public hostname can still refer to a private service; use exact-origin trust to pause it. The service does not resolve or fetch reported URLs.

## Storage and retention

Local threat and AI caches are bounded to 3 MiB or 5,000 entries. Clear them from Settings without deleting credentials or preferences. Confirmed threat reviews expire within 24 hours; cached copies are usable for at most 15 minutes before refresh. Successful AI advice expires after 24 hours. Unknown, expired and unavailable results are not safety guarantees.

The service deletes raw reports after 30 days. Reviewers may retain consented, minimized, labeled features in a versioned example set until revoked. Shared AI advice expires after 24 hours; short-lived failed reservations and two-day quota counters are cleaned on the daily retention job. Revoked installation tokens cannot use the service. Ask the XeluLabs beta administrator who issued your invitation to revoke an installation, report, or reviewed example. The beta is invite-only; no public privacy contact or Web Store release is configured yet.

Installation credentials are individually issued, stored as hashes server-side, and restricted to trusted extension contexts locally. Provider configuration already saved for personal/local AI remains separate. Application logs do not contain request bodies, raw report URLs, tokens or model prompts. The CLI intentionally displays a newly issued invitation once for private delivery. Infrastructure providers may retain operational metadata under their terms.

## Limits and controls

AI is advisory: it cannot change scores, authorize or interrupt submissions, or label a threat as confirmed. The managed service starts behind an independent-evaluation gate. Reviewers must verify reports and choose exact-link or exact-hostname scope. Feedback counts, dismissals, trust actions and submission overrides never become training labels automatically. No model-weight training occurs in this release.

Host access is requested only for the exact configured HTTPS Workers origin. The manifest declares an optional Workers.dev pattern so a privately deployed beta can be configured; no Workers host access is granted by default. Disable individual cloud switches or remove host access to stop requests. Local cache clearing does not delete reports already explicitly submitted to the service.

Cloudflare's current Workers AI handling is documented at https://developers.cloudflare.com/workers-ai/platform/data-usage/. The extension's single purpose remains phishing protection; data is not sold or used for advertising. Before public distribution, publish this policy on the organization's website with a working privacy contact and ensure the store disclosures match the actual deployment.
