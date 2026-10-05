function bfAbsoluteUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

function bfScanCredentialForms(doc, pageOrigin) {
  const signals = [];
  const forms = doc.querySelectorAll("form");
  for (const form of forms) {
    const hasPasswordField = !!form.querySelector('input[type="password"]');
    if (!hasPasswordField) continue;

    const rawAction = form.getAttribute("action") || "";
    const actionUrl = bfAbsoluteUrl(rawAction || doc.location.href, doc.location.href);
    if (!actionUrl) continue;

    let actionHost, actionProtocol;
    try {
      const u = new URL(actionUrl);
      actionHost = u.hostname;
      actionProtocol = u.protocol;
    } catch { continue; }

    const pageHost = new URL(pageOrigin).hostname;
    const actionRegistrable = bfIsIPHost(actionHost) ? actionHost : bfGetRegistrableDomain(actionHost);
    const pageRegistrable = bfIsIPHost(pageHost) ? pageHost : bfGetRegistrableDomain(pageHost);

    if (actionRegistrable !== pageRegistrable) {
      signals.push({
        id: "cross-origin-credential-form",
        weight: 35,
        detail: `A password field submits to a different domain (${actionHost}) than the page itself (${pageHost}).`
      });
    }

    if (actionProtocol !== "https:") {
      signals.push({
        id: "insecure-credential-form",
        weight: 25,
        detail: `A password field submits over an insecure connection (${actionProtocol.replace(":", "")}).`
      });
    }

    const hiddenCount = form.querySelectorAll('input[type="hidden"]').length;
    if (hiddenCount >= 5) {
      signals.push({
        id: "many-hidden-fields",
        weight: 8,
        detail: `Credential form carries ${hiddenCount} hidden fields.`
      });
    }
  }
  return signals;
}

function bfScanAnchorMismatches(doc, pageOrigin, budgetMs, onDone) {
  const anchors = Array.from(doc.querySelectorAll("a[href]")).slice(0, 800);
  const signals = [];
  let i = 0;

  function looksLikeUrlOrBrand(text) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    if (/^(https?:\/\/|www\.)[^\s]+$/.test(t)) return t.replace(/^https?:\/\//, "").replace(/^www\./, "");
    for (const brand of BF_BRAND_LIST) {
      const label = brand.split(".")[0];
      if (t === label || t === brand) return brand;
    }
    return null;
  }

  function step(deadline) {
    const start = performance.now();
    while (i < anchors.length && (performance.now() - start) < budgetMs) {
      const a = anchors[i++];
      const visibleText = looksLikeUrlOrBrand(a.textContent || "");
      if (visibleText) {
        const hrefAbs = bfAbsoluteUrl(a.getAttribute("href"), pageOrigin);
        if (hrefAbs) {
          const hrefHost = new URL(hrefAbs).hostname;
          const hrefRegistrable = bfIsIPHost(hrefHost) ? hrefHost : bfGetRegistrableDomain(hrefHost);
          const claimedRegistrable = visibleText.includes(".") ? bfGetRegistrableDomain(visibleText) : null;
          if (claimedRegistrable && claimedRegistrable !== hrefRegistrable && !bfSameBrandFamily(claimedRegistrable, hrefRegistrable)) {
            signals.push({
              id: "anchor-text-href-mismatch",
              weight: 20,
              detail: `Link text shows "${visibleText}" but actually points to "${hrefHost}".`
            });
          }
        }
      }
      const hrefAbs2 = bfAbsoluteUrl(a.getAttribute("href"), pageOrigin);
      if (hrefAbs2) {
        const ext = (hrefAbs2.split("?")[0].split(".").pop() || "").toLowerCase();
        if (BF_EXECUTABLE_EXT.has(ext)) {
          signals.push({
            id: "executable-download-link",
            weight: 12,
            detail: `Page links directly to a downloadable executable file (.${ext}).`
          });
        }
      }
    }
    if (i < anchors.length) {
      bfRequestIdle(step);
    } else {
      onDone(signals);
    }
  }
  bfRequestIdle(step);
}

function bfRequestIdle(cb) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(cb, { timeout: 500 });
  else setTimeout(() => cb({ timeRemaining: () => 8 }), 16);
}

function bfScanBrandMismatch(doc, registrableDomain) {
  const signals = [];
  if (BF_BRAND_LIST.includes(registrableDomain)) return signals;

  const title = (doc.title || "").toLowerCase();
  const ogSite = (doc.querySelector('meta[property="og:site_name"]')?.content || "").toLowerCase();
  const text = `${title} ${ogSite}`;

  for (const brand of BF_BRAND_LIST) {
    const label = brand.split(".")[0];
    if (label.length < 4) continue;
    const re = new RegExp(`\\b${label}\\b`, "i");
    if (re.test(text)) {
      signals.push({
        id: "brand-name-domain-mismatch",
        weight: 30,
        detail: `Page identifies itself as "${label}" (title/meta) but is hosted on "${registrableDomain}".`
      });
      break;
    }
  }
  return signals;
}

function bfScanHiddenOverlayIframes(doc) {
  const signals = [];
  const iframes = doc.querySelectorAll("iframe");
  let suspicious = 0;
  for (const f of iframes) {
    const style = doc.defaultView?.getComputedStyle?.(f);
    if (!style) continue;
    const opacity = parseFloat(style.opacity || "1");
    const rect = f.getBoundingClientRect();
    const isTiny = rect.width <= 2 || rect.height <= 2;
    const isInvisible = opacity === 0 || style.visibility === "hidden";
    if ((isInvisible || isTiny) && f.src) {
      try {
        const srcHost = new URL(f.src, doc.location.href).hostname;
        const pageHost = new URL(doc.location.href).hostname;
        if (srcHost !== pageHost) suspicious++;
      } catch {}
    }
  }
  if (suspicious > 0) {
    signals.push({
      id: "hidden-cross-origin-iframe",
      weight: 15,
      detail: `${suspicious} invisible/near-zero-size iframe(s) loading content from a different origin.`
    });
  }
  return signals;
}
