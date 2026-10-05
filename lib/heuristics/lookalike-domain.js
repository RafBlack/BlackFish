const BF_CONFUSABLES = {
  "0": "o", "1": "l", "3": "e", "5": "s", "8": "b",
  "rn": "m", "vv": "w", "cl": "d"
};

function bfNormalizeConfusables(label) {
  let s = label.toLowerCase();
  for (const [from, to] of Object.entries(BF_CONFUSABLES)) {
    s = s.split(from).join(to);
  }
  return s;
}

function bfLevenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

function bfCheckLookalikeDomain(registrableDomain, hostname) {
  const signals = [];
  if (!registrableDomain || BF_BRAND_LIST.includes(registrableDomain)) {
    return signals;
  }

  const normalizedTarget = bfNormalizeConfusables(registrableDomain);

  for (const brand of BF_BRAND_LIST) {
    const brandLabel = brand.split(".")[0];
    const targetLabel = registrableDomain.split(".")[0];
    if (targetLabel === brandLabel) continue;

    const distance = bfLevenshtein(normalizedTarget, bfNormalizeConfusables(brand));
    const lengthBudget = Math.max(brand.length, registrableDomain.length);
    const threshold = brand.length <= 6 ? 1 : 2;

    if (distance > 0 && distance <= threshold && distance / lengthBudget < 0.4) {
      signals.push({
        id: "typosquat-domain",
        weight: 40,
        detail: `Domain "${registrableDomain}" is ${distance} character${distance > 1 ? "s" : ""} away from "${brand}".`
      });
      break;
    }
  }

  const labels = hostname.toLowerCase().split(".");
  for (const brand of BF_BRAND_LIST) {
    const brandLabel = brand.split(".")[0];
    if (brandLabel.length < 4) continue;
    const idx = labels.indexOf(brandLabel);
    if (idx !== -1 && idx < labels.length - 2) {
      const isActuallyBrand = registrableDomain === brand;
      if (!isActuallyBrand) {
        signals.push({
          id: "brand-in-subdomain",
          weight: 35,
          detail: `"${brand}" appears as a subdomain of the unrelated domain "${registrableDomain}".`
        });
        break;
      }
    }
  }

  return signals;
}
