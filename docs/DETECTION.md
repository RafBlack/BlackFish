# Detection reference

For setup and user-facing behavior, start with the [README](../README.md). The [evidence policy](../evaluation/SCORING.md) documents every diagnostic weight, action rule, and supporting source. This reference describes the current implementation, not a guarantee of coverage or production accuracy.

## Local analysis

URL checks begin after the worker returns exact-origin trust configuration. Domain parsing uses bundled `tldts` with private suffix handling, separating tenants such as `victim.github.io` and `attacker.github.io`. IDNs are decoded with Punycode.js and compared using pinned Unicode 17 confusable skeleton data. Internationalization alone contributes no risk. Approved brand families describe identity relationships and do not bypass other detectors.

DOM analysis looks for visible password fields, explicit `autocomplete="one-time-code"` fields, credential destinations, title/metadata brand claims, displayed link mismatches, and contextual iframe/download evidence. Discovered open shadow roots and externally associated form controls are included. The heading/legend/accessibility-name branding candidate remains disabled after its failed promotion gate.

Sources replace their previous evidence snapshots. Rule IDs contribute once per document; only the strongest identity contribution counts, and weak support totals at most 20. Frame indices are never summed: the page index is the highest individual frame index, and identity in one frame cannot corroborate credentials in another. Removing evidence can lower the index and clear obsolete warnings. The index is diagnostic and does not control submission policy.

## Document lifecycle and bounds

Chrome supplies the tab, frame, and document identity. The worker checks active documents, scan revisions, and configuration tokens before accepting evidence. Frames keep separate snapshots, and only the top document renders page-wide warnings and submission dialogs. The extension popup and toolbar remain authoritative because a hostile page can hide the in-page host.

Document and discovered open-root mutations refresh snapshots, including relevant attributes and text. Debouncing waits 250 ms with a 1,000 ms maximum delay; a 15-second visible-page pass discovers newly attached roots that produce no DOM mutation. Navigation, page restoration, visibility changes, and explicit rescans reconcile state. Back-navigation recovery is tested; it does not prove native BFCache or prerender activation on every supported Chrome version.

| Bound | Limit |
| --- | ---: |
| Elements | 6,000 |
| DOM roots | 40 |
| Forms | 100 |
| Retained controls per form | 100; credential controls prioritized while inspecting at most 6,000 |
| Anchors | 800 |
| Iframes inspected per document | 100 |
| Retained frame snapshots per tab | At most 64 |

Anchor work yields in 6 ms chunks. Reaching bounds displays partial coverage. Rescan requests acknowledge completion rather than relying on a timed popup poll. Navigation observations are limited committed-navigation context, not a complete HTTP redirect chain.

## Submission decisions

The guard inspects the actual form and submitter, resolving base URLs, external controls, and submitter overrides. It pauses supported submissions for insecure password/explicit OTP collection or strong domain impersonation with credential collection in the same document. A title or heading claim alone cannot authorize an interruption; cross-site HTTPS submission alone is a passive notice. Parent or sibling identity evidence cannot authorize an unrelated child form interruption.

Approval is single-use and bound to the form, submitter, destination, and evidence fingerprint. Canceling grants no override. Resumption uses `requestSubmit()` to preserve validation, submitter data, and normal handlers. Direct native submission, JavaScript exfiltration, closed roots, and earlier handlers remain coverage gaps.

## Storage and optional advice

Minimal document/frame verdicts, navigation context, personal-AI request reservations, and budgets use `chrome.storage.session`, surviving worker restarts but clearing on browser restart or extension reload. Verdict storage does not persist full navigation URLs, titles, HTML, or field values. Trust/settings writes are serialized; invalid legacy entries are excluded and surfaced for review. Local storage is restricted to trusted extension contexts, and content scripts receive only public scan configuration.

Threat, advice, and capability caches use persistent local storage with a combined 3 MiB/5,000-entry limit. Expired records are evicted first, then least recently used entries; settings and credentials remain outside eviction. Threats require revalidation within 15 minutes, even when the review expires later. Unknown or expired findings never mean safe. See the [privacy policy](../PRIVACY.md) and [backend operations guide](../backend/README.md) for review scope, revocation, and retention.

AI is disabled by default and advisory only. Eligibility uses the top document's diagnostic index of 20-54 and sends only that document's hostname, rule IDs, and credential presence. Keys include normalized input and rules/provider/model/prompt/example versions; stale-document results are rejected. A changed rules version invalidates obsolete advice, including saved document advice.

Personal AI permits one request per document/evidence fingerprint, one in-flight request per tab, at most eight fingerprints per document, and thirty requests per browser-session hour. Reservations survive worker restarts; interrupted requests do not automatically retry. The three-second total deadline covers bounded response reading and parsing. Responses require an actual boolean and a reason of at most 300 characters; redirected requests fail. Provider keys are stored in the browser profile, not encrypted in a secrets vault.

Shared reputation waits at most one second, and managed AI has a three-second total budget. Outages, timeouts, and exhausted quotas leave local protection running. Managed AI has separate consent, quotas, and an independent-evaluation gate; local/personal providers are not enabled as automatic fallbacks. The [backend evaluation guide](../backend/evaluation/README.md) defines the required reviewed dataset. Synthetic regressions cannot satisfy that requirement.
