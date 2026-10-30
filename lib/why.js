// Why-lines must quote a real shared Qloo tag (brief §12.10). No tag, no invented reason.
const pretty = (s) => String(s).replace(/_/g, ' ').toLowerCase();

export function sharedTags(favourites, pick) {
  const pickTags = new Map((pick.tags || []).map((t) => [t.id || t.name, t]));
  const out = [];
  for (const fav of favourites) {
    for (const t of fav.tags || []) {
      const hit = pickTags.get(t.id || t.name);
      if (hit) out.push({ favourite: fav.name, tag: hit.name });
    }
  }
  return out;
}

export function whyLine(favourites, pick) {
  const shared = sharedTags(favourites, pick);
  if (shared.length) {
    const { favourite, tag } = shared[0];
    return { text: `Because you liked ${favourite}: both are ${pretty(tag)}.`, tag, favourite, grounded: true };
  }
  const names = favourites.slice(0, 2).map((f) => f.name).join(' and ');
  return { text: `Taste-matched to ${names} by Qloo.`, grounded: false };
}
