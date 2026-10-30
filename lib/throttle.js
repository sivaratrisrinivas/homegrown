// Serialises calls and enforces a minimum gap between them.
export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createThrottle({ minGapMs, sleep = realSleep, now = () => Date.now() }) {
  let last = -Infinity;
  let chain = Promise.resolve();
  return function run(fn) {
    const p = chain.then(async () => {
      const wait = last + minGapMs - now();
      if (wait > 0) await sleep(wait);
      // Only a real call moves the slot: a call that throws before sending (err.notSent) doesn't.
      try { const out = await fn(); last = now(); return out; } catch (e) { if (!e?.notSent) last = now(); throw e; }
    });
    chain = p.catch(() => {});
    return p;
  };
}
