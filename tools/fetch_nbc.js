#!/usr/bin/env node
/* Read NBC News results feeds for every race whose polls have closed and that isn't finished, and print an updates
   file for tools/apply.js. Margins come from NBC's vote counts (Democrat minus Republican, share of all votes cast);
   a race counts as called only when NBC marks a winner, and is credited to "NBC News".
   Usage: node tools/fetch_nbc.js [--all] > updates/<time>.json   (notes go to stderr) */
const data = require('../data.json');

const STATES = {
  AL: 'alabama', AK: 'alaska', AR: 'arkansas', CA: 'california', CO: 'colorado', DE: 'delaware', FL: 'florida',
  GA: 'georgia', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MT: 'montana', NE: 'nebraska',
  NV: 'nevada', NH: 'new-hampshire', NJ: 'new-jersey', NM: 'new-mexico', NC: 'north-carolina', OH: 'ohio',
  OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode-island', SC: 'south-carolina', SD: 'south-dakota',
  TN: 'tennessee', TX: 'texas', VA: 'virginia', WV: 'west-virginia', WI: 'wisconsin', WY: 'wyoming'
};
const SPECIAL_SENATE = new Set(['OH', 'FL']);
const BASE = 'https://www.nbcnews.com/firecracker/api/v2/state-results/';

const all = process.argv.includes('--all');
const check = process.argv.includes('--check'); // print who each race matched
const note = (s) => process.stderr.write(s + '\n');

function slugFor(r) {
  if (r.id === 'WI-AG') return { path: '2026-elections/wisconsin-attorney-general-results', office: 'A' };
  const [st, part] = r.id.split('-');
  const s = STATES[st];
  if (!s || !part) return null;
  if (part === 'SEN') return { path: `${SPECIAL_SENATE.has(st) ? '2026-special-elections' : '2026-elections'}/${s}-senate-results`, office: 'S' };
  if (part === 'GOV') return { path: `2026-elections/${s}-governor-results`, office: 'G' };
  if (/^\d+$/.test(part)) return { path: `2026-elections/${s}-us-house-district-${part}-results`, office: 'H', district: Number(part) };
  return null;
}

// Minutes after midnight Central, with times after midnight counted as the same night.
function minutesOf(s) {
  const m = /^(\d+):(\d+)\s*(am|pm)$/i.exec(String(s || '').trim());
  if (!m) return 9999;
  let h = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  if (m[3].toLowerCase() === 'am' && h < 5) h += 24;
  return h * 60 + Number(m[2]);
}
function nowCentralMinutes() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date());
  let h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  if (h < 5) h += 24;
  return h * 60 + m;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastName = (s) => norm(s).split(' ').filter((w) => !['jr', 'sr', 'ii', 'iii'].includes(w)).pop() || '';

function pick(cands, want, party) {
  if (!want) return cands.find((c) => c.party === party) || null;
  const full = cands.filter((c) => norm(c.name) === norm(want));
  if (full.length === 1) return full[0];
  const last = cands.filter((c) => lastName(c.name || c.lastName) === lastName(want));
  if (last.length === 1) return last[0];
  if (last.length > 1) return last.find((c) => c.party === party) || last.find((c) => c.isIncumbent) || null;
  return null;
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) tsunami-watch' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function readRace(r) {
  const slug = slugFor(r);
  if (!slug) return null;
  const j = await getJson(BASE + slug.path);
  const races = (j.races || []).map((x) => x.summary).filter(Boolean);
  const s = races.find((x) => x.officeCode === slug.office && (slug.district === undefined || Number(x.district) === slug.district)) || races[0];
  if (!s) throw new Error('no race in feed');
  const cands = s.candidates || [];
  const d = pick(cands, r.dem, 'dem');
  const rep = pick(cands, r.rep, 'gop');
  if (!d || !rep) throw new Error(`could not match candidates (${cands.map((c) => `${c.name}:${c.party}`).join(', ')})`);
  if (check) note(`${r.id}: D=${d.name} (${d.party}${d.isIncumbent ? ', inc' : ''}) R=${rep.name} (${rep.party}${rep.isIncumbent ? ', inc' : ''})`);
  const total = cands.reduce((a, c) => a + (Number(c.votes) || 0), 0);
  const pin = Number(String(s.percentInFormatted || '').replace(/[^0-9.]/g, ''));
  const reporting = Number.isFinite(pin) && String(s.percentInFormatted || '').trim() !== '' ? Math.min(100, pin) : (Number(s.percentIn) || 0);
  const out = {};
  if (total > 0) {
    out.dem_margin = Math.round(((Number(d.votes) - Number(rep.votes)) / total) * 1000) / 10;
    out.reporting = reporting;
  }
  const winner = cands.find((c) => c.isWinner);
  if (winner) {
    out.called_for = winner === d ? (r.dem_party === 'I' ? 'I' : 'D') : winner === rep ? 'R' : winner.party === 'dem' ? 'D' : winner.party === 'gop' ? 'R' : 'I';
    out.called_by = 'NBC News';
  }
  return Object.keys(out).length ? out : null;
}

(async () => {
  const now = nowCentralMinutes();
  const todo = data.races.filter((r) => slugFor(r)
    && (all || minutesOf(r.closes_ct) <= now)
    && !(r.called_for && Number(r.reporting) >= 99));
  const updates = {};
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const r = todo[i++];
      try {
        const u = await readRace(r);
        if (u) updates[r.id] = u;
      } catch (e) {
        note(`${r.id}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  note(`read ${todo.length} races, ${Object.keys(updates).length} with results`);
  process.stdout.write(JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), races: updates }, null, 1) + '\n');
})();
