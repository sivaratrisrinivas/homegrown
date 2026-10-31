// HG-22: precompute subtitle word profiles into config/coverage.json (committed; no runtime fetching).
//   node scripts/coverage.mjs 496243:ko 31011:es ...      fetch from OpenSubtitles, one per film
//   node scripts/coverage.mjs --file sub.srt 496243:ko     profile a local subtitle file instead
// Env: OPENSUBTITLES_API_KEY (required for fetching). Optional OPENSUBTITLES_USERNAME and
// OPENSUBTITLES_PASSWORD log in for the account's daily quota (20 for a free account); without them
// the key's anonymous quota applies (5 per IP per day, and the key must allow anonymous downloads).
// Films already in the file are skipped; a 406 (quota) stops the run and keeps what was saved.
// Only band counts are written; subtitle text is never stored.
import { readFileSync, writeFileSync } from 'node:fs';
import { LANGS, supported, tokenize, subtitleText, profile, profileProblem } from '../public/coverage.js';

const OS = 'https://api.opensubtitles.com/api/v1';
const UA = 'Homegrown v0.1.0';
const FILE = 'config/coverage.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ranks = new Map();
export function rankFor(lang) {
  if (!ranks.has(lang)) ranks.set(lang, new Map(readFileSync(`data/freq/${lang}.txt`, 'utf8').split('\n').filter(Boolean).map((w, i) => [w, i + 1])));
  return ranks.get(lang);
}
export const profileOf = (srt, lang) => profile(tokenize(subtitleText(srt), lang), rankFor(lang));

async function os(path, { method = 'GET', body, token } = {}) {
  const key = process.env.OPENSUBTITLES_API_KEY;
  if (!key) throw new Error('OPENSUBTITLES_API_KEY is not set');
  const headers = { 'Api-Key': key, 'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(OS + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  await sleep(1100); // documented: 5 requests/s per IP, login 1/s; stay well under
  if (!r.ok) { const e = new Error(`OpenSubtitles ${path.split('?')[0]}: HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
async function login() {
  const { OPENSUBTITLES_USERNAME: username, OPENSUBTITLES_PASSWORD: password } = process.env;
  if (!username || !password) return null;
  return (await os('/login', { method: 'POST', body: { username, password } })).token;
}
// Best file: the language's most downloaded, not machine- or AI-translated, not foreign-parts-only.
export function bestFile(results) {
  const ok = (results || []).filter((x) => !x.attributes?.machine_translated && !x.attributes?.ai_translated && !x.attributes?.foreign_parts_only && x.attributes?.files?.length);
  ok.sort((a, b) => (b.attributes.download_count || 0) - (a.attributes.download_count || 0));
  return ok[0]?.attributes.files[0].file_id ?? null;
}

async function main(argv) {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  const fi = argv.indexOf('--file');
  const local = fi >= 0 ? argv.splice(fi, 2)[1] : null;
  const token = local ? null : await login();
  for (const arg of argv) {
    const [id, lang] = arg.split(':');
    if (!/^\d+$/.test(id) || !supported(lang)) { console.log(arg, 'skip: bad id or unsupported language'); continue; }
    const key = `${id}:${lang}`;
    if (data.films[key] && !local) { console.log(key, 'already profiled'); continue; }
    let srt;
    if (local) srt = readFileSync(local, 'utf8');
    else {
      try {
        const s = await os(`/subtitles?tmdb_id=${id}&languages=${LANGS[lang].os}&type=movie`, { token });
        const fileId = bestFile(s.data);
        if (!fileId) { console.log(key, 'no subtitle'); continue; }
        const d = await os('/download', { method: 'POST', body: { file_id: fileId, sub_format: 'srt' }, token });
        console.log(key, 'downloads remaining', d.remaining, 'reset', d.reset_time_utc);
        srt = await (await fetch(d.link, { headers: { 'User-Agent': UA } })).text();
      } catch (e) {
        console.log(key, e.message);
        if (e.status === 406) break; // daily quota used up
        continue;
      }
    }
    const p = profileOf(srt, lang);
    const bad = profileProblem(p);
    if (bad) { console.log(key, `${bad} (${p.tokens} tokens), not saved`); continue; }
    data.films[key] = { ...p, at: new Date().toISOString().slice(0, 10) };
    writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
    console.log(key, 'saved', p.tokens, 'tokens');
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
