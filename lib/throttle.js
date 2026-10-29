// Serialises calls and enforces a minimum gap between them.
export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createThrottle({ minGapMs, sleep = realSleep, now = () => Date.now() }) {
  let last = -Infinity;
  let chain = Promise.resolve();
  return function run(fn) {
    const p = chain.then(async () => {
      const wait = last + minGapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      try { return await fn(); } finally { last = now(); }
    });
    chain = p.catch(() => {});
    return p;
  };
}
