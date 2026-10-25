# Evidence policy and diagnostic index

BlackFish reports observed credential-phishing indicators and a recommended action. It does not calculate the probability that a site is malicious, assess every link, or measure overall website security. The policy is product judgment under evaluation. The diagnostic weights are hand-set, uncalibrated tuning values, not values supplied or validated by a security standard.

## User-facing policy (rules version 3)

| Evidence | Presentation | Supported submission policy |
| --- | --- | --- |
| Fresh reviewer-confirmed exact-link or exact-host match | Confirmed phishing warning takes priority, including at index zero | Reputation alone does not interrupt |
| Password or explicit sign-in code on HTTP, an HTTP destination, or unsupported destination scheme | Insecure credential collection warning; does not assert phishing | Pause for a deliberate one-time decision |
| Protected-domain confusable, typo, or brand subdomain plus credential collection in that same document | Impersonation indicators warning | Pause the affected credential form for a one-time decision |
| Domain mismatch without credentials, or a title/metadata brand claim | Address/branding warning with uncertainty | No interruption from a brand claim alone |
| Cross-site HTTPS credential destination without the above | Passive destination notice in popup; legitimate SSO is possible | Allow |
| Displayed link destination mismatch alone | Passive notice about that link | Allow |
| Weak URL patterns or contextual observations alone | No strong indicators observed, with scope and scan status | Allow |

Exact-origin trust pauses protection. Failed, unavailable, scanning and partial coverage stay explicit. No alert means no matching alert policy, never a safe verdict. In-page warnings can be hidden by a hostile page; the extension popup and badge remain the authoritative interface. AI advice cannot alter this policy, scores, or approvals.

Evidence from separate frames cannot corroborate credential theft. Frame attribution is retained; the page index is the maximum single-frame index. The guard inspects the actual form and submitter in its own document. Parent or sibling impersonation evidence does not authorize interruption of an unrelated child login. A hostile wrapper around a legitimate embedded identity provider may therefore warn about the wrapper without interrupting the provider.

## Technical index

| Rule | Weight | Group |
| --- | ---: | --- |
| `homograph-domain` | 45 | identity |
| `typosquat-domain` | 40 | identity |
| `brand-in-subdomain` | 35 | identity |
| `brand-name-domain-mismatch` | 30 | identity |
| `cross-origin-credential-form` | 35 | destination |
| `insecure-credential-form` | 25 | transport |
| `credential-presence` | 15 | credential |
| `at-symbol-in-url` | 15 | support |
| `anchor-text-href-mismatch` | 10 | support |
| `ip-literal-host` | 8 | support |
| `not-https` | 6 | support |
| `deep-subdomain`, `lure-keywords` | 5 each | support |
| `abused-tld`, `excessive-hyphens` | 4 each | support |
| Brand mentions, hidden iframe/field counts, executable links | 0 | context |

Within each document, rule IDs count once, only the strongest identity rule contributes, weak support totals at most 20, and the index caps at 100. Replacement snapshots allow contributions to disappear. Destination/transport signals already imply credential context: the index deliberately remains a diagnostic sum, not a model of independent events. Contributions shown for different frames must not be summed.

The legacy LOW/MEDIUM/HIGH index buckets (30/55 cutoffs) remain internal diagnostics, not user-facing risk levels. The 20–54 AI eligibility range remains for the top document's own evidence only. The index is collapsed under Technical evidence. Keywords cannot turn SSO into an alert or authorize a submission pause. Version 3 invalidates older advice keys and document advice snapshots. Form-heading branding remains disabled after its separate failed promotion gate.

## Basis and limits

- [FIRST CVSS v4 user guide](https://www.first.org/cvss/v4.0/user-guide#cvss-base-score-cvss-b-measures-severity-not-risk): CVSS describes vulnerability severity; its Base score alone is not a risk assessment. BlackFish does not use a CVSS vector or claim CVSS compliance.
- [OWASP TLS guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html#use-tls-for-all-pages): HTTP permits interception and modification, supporting a distinct credential-transport policy. This does not establish that an HTTP page is phishing or make BlackFish a certificate scanner.
- [Unicode UTS #39](https://www.unicode.org/reports/tr39/#Confusable_Detection): confusable detection identifies possible spoofs, with legitimate confusables and false positives possible. BlackFish uses pinned Unicode 17 data; internationalization alone is not a phishing finding.

These sources support concepts, not BlackFish's numeric weights, thresholds, or claimed detection accuracy. The 300-case synthetic regression set checks intended behavior; it cannot calibrate real-world risk. Warning metrics now count actual banner/badge alerts and report passive destination notices separately. Historical index-threshold metrics are retained as history, not directly comparable claims of improved accuracy. Before calibration or public accuracy claims, collect independently reviewed benign/phishing pages, separate domains/templates, and measure false warnings, interruptions, unseen-threat recall, and score calibration on held-out data.
