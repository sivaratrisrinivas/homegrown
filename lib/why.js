// Why-lines must quote a real shared Qloo tag (brief §12.10). No tag, no invented reason.
// Qloo tag ids carry a kind (urn:tag:<kind>:...): theme/plot/genre are subjects, style/character
// are mostly adjectives, keyword is a noun. Each kind gets its own grammatical template.
const clean = (s) => String(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^([jk]) (pop|rock|drama)$/, '$1-$2');
const GENRE_NOUN = /(thriller|drama|comedy|story|romance|western|musical|documentary|anime|horror|mystery|satire|fantasy|noir|sitcom|soap opera)$/;
const an = (w) => (/^[aeiou]/.test(w) ? 'An' : 'A');
const kindOf = (t) => (String(t.id || '').match(/^urn:tag:([a-z_]+):/) || [])[1] || 'keyword';
const ADJ = /(ic|al|ous|ive|ful|ish|less|ent|ant|able|ible|ary|y|ed|ing|ate|nse|ile|ose)$/;
const isAdjective = (w) => !/\s/.test(w) && ADJ.test(w) && !/(ity|ery|ory|ary|climate|chocolate|candidate|senate|estate|debate|state|fate|date|plate|license|sense|expense|defense|defence|response|purpose|verse|house|horse|nurse|mile|file|smile|style|profile|rose|dose|nose|pose)$/.test(w) || /^(dark|bleak|warm|slow|raw|lush|cool|weird|odd|sad|fun|complex|intense|dense|tense|immense|bold|smart|calm|fierce|gentle|subtle|simple|epic|wild|quiet|loud|sweet|cute|upbeat|mature|absurd|eclectic|offbeat|grim|tender|brutal|playful|light|deep)$/.test(w);
// People-nouns read better plural ("drug dealers"); everything else stays as Qloo wrote it.
const PERSON = /(er|or|ist|ian|ant|ent|cop|chef|friend|family|kid|teen|teenager|spy|thief|nurse|doctor|lawyer|soldier|monk|king|queen|wife|husband|mother|father|sister|brother|son|daughter)$/;
const NOT_PERSON = /(thriller|murder|water|power|cancer|border|disorder|order|winter|summer|fever|danger|monster|letter|paper|career|corner|after|ever|cover|dinner|silver|horror|humor|humour|honor|honour|error|terror|mirror|labor|color|colour|parent|talent|event|accident|incident|moment|movement|government|environment|experiment|tournament|apartment|department|punishment|treatment|agreement|argument|element|instrument|management|statement|basement|settlement|ant)$/;
export function plural(phrase) {
  const words = phrase.split(' '); const last = words.at(-1);
  if (!PERSON.test(last) || NOT_PERSON.test(last)) return null;
  const p = { family: 'families', wife: 'wives', thief: 'thieves', spy: 'spies' }[last]
    || (/(s|x|ch|sh)$/.test(last) ? `${last}es` : `${last}s`);
  return [...words.slice(0, -1), p].join(' ');
}
const SKIP_TAG = /^(scene before opening credits|based on .*|tv series|sequel|remake|duringcreditsstinger|aftercreditsstinger|woman director)$/;
const DESCRIPTIVE = new Set(['style', 'character', 'music', 'characteristic', 'mood', 'tone']);
const RANK = { music: 2, characteristic: 2, audience: 5, theme: 0, plot: 0, genre: 1, subgenre: 1, style: 2, character: 3, keyword: 4 };
const NOUN = { tv: 'show', movie: 'film', music: 'act' };

export function sharedTags(favourites, pick) {
  const pickTags = new Map((pick.tags || []).map((t) => [t.id || t.name, t]));
  const out = [];
  for (const fav of favourites) {
    for (const t of fav.tags || []) {
      const hit = pickTags.get(t.id || t.name);
      if (hit) out.push({ favourite: fav.name, tag: hit.name, kind: kindOf(hit) });
    }
  }
  return out;
}

// Pure phrasing: one shared tag -> one natural sentence. `v` picks a template variant.
export function phrase({ favourite: f, tag, kind }, category, v = 0) {
  const t = clean(tag); const noun = NOUN[category] || 'pick';
  const pick = (opts) => opts[v % opts.length];
  if (kind === 'audience') {
    return pick(isAdjective(t)
      ? [`Draws the same ${t} fans as ${f}`, `Same ${t} fanbase as ${f}`, `${cap(t)} fans of ${f} tend to love it`]
      : [`Shares an audience with ${f}`, `Loved by the same crowd as ${f}`, `Same fans as ${f}`]);
  }
  if (DESCRIPTIVE.has(kind)) {
    if (isAdjective(t)) return kind === 'character'
      ? pick([`Characters as ${t} as the ones in ${f}`, `Same ${t} streak as ${f}`, `${cap(t)} characters, like ${f}`])
      : pick([`Just as ${t} as ${f}`, `${cap(t)}, like ${f}`, `Has the ${t} side of ${f}`]);
    return pick([`Shares the ${t} feel of ${f}`, `The same ${t} you liked in ${f}`, `More ${t}, if you liked ${f}`]);
  }
  if (kind === 'keyword') {
    const pl = plural(t);
    if (pl) return pick([/\s/.test(t) ? `Shares ${t.replace(/ /g, '-')} drama with ${f}` : `${cap(pl)} at its heart, as in ${f}`, `Like ${f}, it's about ${pl}`]);
    return pick([`Shares the ${t} thread with ${f}`, `Same ${t} thread as ${f}`]);
  }
  // theme / plot / genre / subgenre: a subject the work is about.
  const full = GENRE_NOUN.test(t) ? t : `${t} ${noun}`;
  return pick([`${an(full)} ${full}, like ${f}`, GENRE_NOUN.test(t) ? `Another ${t}, if you liked ${f}` : `More ${t}, if you liked ${f}`]);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// i = the pick's position; `used` holds lines already shown in this category, so each pick
// gets a different tag, favourite or template where the shared tags allow it.
export function whyLine(favourites, pick, i = 0, used = new Set()) {
  const shared = sharedTags(favourites, pick)
    .filter((s) => !SKIP_TAG.test(clean(s.tag)) && clean(s.tag) !== clean(s.favourite))
    .sort((a, b) => (RANK[a.kind] ?? 4) - (RANK[b.kind] ?? 4))
    .filter((s, j, all) => all.findIndex((o) => clean(o.tag) === clean(s.tag)) === j);
  if (shared.length) {
    const top = shared.slice(0, 4); const k = top.length;
    let first;
    for (let n = 0; n < k * 3; n++) {
      const j = i + n; const s = top[j % k];
      const text = `${phrase(s, pick.category, Math.floor(j / k))}.`;
      first ||= { s, text };
      if (!used.has(text) && ![...used].some((u) => u.includes(` ${clean(s.tag)} `) || u.toLowerCase().startsWith(clean(s.tag)))) {
        used.add(text); return { text, tag: s.tag, favourite: s.favourite, grounded: true };
      }
    }
    used.add(first.text);
    return { text: first.text, tag: first.s.tag, favourite: first.s.favourite, grounded: true };
  }
  const names = favourites.slice(0, 2).map((f) => f.name).join(' and ');
  return { text: `Close to ${names}.`, grounded: false };
}
