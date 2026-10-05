# BlackFish — Real-Time Phishing Detector

A Chrome (MV3) extension that flags phishing attempts as pages load, using
local, explainable heuristics. No page content leaves your machine unless
you explicitly opt in to AI-assist, and even then only a small metadata
summary is sent, only for borderline cases.

## Load it (unpacked, for development)

1. `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Visit any site — the toolbar badge shows a live risk score; click the
   icon for a breakdown.

## Architecture

```
manifest.json
background/service-worker.js   — webNavigation redirect tracking, per-tab
                                  verdict cache, badge, allowlist storage,
                                  optional AI-assist relay
content/
  content-script.js            — orchestrator: 2-phase scan, MutationObserver,
                                  messaging
  dom-scanner.js                — forms / anchors / iframes / branding checks
  form-guard.js                 — submit-time capture-phase interception
  overlay.js                    — closed-shadow-DOM banner & interstitial UI
lib/heuristics/
  url-analysis.js               — IP hosts, punycode, TLD abuse, lure words
  lookalike-domain.js           — edit-distance + homoglyph typosquat check
  brand-list.js                 — bundled reference domains + lure keywords
  score.js                      — weighted aggregation → LOW/MEDIUM/HIGH
popup/, options/                — UI
```

### Two-phase scanning (the low-latency part)

* **Phase 1 — `document_start`, URL only.** No DOM dependency, so a
  lookalike domain can be flagged before the page paints. Cost: a handful
  of string comparisons against ~80 bundled brand domains — sub-millisecond.
* **Phase 2 — DOM-dependent, once available.** Bounded checks (forms,
  iframes, title/meta) run synchronously; the unbounded one (anchor
  text-vs-href across every link on the page) is chunked through
  `requestIdleCallback` with a hard cap, so a link-heavy page never blocks
  scrolling or paint.
* A `MutationObserver` (debounced 800ms) re-runs only the bounded checks
  when a page injects new forms/iframes after load — common in SPA phishing
  kits that build the fake login widget client-side.

### Why the warning UI can't be hidden by the page it's warning about

`overlay.js` renders into a **closed-mode Shadow DOM**
(`attachShadow({mode:"closed"})`). A page's own JavaScript cannot reach
into a closed shadow root — `element.shadowRoot` returns `null` — so a
phishing page can't find-and-remove or hide the warning banner the way it
could a plain `<div>`.

### Permission model (least privilege)

| Permission | Why | What it avoids |
|---|---|---|
| `storage` | allowlist, custom brands, settings | — |
| `activeTab` + `scripting` | popup-triggered rescan | broad `tabs` access |
| `webNavigation` | redirect-chain analysis | **no host permission needed at all** — this is the main reason `webRequest` (which needs broad host access + is deprecated for blocking in MV3) was avoided |
| static `content_scripts` matches | real-time, automatic scanning | this is the one broad-ish grant; see below for the trade-off |
| `optional_host_permissions` (api.x.ai, localhost) | AI-assist | not granted at install — requested via `chrome.permissions.request()` only when the user turns the feature on, for that one endpoint only |

No `webRequest`, no `<all_urls>` host permission for background fetches, no
`cookies`, no `history`, no remotely-hosted code (disallowed by MV3 anyway,
but worth stating as a design choice, not just a platform constraint).

**Trade-off worth knowing:** automatic, real-time scanning on every page
requires content scripts to run on `http(s)://*/*`. That's the cost of
"real-time" as opposed to "on-demand." If you want a stricter posture,
drop the static `content_scripts` block, keep `activeTab` + `scripting`,
and trigger scans from the popup/toolbar click instead — the detection
modules themselves don't care how they're invoked.

## Detection techniques implemented

- Typosquat / edit-distance + homoglyph domain comparison
- IDN homograph (punycode) detection
- IP-literal hosts, `@`-in-URL, excessive subdomains/hyphens
- Abused-TLD and credential-lure-keyword scoring
- Redirect-chain analysis (cross-domain hop counting)
- Credential form action mismatch (cross-origin / non-HTTPS / hidden-field
  stuffing), checked both at scan time and at submit time (capture phase,
  before page JS can alter the form)
- Anchor text vs. href mismatch ("says paypal.com, links elsewhere")
- Executable-file download links
- Brand-name-vs-domain mismatch (page calls itself "PayPal", isn't on
  paypal.com)
- Hidden/near-zero-size cross-origin iframes
- Optional AI-assist second opinion for borderline scores only

## Known limitations / good next steps

- `lookalike-domain.js` and `url-analysis.js` use a small bundled brand
  list and a simplified public-suffix check — swap in the real
  [Public Suffix List](https://publicsuffix.org/list/) and a larger brand
  set for anything beyond a learning project.
- No `declarativeNetRequest` blocklist yet — would let you hard-block known
  bad domains rather than just warn.
- Redirect tracking is main-frame only; sub-frame (ad/iframe) redirect
  abuse isn't covered.
- The "obfuscated inline script" heuristic was deliberately **left out** —
  it has a high false-positive rate against ordinary minified bundles. If
  you add it, weight it low and treat it as supporting evidence only.
- AI-assist is a single-shot classifier call, not a multi-step "agent" —
  that's intentional. An agentic tool-loop would add latency the real-time
  path can't afford; keep AI usage narrow and optional.
