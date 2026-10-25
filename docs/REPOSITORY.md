# BlackFish repository setup

Ready-to-copy GitHub presentation and maintainer settings for [RafBlack/BlackFish](https://github.com/RafBlack/BlackFish). Committing these files does not change GitHub's About panel, social preview, or repository settings.

## About panel

**Description**

```text
Local-first Chrome extension for login and credential-phishing checks. Xelu explains suspicious addresses and forms. Optional AI, advisory only. By xelulabs.
```

**Website**

```text
https://github.com/RafBlack/xelulabs
```

**Topics**

```text
chrome-extension
manifest-v3
phishing-detection
credential-phishing
browser-security
privacy
local-first
javascript
xelulabs
```

Edit these through the gear beside **About** on the repository homepage. Keep the personal-beta status in the README; there is no Web Store listing or public service URL to advertise yet.

## Social preview

Upload [blackfish-social-preview.png](images/blackfish-social-preview.png) through **Settings → General → Social preview → Edit**. It uses the existing Xelu artwork, xelulabs mark, local fonts, and BlackFish palette; see [asset provenance](../assets/SOURCE.md).

The image is 1280 × 640 with a solid background, matching [GitHub's recommended display size](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview). It is documentation artwork and is not bundled into the extension.

## Repository files

| File | Purpose |
| --- | --- |
| [README](../README.md) | Product overview, installation, warning meanings, privacy, and current limits. |
| [Contributing](../CONTRIBUTING.md) | Local setup, change-specific validation, feedback, and private-reporting guidance. |
| [Issue forms](../.github/ISSUE_TEMPLATE/) | Bug reports, detection feedback, and feature requests with sanitized examples. |
| [Pull request template](../.github/pull_request_template.md) | Problem, behavior, validation, and privacy implications. |
| [Code owners](../.github/CODEOWNERS) | Repository ownership assigned to `@RafBlack`. |
| [CI workflow](../.github/workflows/ci.yml) | Extension unit/build checks on Node 20/22/24, Chromium regressions and both evaluations, and backend tests plus deployment dry-run on Node 22. |

The workflow uses a read-only repository token and disables persisted checkout credentials. Pull requests run without deployment credentials. Browser setup follows the [Playwright CI guide](https://playwright.dev/docs/ci-intro); action configuration follows the official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) documentation.

## Maintainer decisions

- **First hosted run:** after publishing the files, inspect CI in GitHub Actions. Local Windows checks do not prove a hosted Linux run or every Node matrix version passes. Add required status checks only after their real check names appear.
- **Private reporting:** enable GitHub private vulnerability reporting under the repository's security settings if it is available, then verify that contributors can see **Report a vulnerability**. No private reporting channel or response-time commitment is assumed by these files.
- **Licensing:** choose a project-wide license deliberately, including how original Xelu artwork and the xelulabs mark are treated. No license has been selected here. Existing third-party notices and font licenses remain applicable to their respective files.
- **Public distribution:** publish a working public privacy contact and matching store disclosures before advertising a Web Store release or public hosted service.
