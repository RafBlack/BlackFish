const navChains = new Map();
const tabVerdicts = new Map();

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function setBadge(tabId, scored) {
  const colors = { LOW: "#2f7d4f", MEDIUM: "#c98a00", HIGH: "#b3261e" };
  const text = scored.level === "LOW" ? "" : String(scored.score);
  chrome.action.setBadgeText({ tabId, text });
  if (scored.level !== "LOW") {
    chrome.action.setBadgeBackgroundColor({ tabId, color: colors[scored.level] });
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  tabVerdicts.delete(details.tabId);
  chrome.action.setBadgeText({ tabId: details.tabId, text: "" });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const isRedirect = (details.transitionQualifiers || []).some(
    q => q === "client_redirect" || q === "server_redirect"
  );
  const host = safeHostname(details.url);
  let entry = navChains.get(details.tabId);
  const withinWindow = entry && (Date.now() - entry.lastTimestamp) < 8000;

  if (!entry || !isRedirect || !withinWindow) {
    entry = { hosts: [host], lastTimestamp: Date.now() };
  } else {
    entry.hosts.push(host);
    entry.lastTimestamp = Date.now();
  }
  navChains.set(details.tabId, entry);

  const uniqueHosts = new Set(entry.hosts);
  if (isRedirect && uniqueHosts.size >= 3) {
    const signal = {
      id: "redirect-chain-abuse",
      weight: Math.min(30, 10 + uniqueHosts.size * 5),
      detail: `Reached this page after ${entry.hosts.length - 1} redirect hop(s) across domains: ${entry.hosts.join(" \u2192 ")}.`
    };
    chrome.tabs.sendMessage(details.tabId, { type: "EXTRA_SIGNALS", signals: [signal] }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  navChains.delete(tabId);
  tabVerdicts.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === "SCAN_RESULT" && tabId != null) {
    tabVerdicts.set(tabId, msg);
    setBadge(tabId, msg.scored);
    maybeCallAiAssist(msg, tabId);
    return;
  }

  if (msg.type === "TRUST_SITE") {
    chrome.storage.local.get(["bf_allowlist"], (res) => {
      const list = new Set(res.bf_allowlist || []);
      list.add(msg.origin);
      chrome.storage.local.set({ bf_allowlist: [...list] });
    });
    return;
  }

  if (msg.type === "GET_TAB_STATUS") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeId = tabs[0]?.id;
      sendResponse(activeId != null ? tabVerdicts.get(activeId) || null : null);
    });
    return true;
  }

  if (msg.type === "RESCAN_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id != null) chrome.tabs.sendMessage(tabs[0].id, { type: "RESCAN_REQUEST" }).catch(() => {});
    });
    return;
  }
});

async function maybeCallAiAssist(scanResult, tabId) {
  if (!scanResult.borderline) return;

  const settings = await chrome.storage.local.get(["bf_ai_enabled", "bf_ai_endpoint", "bf_ai_model", "bf_ai_key"]);
  if (!settings.bf_ai_enabled || !settings.bf_ai_endpoint || !settings.bf_ai_key) return;

  try {
    const granted = await chrome.permissions.contains({ origins: [new URL(settings.bf_ai_endpoint).origin + "/*"] });
    if (!granted) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(settings.bf_ai_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.bf_ai_key}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.bf_ai_model || "grok-4-latest",
        messages: [
          {
            role: "system",
            content: "You are a phishing-triage classifier. Given structured page signals (never raw HTML), reply with ONLY a JSON object: {\"escalate\": boolean, \"reason\": string}. escalate=true only if you're confident this is phishing beyond what the listed heuristics already suggest."
          },
          { role: "user", content: JSON.stringify(scanResult.aiContext) }
        ],
        temperature: 0
      })
    });
    clearTimeout(timeout);
    if (!resp.ok) return;

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);
    if (parsed.escalate) {
      chrome.tabs.sendMessage(tabId, {
        type: "EXTRA_SIGNALS",
        signals: [{ id: "ai-assist-escalation", weight: 25, detail: `AI-assist: ${parsed.reason || "flagged as likely phishing"}` }]
      }).catch(() => {});
    }
  } catch {
  }
}
