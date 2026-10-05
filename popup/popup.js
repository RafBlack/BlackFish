const verdictEl = document.getElementById("verdict");
const scoreNum = document.getElementById("scoreNum");
const levelLabel = document.getElementById("levelLabel");
const hostLabel = document.getElementById("hostLabel");
const reasonList = document.getElementById("reasonList");
const emptyState = document.getElementById("emptyState");

function render(result) {
  if (!result) {
    levelLabel.textContent = "Not scanned";
    hostLabel.textContent = "Either this page hasn't finished loading, or it's a browser-internal page (chrome://, an error interstitial, the Web Store, a PDF viewer) that extensions can't run on at all.";
    scoreNum.textContent = "—";
    reasonList.innerHTML = "";
    emptyState.style.display = "none";
    return;
  }

  const { scored, url } = result;
  verdictEl.className = "verdict " + scored.level.toLowerCase();
  scoreNum.textContent = scored.score;
  levelLabel.textContent = {
    LOW: "Looks safe",
    MEDIUM: "Some risk signals",
    HIGH: "High phishing risk"
  }[scored.level];
  try { hostLabel.textContent = new URL(url).hostname; } catch { hostLabel.textContent = url; }

  reasonList.innerHTML = "";
  if (scored.signals.length === 0) {
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
    for (const s of scored.signals) {
      const li = document.createElement("li");
      li.textContent = s.detail;
      reasonList.appendChild(li);
    }
  }
}

chrome.runtime.sendMessage({ type: "GET_TAB_STATUS" }, render);

document.getElementById("rescanBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESCAN_ACTIVE_TAB" });
  levelLabel.textContent = "Rescanning…";
  setTimeout(() => chrome.runtime.sendMessage({ type: "GET_TAB_STATUS" }, render), 600);
});

document.getElementById("trustBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  const origin = new URL(tab.url).origin;
  chrome.runtime.sendMessage({ type: "TRUST_SITE", origin });
  window.close();
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
