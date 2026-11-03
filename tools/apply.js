#!/usr/bin/env node
/* Merge one results sample into data.json and report what moved.
   Usage: node tools/apply.js updates.json [--dry]
   updates.json: {"at": "<ISO time, optional>",
                  "races": {"KY-6": {"dem_margin": -7.2, "reporting": 45, "called_for": "", "called_by": ""}},
                  "chambers": {"WI-SEN": {"control_called": "D", "control_called_by": "WPR"}}}
   Wisconsin Legislature battleground seats are races too (ids like WI-SD5, WI-AD21); ballot questions take yes_pct.
   Prints JSON: {alert, text, lines}. alert is true when the heading, the verdict or the trifecta changed,
   or a race was called; text is then the one-line message for the owner. */
const fs = require('fs');
const path = require('path');
const TW = require('../calc.js');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'data.json');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const updPath = args.find((a) => !a.startsWith('--'));
if (!updPath) { console.error('usage: node tools/apply.js updates.json [--dry]'); process.exit(2); }

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const upd = JSON.parse(fs.readFileSync(updPath, 'utf8'));
const at = upd.at || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const before = TW.compute(data);
const oldRaces = new Map(JSON.parse(JSON.stringify(data.races)).map((r) => [r.id, r]));

const RACE_FIELDS = ['dem_margin', 'reporting', 'called_for', 'called_by', 'yes_pct'];
const CHAMBER_FIELDS = ['control_called', 'control_called_by'];
const errors = [];
const races = new Map(data.races.map((r) => [r.id, r]));
const chambers = new Map(data.chambers.map((c) => [c.id, c]));

for (const [id, u] of Object.entries(upd.races || {})) {
  const r = races.get(id);
  if (!r) { errors.push(`unknown race ${id}`); continue; }
  Object.keys(u).filter((k) => !RACE_FIELDS.includes(k)).forEach((k) => errors.push(`${id}: unknown field ${k}`));
  if (u.dem_margin !== undefined && u.dem_margin !== null && !(typeof u.dem_margin === 'number' && Math.abs(u.dem_margin) <= 100)) errors.push(`${id}: dem_margin must be a number from -100 to 100`);
  if (u.reporting !== undefined && u.reporting !== null && !(typeof u.reporting === 'number' && u.reporting >= 0 && u.reporting <= 100)) errors.push(`${id}: reporting must be a percent from 0 to 100`);
  if (u.yes_pct !== undefined && u.yes_pct !== null && !(typeof u.yes_pct === 'number' && u.yes_pct >= 0 && u.yes_pct <= 100)) errors.push(`${id}: yes_pct must be a percent from 0 to 100`);
  if (u.called_for !== undefined && !['', 'D', 'R', 'I', 'Yes', 'No'].includes(u.called_for)) errors.push(`${id}: called_for must be "", D, R, I, Yes or No`);
  if (u.called_for && !(u.called_by || r.called_by)) errors.push(`${id}: a call needs called_by`);
}
for (const [id, u] of Object.entries(upd.chambers || {})) {
  if (!chambers.has(id)) { errors.push(`unknown chamber ${id}`); continue; }
  Object.keys(u).filter((k) => !CHAMBER_FIELDS.includes(k)).forEach((k) => errors.push(`${id}: unknown field ${k}`));
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

for (const [id, u] of Object.entries(upd.races || {})) Object.assign(races.get(id), u);
for (const [id, u] of Object.entries(upd.chambers || {})) Object.assign(chambers.get(id), u);
data.sampled_at = at;
data.samples = data.samples || [];
data.races.forEach((r) => {
  if (TW.num(r.dem_margin) !== null) data.samples.push({ at, id: r.id, dem_margin: r.dem_margin, reporting: r.reporting });
});

const after = TW.compute(data);
const signed = (v) => (v === null ? 'none yet' : (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1));
const fm = (v) => (v === null || v === undefined ? 'none' : v === 0 ? 'Even' : (v > 0 ? 'D+' : 'R+') + Math.abs(v).toFixed(1));

const calls = data.races.filter((r) => r.called_for && !(oldRaces.get(r.id) || {}).called_for);
const moves = data.races.map((r) => {
  const o = TW.num((oldRaces.get(r.id) || {}).dem_margin), n = TW.num(r.dem_margin);
  return { r, o, n, d: o === null || n === null ? (n === null ? 0 : 999) : n - o };
}).filter((m) => m.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

const lines = [
  `Heading: ${before.forecast.heading} -> ${after.forecast.heading} (${after.forecast.confidence})`,
  `So far: ${before.tally.verdict} -> ${after.tally.verdict} (${after.tally.tsunami} tsunami, ${after.tally.wave} wave, ${after.tally.short} short, ${after.tally.waiting} waiting)`,
  `Pace: ${signed(before.pace.pace)} -> ${signed(after.pace.pace)} (tsunami from ${signed(after.pace.tsunamiNeed)}, ${after.pace.counted} races' worth counted)`,
  `Senate: ${after.senate.nowD} called or leading, ${after.senate.projectedD} projected (was ${before.senate.projectedD}), hope ${after.senate.target}`,
  `WI trifecta: ${before.trifecta.all} -> ${after.trifecta.all}`,
  ...calls.map((r) => `Called: ${r.race} for ${r.called_for} by ${r.called_by}`),
  ...moves.slice(0, 6).map((m) => `${m.r.race}: ${m.o === null ? 'first results' : fm(m.o)} -> ${fm(m.n)}${TW.num(m.r.reporting) !== null ? ` (${m.r.reporting}% counted)` : ''}`)
];

const alert = calls.length > 0
  || before.forecast.heading !== after.forecast.heading
  || before.tally.verdict !== after.tally.verdict
  || before.trifecta.all !== after.trifecta.all;
const callText = calls.length ? ` Called: ${calls.map((r) => `${r.id} ${r.called_for}`).join(', ')}.` : '';
const text = alert
  ? `Tsunami watch: heading for ${after.forecast.heading} (${after.forecast.confidence}), pace ${signed(after.pace.pace)}.${callText} Senate ${after.senate.projectedD} projected. WI trifecta ${after.trifecta.all}.`
  : null;

if (!dry) fs.writeFileSync(dataPath, JSON.stringify(data, null, 1) + '\n');
console.log(JSON.stringify({ alert, text, lines, wrote: !dry, at }, null, 2));
