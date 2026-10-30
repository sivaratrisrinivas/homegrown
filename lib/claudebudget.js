// One Claude spend ledger per UTC day, shared by every Claude feature (HG-8 alt names, HG-12 AI suggest),
// so the daily cap (ALT_CAPS.globalUsdPerDay, $0.25) covers them together. In-memory, per instance.
export function createClaudeBudget({ usdPerDay, now = () => Date.now() }) {
  let day = '', spent = 0;
  const roll = () => { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day) { day = d; spent = 0; } };
  return {
    canSpend(usd) { roll(); return spent + usd <= usdPerDay; },
    add(usd) { roll(); spent += usd; },
    spent() { roll(); return spent; },
  };
}
