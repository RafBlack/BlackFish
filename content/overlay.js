const BF_STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  .banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: #7a1f1f; color: #fff; padding: 10px 16px;
    display: flex; align-items: center; gap: 12px; font-size: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
  }
  .banner.medium { background: #8a5a00; }
  .banner strong { font-weight: 600; }
  .banner .reasons { opacity: .9; font-size: 13px; }
  .banner button {
    margin-left: auto; border: 1px solid rgba(255,255,255,.6); background: transparent;
    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 13px; cursor: pointer;
    white-space: nowrap;
  }
  .banner button:hover { background: rgba(255,255,255,.15); }
  .banner button + button { margin-left: 6px; }

  .interstitial {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(20,4,4,.96); color: #fff;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    max-width: 520px; padding: 28px 32px; background: #1c1c1c; border-radius: 10px;
    border: 1px solid #402020;
  }
  .card h1 { font-size: 20px; margin: 0 0 8px; color: #ff6b6b; }
  .card p { font-size: 14px; line-height: 1.5; color: #ddd; margin: 8px 0; }
  .card ul { font-size: 13px; color: #bbb; padding-left: 18px; margin: 10px 0; }
  .card .actions { margin-top: 20px; display: flex; gap: 10px; }
  .card .go-back {
    background: #2f7d4f; border: none; color: #fff; padding: 10px 16px;
    border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
  }
  .card .proceed {
    background: transparent; border: 1px solid #555; color: #999; padding: 10px 16px;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }
`;

function bfGetShadowRoot() {
  let host = document.getElementById("__blackfish_host__");
  if (!host) {
    host = document.createElement("div");
    host.id = "__blackfish_host__";
    (document.documentElement || document.body).appendChild(host);

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = BF_STYLE;
    shadow.appendChild(style);
    host._bfRoot = shadow;
  }
  return host._bfRoot;
}

function bfShowBanner(scored) {
  const root = bfGetShadowRoot();
  const existing = root.querySelector(".banner");
  if (existing) existing.remove();

  const topReasons = scored.signals.slice(0, 2).map(s => s.detail).join(" · ");
  const el = document.createElement("div");
  el.className = "banner" + (scored.level === "MEDIUM" ? " medium" : "");
  el.innerHTML = `
    <span>⚠️ <strong>BlackFish:</strong> this page shows signs of phishing (score ${scored.score}/100)</span>
    <span class="reasons">${topReasons}</span>
    <button data-action="trust">Trust this site</button>
    <button data-action="dismiss">Dismiss</button>
  `;
  el.querySelector('[data-action="dismiss"]').addEventListener("click", () => el.remove());
  el.querySelector('[data-action="trust"]').addEventListener("click", () => {
    bfSendMessage({ type: "TRUST_SITE", origin: location.origin });
    el.remove();
  });
  root.appendChild(el);
}

function bfShowInterstitial(scored, onProceed) {
  const root = bfGetShadowRoot();
  const existing = root.querySelector(".interstitial");
  if (existing) existing.remove();

  const reasons = scored.signals.slice(0, 4).map(s => `<li>${s.detail}</li>`).join("");
  const el = document.createElement("div");
  el.className = "interstitial";
  el.innerHTML = `
    <div class="card">
      <h1>⚠ This looks like a phishing attempt</h1>
      <p>BlackFish blocked a credential submission to an unexpected destination (risk score ${scored.score}/100).</p>
      <ul>${reasons}</ul>
      <div class="actions">
        <button class="go-back">Go back</button>
        <button class="proceed">Submit anyway</button>
      </div>
    </div>
  `;
  el.querySelector(".go-back").addEventListener("click", () => {
    el.remove();
    if (history.length > 1) history.back();
  });
  el.querySelector(".proceed").addEventListener("click", () => {
    el.remove();
    onProceed();
  });
  root.appendChild(el);
}

function bfSendMessage(msg) {
  try { chrome.runtime.sendMessage(msg); } catch {}
}
