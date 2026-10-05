const PRESETS = {
  grok: { endpoint: "https://api.x.ai/v1/chat/completions", model: "grok-4-latest" },
  local: { endpoint: "http://localhost:11434/v1/chat/completions", model: "hermes3" }
};

async function loadAll() {
  const res = await chrome.storage.local.get([
    "bf_allowlist", "bf_custom_brands", "bf_ai_enabled", "bf_ai_endpoint", "bf_ai_model", "bf_ai_key"
  ]);
  renderAllowlist(res.bf_allowlist || []);
  renderBrands(res.bf_custom_brands || []);
  document.getElementById("aiEnabled").checked = !!res.bf_ai_enabled;
  document.getElementById("aiEndpoint").value = res.bf_ai_endpoint || "";
  document.getElementById("aiModel").value = res.bf_ai_model || "";
  document.getElementById("aiKey").value = res.bf_ai_key || "";
}

function renderAllowlist(list) {
  const ul = document.getElementById("allowlist");
  ul.innerHTML = "";
  document.getElementById("allowlistEmpty").style.display = list.length ? "none" : "block";
  for (const origin of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${origin}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const res = await chrome.storage.local.get(["bf_allowlist"]);
      const updated = (res.bf_allowlist || []).filter(o => o !== origin);
      await chrome.storage.local.set({ bf_allowlist: updated });
      renderAllowlist(updated);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function renderBrands(list) {
  const ul = document.getElementById("brandlist");
  ul.innerHTML = "";
  for (const domain of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${domain}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const res = await chrome.storage.local.get(["bf_custom_brands"]);
      const updated = (res.bf_custom_brands || []).filter(d => d !== domain);
      await chrome.storage.local.set({ bf_custom_brands: updated });
      renderBrands(updated);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

document.getElementById("addBrandBtn").addEventListener("click", async () => {
  const input = document.getElementById("brandInput");
  const domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain || !domain.includes(".")) return;
  const res = await chrome.storage.local.get(["bf_custom_brands"]);
  const list = res.bf_custom_brands || [];
  if (!list.includes(domain)) list.push(domain);
  await chrome.storage.local.set({ bf_custom_brands: list });
  input.value = "";
  renderBrands(list);
});

document.getElementById("presetSelect").addEventListener("change", (e) => {
  const preset = PRESETS[e.target.value];
  if (preset) {
    document.getElementById("aiEndpoint").value = preset.endpoint;
    document.getElementById("aiModel").value = preset.model;
  }
});

document.getElementById("aiEnabled").addEventListener("change", (e) => {
  document.getElementById("permWarn").style.display = e.target.checked ? "block" : "none";
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const enabled = document.getElementById("aiEnabled").checked;
  const endpoint = document.getElementById("aiEndpoint").value.trim();
  const model = document.getElementById("aiModel").value.trim();
  const key = document.getElementById("aiKey").value.trim();
  const status = document.getElementById("saveStatus");

  if (enabled && endpoint) {
    let origin;
    try { origin = new URL(endpoint).origin; } catch {
      status.textContent = "Endpoint URL is invalid.";
      status.style.color = "#b3261e";
      return;
    }
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!granted) {
      status.textContent = "Permission not granted — AI-assist stays off.";
      status.style.color = "#b3261e";
      await chrome.storage.local.set({ bf_ai_enabled: false });
      return;
    }
  }

  await chrome.storage.local.set({
    bf_ai_enabled: enabled,
    bf_ai_endpoint: endpoint,
    bf_ai_model: model,
    bf_ai_key: key
  });
  status.textContent = "Saved.";
  status.style.color = "#2f7d4f";
  setTimeout(() => (status.textContent = ""), 2000);
});

loadAll();
