# Manual test matrix

BlackFish assesses credential-phishing indicators. A LOW result does not assess TLS certificates, non-credential mixed content, malware, or download safety. A risk indicator is not a phishing probability.

Build with `npm run build`, reload the unpacked extension, and refresh existing tabs. Keep cloud features and AI off for the local baseline. Use only placeholder values in controlled fixtures; submission protection is verified by the browser tests without contacting remote collection endpoints.

| Case | Expected result | What it establishes |
|---|---|---|
| [AMTSO phishing feature check](https://www.amtso.org/feature-settings-check-phishing-page/) | Unsupported agreed-URL test; no special-case warning | AMTSO describes a harmless address recognized by participating products. This is not a sample of unfamiliar credential theft. |
| [BadSSL certificate and TLS tests](https://badssl.com/) | Chrome handles connection failures; BlackFish reports failed/unavailable when the page cannot be scanned | No certificate, cipher or TLS validation claim. Do not bypass the browser interstitial for acceptance testing. |
| BadSSL mixed-script, mixed-image and mixed-favicon | No phishing warning solely for mixed resources | Non-credential mixed content is outside this detector. |
| [BadSSL mixed-form](https://mixed-form.badssl.com/) | No credential interruption for its ordinary text field | A text form posting to HTTP is not a password/OTP form. |
| HTTP password page, or HTTPS password form posting to HTTP | Transport warning and supported submission interruption | Test locally with `npm run test:browser`; it captures the submission without sending credentials. |
| Strong lookalike domain collecting same-site credentials | Warning and deliberate one-time submission approval | Local impersonation evidence and credential collection agree. Cancel never approves a later attempt. |
| Legitimate cross-site HTTPS SSO | May retain the documented baseline warning; no automatic interruption from the cross-site form alone | A cross-site destination is not proof of phishing. |
| Generic-title login claiming a protected brand in a heading/legend/accessibility label | Offline candidate evaluation only | The candidate adds detections but also warns on a legitimate custom-domain enterprise example, so it is disabled. |
| Article mentioning brands, logo alone, hidden or oversized context, approved brand family/payment embed | No new branding weight | Context is bounded and tied to a credential form. Logos alone cannot establish an identity claim. |
| Large page | Explicit partial scan status | Limits are disclosed; remaining content is not assumed safe. |
| Unsupported/browser page, failed request, or blocked navigation | Failed/unavailable status and no completed clean assurance | Failure does not establish safety. |

For each manual result record the exact test URL, Chrome version, whether Chrome stopped loading, BlackFish state, contributing rules, and whether the submission guard ran. Do not record real field values or private account URLs.

## Detection candidate gate

Run `npm run evaluate:branding`. It compares the current rules with bounded form-context branding on the original 300 synthetic cases plus 24 targeted cases, using the same scanner and submission policy. All resources are fulfilled locally; no model or hosted service is called.

The report is `form-branding-report.json`. A successful command means the evaluation completed; `gate.passed` decides promotion. The candidate stays disabled when it introduces any benign warning or interruption, loses an existing phishing detection/transport interruption, or adds no targeted phishing detection. Improvements cannot offset a new false warning elsewhere.

The initial gate fails on the enterprise-owned login using Microsoft branding outside Microsoft's approved domains. These observable inputs cannot distinguish that legitimate synthetic flow from an impersonating page. This counterexample is retained rather than removed to obtain a pass. The measured report contains exact gains, blocker IDs and timings.

Future promotion requires passing the gate, switching `FORM_BRANDING_ENABLED` and incrementing `RULES_VERSION` together, then rebuilding and rerunning the full suite. No live AI payload, request trigger, consent or submission-approval policy changes with this experiment. Independent reviewed real-world evaluation remains necessary before accuracy or beta-readiness claims.
