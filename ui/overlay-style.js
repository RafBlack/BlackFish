// In-page text uses the system monospace stack: no remote fonts or page permissions.
export const OVERLAY_CSS = String.raw`
:host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:dark!important}
*{box-sizing:border-box;font-family:ui-monospace,Consolas,"Liberation Mono",monospace}
:host{--bg:#0b0b0c;--ink:#f2f2ef;--muted:#a3a3ab;--line:#34343c;--cyan:#7fd3d8;--red:#ed9cae;--amber:#e7c38d}
button{font:inherit;cursor:pointer;min-height:40px;padding:10px 14px;border:1px solid #4b4b54;border-radius:0;background:transparent;color:var(--ink);line-height:1.4}
button:hover{border-color:var(--ink);background:#ffffff08}button:disabled{opacity:.4;cursor:default}
button:focus-visible{outline:2px solid var(--cyan);outline-offset:4px}
.xelu-mark{display:block;width:22px;height:22px;overflow:visible}
.xelu-mascot{display:block;width:100%;height:auto;image-rendering:pixelated;filter:drop-shadow(-1px 0 #8a2d4599) drop-shadow(1px 0 #2d7f8699)}
.brand-lockup{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.16em;color:var(--ink)}
.brand-credit{font-size:9px;color:var(--muted);letter-spacing:.1em}
.speech-bubble{position:relative;padding:12px 15px;border:2px solid var(--ink);background:#0c0c0d;color:var(--ink);font-size:13px;line-height:1.65}
.speech-bubble::before,.speech-bubble::after{content:"";position:absolute;right:25px;bottom:-9px;width:7px;height:7px;background:var(--ink)}
.speech-bubble::after{right:18px;bottom:-16px}
.eyebrow{display:flex;align-items:center;gap:10px;margin:0;color:var(--cyan);font-size:9px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase}
.eyebrow::before{content:"";width:18px;height:1px;background:currentColor;flex:none}
.banner{pointer-events:auto;position:absolute;z-index:1;isolation:isolate;right:20px;bottom:20px;width:min(440px,calc(100vw - 40px));border:1px solid #42424b;background:var(--bg);color:var(--ink);box-shadow:0 16px 48px #0008}
.banner[data-level=HIGH]{--accent:var(--red)}.banner[data-level=MEDIUM]{--accent:var(--amber)}
.banner-header{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line);gap:12px}
.banner-header .brand-lockup{font-size:10px}.banner-header .xelu-mark{width:17px;height:17px}
.banner-stage{position:relative;overflow:hidden;min-height:144px;padding:18px 136px 16px 16px;background-image:radial-gradient(#29292f 1px,transparent 1px);background-size:24px 24px}
.banner-stage .speech-bubble{font-size:12px;padding:10px 12px;z-index:1}
.banner-mascot{position:absolute;width:180px;right:-31px;bottom:-59px;pointer-events:none}
.banner-state{margin:21px 0 0;color:var(--accent);font-size:9px;line-height:1.6;letter-spacing:.06em}
.banner-reasons{margin:0;padding:14px 16px 0;border-top:1px solid var(--line);color:#b8b8c0;font-size:11px;line-height:1.8;overflow-wrap:anywhere}
.banner-actions{display:flex;justify-content:flex-end;gap:8px;padding:14px 16px 16px}
.banner-actions button{font-size:10px;min-height:35px;padding:8px 12px}
.banner-actions .dismiss{border-color:var(--ink);color:var(--ink)}
.banner-actions .trust{border-color:var(--line);color:var(--muted)}
.backdrop{pointer-events:auto;position:fixed;z-index:2;inset:0;display:grid;place-items:center;padding:24px;background-color:#0b0b0cfa;background-image:radial-gradient(#26262a 1px,transparent 1px);background-size:32px 32px;color:var(--ink)}
.card{width:min(880px,100%);max-height:calc(100dvh - 48px);overflow:auto;border:1px solid #45454e;background:#101012;box-shadow:0 24px 100px #0009}
.card-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 24px;border-bottom:1px solid var(--line)}
.card-content{display:grid;grid-template-columns:290px minmax(0,1fr)}
.card-scene{position:relative;overflow:hidden;min-height:380px;background-color:var(--bg);background-image:radial-gradient(#29292f 1px,transparent 1px);background-size:28px 28px;border-right:1px solid var(--line)}
.card-scene .eyebrow{position:absolute;top:29px;left:24px}
.card-scene .speech-bubble{position:absolute;top:79px;left:24px;right:24px;font-size:15px;z-index:1}
.card-mascot{position:absolute;width:350px;right:-40px;bottom:-95px;pointer-events:none}
.card-body{padding:31px 32px 29px}
.card-body>.eyebrow{color:var(--red)}
.card h1{margin:14px 0 17px;font-size:25px;font-weight:600;line-height:1.35;letter-spacing:-.04em;color:var(--ink)}
.description{margin:0;color:#c1c1c8;font-size:12px;line-height:1.9;overflow-wrap:anywhere}
.frame-caption{margin:14px 0 0;color:var(--muted);font-size:10px;line-height:1.7;overflow-wrap:anywhere}
.frame-caption strong{display:block;margin-top:4px;color:var(--ink);font-size:11px;font-weight:400}
.reason-heading{margin:25px 0 10px;color:var(--muted);font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.reasons{padding:0;margin:0;list-style:none;border-top:1px solid var(--line)}
.reasons li{position:relative;padding:11px 0 11px 15px;border-bottom:1px solid #29292f;color:#b8b8c0;font-size:11px;line-height:1.75;overflow-wrap:anywhere}
.reasons li::before{position:absolute;left:0;top:18px;content:"";width:4px;height:4px;background:var(--red)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:27px}
.actions button{font-size:11px;min-height:43px}
.cancel{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.cancel:hover{background:#fff;border-color:#fff}
.proceed{border-color:#3d3d45;color:var(--muted)}
.card-footer{display:flex;justify-content:space-between;gap:12px;padding:13px 24px;border-top:1px solid var(--line);color:#85858e;font-size:9px;line-height:1.7;letter-spacing:.04em}
@media(max-width:700px){.card-content{grid-template-columns:220px minmax(0,1fr)}.card-body{padding:25px 22px}.card h1{font-size:21px}.card-scene .speech-bubble{left:20px;right:20px;font-size:13px}.card-scene .eyebrow{left:20px}.card-mascot{width:290px;right:-48px;bottom:-60px}.actions{display:grid;grid-template-columns:1fr;width:100%}}
@media(max-width:540px){.backdrop{padding:14px}.card{max-height:calc(100dvh - 28px)}.card-header{padding:15px 18px}.card-content{grid-template-columns:1fr}.card-scene{min-height:175px;height:175px;border-right:0;border-bottom:1px solid var(--line)}.card-scene .eyebrow{top:20px;left:18px}.card-scene .speech-bubble{top:53px;left:18px;right:auto;width:calc(100% - 145px);max-width:220px;font-size:12px}.card-mascot{width:235px;right:-32px;bottom:-87px}.card-body{padding:23px 20px}.card h1{font-size:23px;margin-top:12px}.reason-heading{margin-top:20px}.actions{grid-template-columns:1fr;margin-top:21px}.card-footer{padding:13px 18px;flex-wrap:wrap;font-size:8px}.brand-credit{font-size:8px}.banner{right:12px;bottom:12px;width:min(440px,calc(100vw - 24px))}.banner-stage{padding-right:122px}.banner-stage .speech-bubble{font-size:11px}.banner-mascot{width:165px;right:-30px;bottom:-52px}}
.coverage{color:var(--muted);font-size:9px;line-height:1.7}
.banner-coverage{padding:0 16px;margin:0}
.card-footer{flex-wrap:wrap}
.card-footer .coverage{flex-basis:100%;margin:0}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
