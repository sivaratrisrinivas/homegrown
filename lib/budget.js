// Shared Claude spend for one UTC day (HG-7). HG-8's alternate names and HG-7's why-lines both draw
// from it, so together they stay under the $0.25/day cap. In-memory per serverless instance.
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
export function createClaudeBudget({ usdPerDay = 0.25, now = () => Date.now() } = {}) {
  let day = '', spent = 0;
  const roll = () => { const d = utcDay(now()); if (d !== day) { day = d; spent = 0; } };
  return {
    usdPerDay,
    // Reserve the worst case before a call; false when it would cross the cap.
    reserve(usd) { roll(); if (spent + usd > usdPerDay) return false; spent += usd; return true; },
    // Adjust a reservation (actual - reserved, or -reserved to refund an unsent call).
    adjust(delta) { roll(); spent = Math.max(0, spent + delta); },
    spent() { roll(); return spent; },
  };
}
