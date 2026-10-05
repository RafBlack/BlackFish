(function () {
  let lastWarnedForm = null;

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.querySelector('input[type="password"]')) return;

    const pageOrigin = location.href;
    const signals = BFScanCredentialFormsSingle(form, pageOrigin);
    if (signals.length === 0) return;

    const scored = bfAggregateScore([signals]);
    if (scored.level === "LOW") return;

    const hasCrossOrigin = signals.some(s => s.id === "cross-origin-credential-form");
    if (hasCrossOrigin && form !== lastWarnedForm) {
      event.preventDefault();
      event.stopImmediatePropagation();
      lastWarnedForm = form;
      bfShowInterstitial(scored, () => {
        HTMLFormElement.prototype.submit.call(form);
      });
    }

    window.bfReportSignals(signals, "form-submit");
  }, true);

  function BFScanCredentialFormsSingle(form, pageOrigin) {
    const fauxDoc = { querySelectorAll: (sel) => sel === "form" ? [form] : form.querySelectorAll(sel), location };
    return bfScanCredentialForms(fauxDoc, pageOrigin);
  }
})();
