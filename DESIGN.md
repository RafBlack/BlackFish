# BlackFish / xelulabs visual system

Reference: user-supplied homepage and Xelu speech-bubble screenshots, visually inspected in the conversation. Source: https://github.com/RafBlack/xelulabs/tree/e7d8cceece9b15b24afba33a77e3138b4cc0d58c (24 October 2026). No deployed-site URL was supplied; source CSS and supplied screenshots are the reference.

## Extracted identity

- Background #0b0b0c, bubble background #0c0c0d.
- Main ink #f2f2ef; secondary heading #b8b8bc; cyan #7fd3d8.
- Dot grid: source uses 2px marks at 32px spacing with base RGB 38,38,42.
- Xelu: exact 40x40 BIG_ORCA pixel map and HEAD_COLORS, rendered as SVG runs without resampling. Colors #4a4a52, #f2f2ef, #63636c, #2e2e33, #0c0c0d, #6e6e78.
- Glitch edges #8a2d45 and #2d7f86; restrained static shadows rather than continuous animation.
- Original three-path Xelu mark from logoPaths.ts; org favicon geometry is also retained.
- Silkscreen for identity headings, JetBrains Mono for labels and terminal copy, Barlow for readable interface headings. Fonts are bundled locally with OFL licenses.
- Square buttons: off-white primary fill, dark secondary outline.
- Speech bubble: 2px off-white border, dark background, two descending square tail pixels.

## BlackFish application

The popup is 400px wide, with a 160px Xelu scene and a scrollable 600px maximum height. Assessment, evidence, and actions remain distinct from the mascot's short message. Settings use the website's wide hero and an indexed configuration column, collapsing to one column on mobile. The full submission warning uses an 880px maximum two-column scene/detail panel and a stacked layout on small viewports. Page banners are compact bottom-right panels, isolated below the full-warning layer.

Risk color is semantic: cyan for local/neutral, amber #e7c38d for medium risk, pink #ed9cae for high risk. These two risk accents and the component dimensions are extension adaptations, not claimed original website tokens.

## Accessibility and runtime constraints

Warnings keep explicit risk labels and action text. Cancellation remains the default focused action; keyboard trapping, Escape, and one-time approval semantics are preserved. Mascot SVG is decorative. No typewriter delays, surprise sound, or continuous glitch motion. Reduced motion is respected.

Extension pages load packaged fonts. In-page overlays use the system monospace stack to avoid host-site font CSP restrictions and new web-accessible-resource permissions; the exact mascot and mark render inline without asset requests. Page-derived reasons are inserted as text nodes.

## Provenance

See assets/SOURCE.md for exact original files. The local pixel map is the original character, not an AI reinterpretation. Mascot warning copy is newly written for the detector and never substitutes for an explicit scan result.
