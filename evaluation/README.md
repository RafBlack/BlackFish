# Evaluation baseline

corpus.json contains 300 **synthetic** examples: 200 benign and 100 phishing. Fifteen manually specified scenario families each have twenty deterministic variants. The labels describe intended behavior; they are not generated from classifier output. Some synthetic suffixes are intentionally non-resolving. Every resource is fulfilled locally during evaluation.

The tuning split has 100 benign and 60 phishing examples. The evaluation split has 100 benign and 40 phishing examples. Family IDs and registrable domains cannot overlap the splits; both the evaluation runner and a unit test enforce that rule. Variants within a family remain correlated. This is a regression corpus, not an independently collected or representative security benchmark.

Run npm run evaluate to rebuild the evaluation bundle, execute shared detection and submission policy in Chromium, and replace latest-report.json. The report includes the corpus SHA-256, browser version, individual results, false warnings, precision, recall, benign/phishing interruption rates, and scan latency. Latency is wall time including idle scheduling; it is not a measure of main-thread blocking.

The initial measured baseline warned on 100/100 synthetic phishing examples and 20/200 benign examples. All twenty false warnings came from cross-site HTTPS SSO forms. No benign submission was interrupted. Phishing interruption rate was 60%: the balanced guard intentionally requires stronger evidence than a warning.

This false-warning rate is a known limitation, not evidence that those SSO flows are phishing. Independent real-world page sets and legitimate login integrations are needed before a broader release. Results from the small held-out split must not be advertised as production accuracy.

For offline AI comparison, run node scripts/export-ai-evaluation.mjs. This exports only synthetic held-out hostname/rule IDs and bounded semantic text, never user pages. There are no model calls. Collect reviewed model responses separately as a JSON object mapping IDs to {\"escalate\":true|false,\"reason\":\"at most 300 characters\"}, then run npm run evaluate -- --ai-results FILE. The runner reports the counterfactual warning metrics; live AI remains advisory-only regardless of results. No model has been evaluated or approved for automatic escalation.
