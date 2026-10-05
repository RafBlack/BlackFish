const BF_RISK_THRESHOLDS = {
  MEDIUM: 30,
  HIGH: 55
};

function bfAggregateScore(signalGroups) {
  const all = [].concat(...signalGroups.filter(Boolean));
  const total = Math.min(100, all.reduce((sum, s) => sum + s.weight, 0));

  let level = "LOW";
  if (total >= BF_RISK_THRESHOLDS.HIGH) level = "HIGH";
  else if (total >= BF_RISK_THRESHOLDS.MEDIUM) level = "MEDIUM";

  const byId = new Map();
  for (const s of all) {
    if (!byId.has(s.id) || byId.get(s.id).weight < s.weight) byId.set(s.id, s);
  }

  return {
    score: total,
    level,
    signals: [...byId.values()].sort((a, b) => b.weight - a.weight),
    timestamp: Date.now()
  };
}

function bfIsBorderline(total) {
  return total >= (BF_RISK_THRESHOLDS.MEDIUM - 10) && total < BF_RISK_THRESHOLDS.HIGH;
}
