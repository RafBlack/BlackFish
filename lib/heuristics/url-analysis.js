const BF_TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "co.in", "com.au",
  "net.au", "org.au", "com.br", "com.cn", "com.mx", "co.nz", "co.za",
  "com.sg"
]);

const BF_ABUSED_TLDS = new Set([
  "tk", "ml", "ga", "cf", "gq", "xyz", "top", "work", "click", "link",
  "zip", "mov", "icu", "cam", "cyou", "rest", "loan"
]);

const BF_EXECUTABLE_EXT = new Set([
  "exe", "scr", "bat", "cmd", "js", "jar", "msi", "com", "pif", "vbs",
  "hta", "ps1"
]);

function bfGetRegistrableDomain(hostname) {
  if (!hostname) return "";
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (BF_TWO_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

function bfIsIPv4(hostname) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) &&
    hostname.split(".").every(seg => Number(seg) <= 255);
}

function bfIsIPHost(hostname) {
  if (!hostname) return false;
  if (bfIsIPv4(hostname)) return true;
  if (hostname.includes(":")) return true;
  return false;
}

function bfIsPunycode(hostname) {
  return hostname.toLowerCase().split(".").some(label => label.startsWith("xn--"));
}

function bfHasMixedScript(str) {
  const hasLatin = /[a-z]/i.test(str);
  const hasCyrillic = /[\u0400-\u04FF]/.test(str);
  const hasGreek = /[\u0370-\u03FF]/.test(str);
  return hasLatin && (hasCyrillic || hasGreek);
}

function bfAnalyzeUrl(rawUrl) {
  const signals = [];
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { signals, registrableDomain: "", hostname: "" };
  }

  const hostname = url.hostname;
  const registrableDomain = bfIsIPHost(hostname) ? hostname : bfGetRegistrableDomain(hostname);
  const subdomainDepth = hostname.split(".").length - registrableDomain.split(".").length;

  if (url.username || rawUrl.includes("@" + hostname)) {
    signals.push({ id: "at-symbol-in-url", weight: 25, detail: "URL contains an '@' before the host, a classic redirect/obfuscation trick." });
  }

  if (bfIsIPHost(hostname)) {
    signals.push({ id: "ip-literal-host", weight: 30, detail: `Site is addressed by raw IP (${hostname}) instead of a domain name.` });
  }

  if (bfIsPunycode(hostname)) {
    signals.push({ id: "punycode-host", weight: 20, detail: "Hostname uses punycode (xn--), often used to render lookalike international characters." });
  }

  if (bfHasMixedScript(hostname)) {
    signals.push({ id: "mixed-script-host", weight: 30, detail: "Hostname mixes Latin letters with Cyrillic/Greek look-alike characters." });
  }

  if (subdomainDepth >= 3) {
    signals.push({ id: "deep-subdomain", weight: 10, detail: `Unusually deep subdomain chain (${subdomainDepth} levels) before the real domain.` });
  }

  const tld = registrableDomain.split(".").pop();
  if (BF_ABUSED_TLDS.has(tld)) {
    signals.push({ id: "abused-tld", weight: 8, detail: `Registrable domain uses a TLD (.${tld}) frequently abused for throwaway phishing sites.` });
  }

  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    signals.push({ id: "excessive-hyphens", weight: 10, detail: `Hostname contains ${hyphenCount} hyphens, a common typosquat/lure pattern.` });
  }

  const lowerHref = rawUrl.toLowerCase();
  const matchedLure = BF_LURE_KEYWORDS.filter(k => lowerHref.includes(k));
  if (matchedLure.length >= 2 && !BF_BRAND_LIST.includes(registrableDomain)) {
    signals.push({
      id: "lure-keywords",
      weight: 8 + Math.min(matchedLure.length, 4) * 3,
      detail: `URL contains multiple credential/urgency lure terms (${matchedLure.slice(0, 4).join(", ")}).`
    });
  }

  const pathExt = (url.pathname.split(".").pop() || "").toLowerCase();
  if (BF_EXECUTABLE_EXT.has(pathExt)) {
    signals.push({ id: "executable-download", weight: 15, detail: `Link points at a directly downloadable executable-type file (.${pathExt}).` });
  }

  if (url.protocol !== "https:" && url.protocol !== "chrome-extension:") {
    signals.push({ id: "not-https", weight: 6, detail: "Page is not served over HTTPS." });
  }

  return { signals, registrableDomain, hostname, subdomainDepth };
}
