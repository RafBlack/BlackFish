# Contributing to BlackFish

BlackFish is a personal beta from xelulabs focused on login and credential phishing. Useful contributions include reproducible bugs, clear warning text, minimized detection fixtures, accessibility improvements, and fixes that preserve local protection and explicit consent.

## Start with a reproducible example

Use the [issue chooser](https://github.com/RafBlack/BlackFish/issues/new/choose) for bugs, detection feedback, or feature requests. Check the [documented scope](README.md#scope-and-current-limits) and existing issues first. Discuss changes to permissions, dependencies, detection policy, or cloud behavior before implementing them.

Public issues are not the invited service's report queue. They do not confirm a threat, authorize example reuse, or train a model. Remove credentials, keys, installation tokens, private URLs, query tokens, and account details from anything you share. Prefer controlled HTML fixtures and reserved example domains; do not ask contributors to visit live phishing pages.

### Vulnerabilities in BlackFish

For a suspected vulnerability in the extension or backend, use **Security → Report a vulnerability** on the repository if private reporting is available. If it is unavailable, open an issue containing only a request for a private reporting channel. Keep exploit details, affected private systems, and credentials out of that public request. A missed detector warning can be submitted through Detection feedback using a controlled reproduction.

## Set up the extension

Use Node.js 20 or newer and desktop Chrome 116 or newer. From the repository root:

```sh
npm ci
npm run build
npx playwright install chromium
```

Load `dist/` through `chrome://extensions` with Developer mode enabled. After source changes, rebuild, reload the extension, and refresh existing tabs. There is no development server or lint command configured. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if the local execution policy blocks their PowerShell shims.

See the [project map](README.md#project-map) and [detection reference](docs/DETECTION.md) before changing scan state, evidence, or submission guards.

## Validate the change

| Change | Relevant checks |
| --- | --- |
| Extension logic or packaging | `npm test`, `npm run build`, and `npm run test:browser`. |
| Detection, domains, scoring, or guards | The extension checks plus `npm run evaluate` and `npm run evaluate:branding`; inspect benign findings and interruption changes. |
| Popup, settings, or in-page interface | The extension checks plus desktop 1440px and mobile 390px review, including console errors and overflow. |
| Backend | Root `npm ci`, then `cd backend`, `npm ci`, `npm test`, and `npm run deploy:check` using Node.js 22.16 or newer. |
| Documentation or repository configuration | Verify links, commands, metadata, and configuration syntax. Run affected commands when changing CI. |

`npm run check` combines unit tests, browser regressions, and the 300-case synthetic evaluation. Browser fixtures are served locally. On Linux, `npx playwright install --with-deps chromium` also installs browser system dependencies.

The evaluations rewrite tracked JSON reports. Review those changes separately and include regenerated reports only when they support an intentional detection or measurement change. The form-branding comparison can complete successfully with a failed promotion gate while its candidate remains disabled. A passing synthetic run does not establish real-world accuracy or AI benefit; see the [evaluation guide](evaluation/README.md).

Backend tests use local SQLite and fake model responses. The deployment dry-run checks the bundle without deploying it. Do not run remote migrations, deploy the service, issue real invitations, or collect hosted-model responses as part of routine contribution checks. Follow the [backend guide](backend/README.md) for separately authorized operator work.

## Preserve the product's guarantees

- Keep local checks usable offline. Optional service failures must leave local protection running.
- Keep evidence bound to the inspected document and frame; repeat scans must not accumulate points.
- Keep submission overrides single-use and destination-bound. Cancellation must not approve a later submission.
- Keep exact-origin trust separate from protected-domain identities and reviewer-confirmed reputation.
- Keep AI advisory-only, optional, and limited to the documented metadata. It must not change scores or authorize a submission.
- Keep credentials, raw field values, private reports, browser profiles, generated bundles, and local deployment configuration out of source control.

## Prepare a focused pull request

Use a conventional title such as `fix:`, `feat:`, `docs:`, or `test:`. Explain the problem and resulting behavior, include the relevant validation, and disclose failed or skipped checks. Add a regression that demonstrates a meaningful behavior change when appropriate; documentation-only edits do not need application tests.

Keep unrelated cleanup and dependency upgrades separate. Preserve the bundled third-party notices and font licenses, and use the [asset provenance](assets/SOURCE.md) when working with Xelu or the xelulabs mark. The repository does not currently declare a project-wide license; coordinate licensing and reuse questions with the maintainer before contributing third-party material.
