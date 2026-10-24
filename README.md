# BlackFish personal beta (0.2.0)

BlackFish detects signs of login and credential phishing using local, explainable URL and DOM analysis. AI is disabled by default and provides optional advice only. A score is a risk indicator, not a phishing probability or a guarantee of safety.

The interface follows xelulabs' original visual identity: Xelu's pixel-art mascot, the Xelu mark, dark dot-grid surfaces, terminal typography, and square speech bubbles. Xelu appears in the popup, page banners, full submission warnings, and settings. All art and fonts are packaged locally. See DESIGN.md and assets/SOURCE.md for the reference and attribution. To regenerate the toolbar PNG icons from the original SVG mark, run node scripts/brand-icons.mjs.

## Build and load

Use Node.js 20 or newer:

    npm ci
    npm run build

In Chrome, open chrome://extensions, enable Developer mode, choose **Load unpacked**, and select **blackfish**. Its manifest and UI load the generated JavaScript from dist, so Chrome never attempts to resolve npm imports from the source files. After editing, build again, reload the extension, and reload existing web tabs. Existing injected scripts from an earlier extension version cannot be upgraded in place.

The generated **blackfish/dist** folder is also independently loadable and is the self-contained package to copy or distribute. Its generated manifest and HTML reference bundles within that folder. No remote JavaScript or build-time network requests are required after npm ci. Unicode data is vendored and pinned.

If Chrome reports "Failed to resolve module specifier tldts" or service-worker registration status 15, it is loading an old manifest or unbundled source. Run npm run build, click Reload on the BlackFish card in chrome://extensions, and refresh your web tabs. You can keep the existing blackfish folder installation; removing the extension is unnecessary.

## Detection and scoring

URL checks run as soon as the worker returns the exact-origin trust configuration. DOM scans cover visible password fields and explicit autocomplete="one-time-code" fields, form destinations, declared branding, displayed link destinations, and contextual iframe/download information. Open shadow roots and externally associated form controls are included within scan limits.

Each source replaces its previous snapshot. Rule IDs contribute once across elements and frames. Related impersonation rules contribute only their strongest weight; all weak supporting indicators together contribute at most 20. MEDIUM starts at 30; HIGH at 55. The popup displays actual contributions and frame attribution. Removing evidence lowers the score. Internationalized domains, hidden fields, hidden iframes, and executable links do not independently imply phishing.

Domain boundaries use bundled tldts with private suffixes enabled, so separate github.io tenants are separate sites. IDNs are decoded with Punycode.js and compared using pinned Unicode 17 confusable skeleton data. Approved brand families are explicit identity references, not unconditional exemptions from other checks.

The guard interrupts supported submit events for insecure password entry/transport or strong domain impersonation corroborated by credential collection and a HIGH score. A cross-site HTTPS destination alone warns; it does not interrupt. Approval is scoped to one form, submitter, inspected destination, and evidence fingerprint. Cancel grants no approval. Resumption uses requestSubmit to preserve validation, submitter data, and site handlers.

## Document state and scanning

The worker derives tab/frame/document identity from Chrome, verifies active documents, and rejects stale revisions and obsolete configuration tokens. Frames retain separate snapshots; a clean iframe cannot overwrite a dangerous parent. Top-level pages render aggregate warnings and submission dialogs. The popup and toolbar are authoritative extension UI.

Minimal verdict snapshots, navigation context, AI request reservations, and AI budgets persist in storage.session across worker restarts. They clear on browser restart or extension reload. Full navigation URLs, titles, HTML, and field values are not persisted in verdict storage. No complete HTTP redirect-chain claim is made: webNavigation provides limited committed-navigation context.

Scans observe document and discovered open-root child, attribute, and text changes. Debouncing is 250 ms with a 1,000 ms maximum wait. A 15-second visible-page discovery pass covers roots attached to existing hosts without a DOM mutation. Navigation, BFCache restoration, visibility changes, and user rescans refresh snapshots. Rescan acknowledges completion rather than polling for an arbitrary delay.

Limits: 6,000 elements, 40 DOM roots, 100 forms, 100 retained fields per form (credential fields prioritized while inspecting up to 6,000 controls), 800 anchors, 100 iframes, and at most 64 retained frame snapshots. Anchor work yields in 6 ms chunks. Reaching a limit displays partial coverage.

## Trust and settings

Trust is exact-origin, including scheme and port. Trusting a top-level origin pauses its scans and guard, including embedded frames. Trusting a child origin pauses only that origin when embedded elsewhere. Removing trust updates existing pages. User settings writes are serialized.

Legacy allowlists and protected domains are validated and normalized; rejected entries appear in migration notices. Legacy AI enablement is reset once during migration so users can review the advisory-only behavior. Local storage is restricted to trusted extension contexts. Content scripts request only public trust and protected-domain configuration; they cannot read the API key.

Only storage and webNavigation permissions are required. Static content scripts still run on http(s) pages for automatic protection. Optional host access is limited to api.x.ai and HTTP localhost/127.0.0.1 model endpoints. There is no background all-sites fetch permission.

## Experimental AI

AI advice appears only in the popup. It adds no score and cannot block, approve, or suppress a submission. Live metadata is limited to hostname, matched rule IDs, and credential presence. Raw titles, full URLs, page text, HTML, field values, and credentials are excluded. Hostnames can still reveal browsing interests. Keys remain in this browser profile and are not encrypted in a secrets vault.

Only configured xAI HTTPS or HTTP localhost/127.0.0.1 OpenAI-compatible endpoints are supported. A model name is required; local models may omit a key. Permission is requested when saving enabled AI. Responses require a real boolean and a reason of at most 300 characters. The three-second deadline covers reading and parsing at most 16 KiB. Redirected API requests fail.

One request per document/evidence fingerprint, one in-flight request per tab, at most eight fingerprints per document, and thirty requests per browser-session hour. Request reservations and outcomes survive worker restarts. Interrupted reservations are not automatically retried. Turning AI off or changing settings cancels current requests. No claim of additional detection value is made.

## Validation

    npm test
    npx playwright install chromium
    npm run test:browser
    npm run evaluate

Browser tests use Playwright's bundled Chromium in a fresh headless profile. All HTTP(S) page resources are fulfilled from controlled fixtures. They do not contact live phishing sites or submit real credentials. Screenshots are written to test-results/.

The corpus has 200 benign and 100 phishing synthetic scenarios. Tuning/evaluation domains and template families are disjoint, but parameter variants within a family are correlated. See evaluation/latest-report.json and evaluation/README.md. These tests do not establish real-world accuracy.

To compare offline AI advice:

    node scripts/export-ai-evaluation.mjs
    npm run evaluate -- --ai-results PATH_TO_RESPONSES.json

Exported semantic cues come only from synthetic held-out fixtures. The exporter makes no network calls. Responses map fixture IDs to {"escalate": boolean, "reason": "bounded explanation"}. AI is not promoted automatically.

## Coverage limitations

- Direct native form.submit(), fetch/XHR/WebSocket credential exfiltration, and earlier window/page handlers can bypass event interception. Page handlers may change destinations after the guard runs. This is not a network firewall.
- Closed page shadow roots are inaccessible. Newly attached open roots may not be discovered until a mutation or periodic pass. Bounds can leave fields and elements unexamined.
- Browser-internal/error pages, the Web Store, some viewers, sandboxed opaque frames, and unsupported documents cannot be fully scanned.
- Page-controlled styling, fullscreen/top-layer elements, or removal of the closed-shadow host can hide in-page warnings. Closed Shadow DOM isolates warning contents but is not a security boundary against the host page. Use the toolbar/popup.
- Cross-site HTTPS credential forms can be legitimate SSO. The baseline intentionally reports these false warnings; they are not automatically interrupted.
- Brand references are finite. Same-site phishing without protected-brand impersonation, unmarked OTP flows, compromised legitimate sites, and new attack styles may be missed.
- Real-world benign/phishing evaluation, minimum-Chrome-version testing, native prerender/tab replacement, and explicit BFCache activation verification remain release-validation work. The browser suite verifies back navigation and pageshow recovery but does not assert that Chrome used BFCache.

Wallet draining, general malware classification, screenshots/models, reputation services, WHOIS, and network blocklists remain outside this release.
