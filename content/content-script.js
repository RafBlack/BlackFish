(function () {
  let allowlisted = false;
  let signalGroups = [];
  let lastRenderedLevel = "LOW";
  let bannerShown = false;

  const pageOrigin = location.origin;

  chrome.storage.local.get(["bf_allowlist", "bf_custom_brands"], (res) => {
    const list = res.bf_allowlist || [];
    allowlisted = list.includes(pageOrigin);
    if (allowlisted) return;

    const custom = (res.bf_custom_brands || []).filter(b => !BF_BRAND_LIST.includes(b));
    if (custom.length) {
      BF_BRAND_LIST.push(...custom);
      signalGroups.push(bfCheckLookalikeDomain(urlResult.registrableDomain, urlResult.hostname));
    }
    render();
  });

  const urlResult = bfAnalyzeUrl(location.href);
  const lookalikeSignals = bfCheckLookalikeDomain(urlResult.registrableDomain, urlResult.hostname);
  signalGroups.push(urlResult.signals, lookalikeSignals);
  render();

  function runDomPhase() {
    if (allowlisted) return;
    const doc = document;
    signalGroups.push(bfScanCredentialForms(doc, pageOrigin));
    signalGroups.push(bfScanBrandMismatch(doc, urlResult.registrableDomain));
    signalGroups.push(bfScanHiddenOverlayIframes(doc));
    render();

    bfScanAnchorMismatches(doc, pageOrigin, 8, (anchorSignals) => {
      signalGroups.push(anchorSignals);
      render();
      reportToBackground("full-scan");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runDomPhase, { once: true });
  } else {
    runDomPhase();
  }

  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (allowlisted) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      signalGroups.push(bfScanCredentialForms(document, pageOrigin));
      signalGroups.push(bfScanHiddenOverlayIframes(document));
      render();
      reportToBackground("mutation-rescan");
    }, 800);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (allowlisted) return;
    if (msg.type === "EXTRA_SIGNALS" && Array.isArray(msg.signals)) {
      signalGroups.push(msg.signals);
      render();
    }
    if (msg.type === "RESCAN_REQUEST") {
      signalGroups = [urlResult.signals, lookalikeSignals];
      runDomPhase();
    }
  });

  function render() {
    const scored = bfAggregateScore(signalGroups);
    if (allowlisted || scored.level === "LOW") {
      lastRenderedLevel = scored.level;
      return;
    }
    if (scored.level === "MEDIUM" && !bannerShown) {
      bfShowBanner(scored);
      bannerShown = true;
    } else if (scored.level === "MEDIUM" && bannerShown) {
      bfShowBanner(scored);
    }
    if (scored.level === "HIGH") {
      bfShowBanner(scored);
      bannerShown = true;
    }
    lastRenderedLevel = scored.level;
    reportToBackground("render");
  }

  function reportToBackground(source) {
    const scored = bfAggregateScore(signalGroups);
    bfSendMessage({
      type: "SCAN_RESULT",
      source,
      url: location.href,
      origin: pageOrigin,
      scored,
      borderline: bfIsBorderline(scored.score),
      aiContext: {
        hostname: urlResult.hostname,
        registrableDomain: urlResult.registrableDomain,
        pageTitle: document.title || "",
        signalIds: scored.signals.map(s => s.id)
      }
    });
  }

  window.bfReportSignals = function (signals, source) {
    signalGroups.push(signals);
    render();
  };
})();
