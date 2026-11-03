/* Tsunami watch scoring rules. Shared by index.html (in the browser) and tools/apply.js (in node),
   so the page and the sampler always agree on every status, the pace and the verdict. */
(function (root) {
  const EARLY_BELOW = 3; // races' worth of votes counted before the heading stops being an early sign
  const REGIONS = ['East Coast', 'South', 'Midwest', 'Wisconsin', 'Minnesota', 'West'];

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

  // Share of a race's vote counted, 0 to 1. A race with a margin but no share yet counts as half.
  const share = (r) => {
    const p = num(r.reporting);
    if (p !== null) return clamp01(p / 100);
    return r.called_for ? 1 : 0.5;
  };

  const statusOf = (m, wl, tl) => (m === null ? 'Waiting' : m >= tl ? 'Tsunami sign' : m >= wl ? 'Wave sign' : 'Short of wave');

  // The spec's verdict: only races with results count.
  const verdictOf = (statuses) => {
    const n = (s) => statuses.filter((x) => x === s).length;
    const got = statuses.filter((x) => x !== 'Waiting').length;
    if (got === 0) return 'waiting for results';
    if (n('Tsunami sign') * 2 >= got) return 'tsunami pace';
    if ((n('Tsunami sign') + n('Wave sign')) * 2 >= got) return 'wave pace';
    return 'short of the wave';
  };

  const countStatuses = (list) => {
    const n = (s) => list.filter((x) => x === s).length;
    return { tsunami: n('Tsunami sign'), wave: n('Wave sign'), short: n('Short of wave'), waiting: n('Waiting') };
  };

  function compute(data) {
    const races = (data && data.races) || [];
    const chambers = (data && data.chambers) || [];
    const samples = (data && data.samples) || [];
    const bw = races.filter((r) => r.bellwether === true).sort((a, b) => num(a.order) - num(b.order));

    // Status of each bellwether on the current count.
    const status = new Map(bw.map((r) => [r.id, statusOf(num(r.dem_margin), num(r.wave_line), num(r.tsunami_line))]));
    const tally = { ...countStatuses([...status.values()]), verdict: verdictOf([...status.values()]) };
    tally.reported = tally.tsunami + tally.wave + tally.short;
    const regions = REGIONS.filter((g) => bw.some((r) => r.region === g))
      .map((region) => ({ region, ...countStatuses(bw.filter((r) => r.region === region).map((r) => status.get(r.id))) }));

    // Tonight's pace: points past the wave line, weighted by share counted.
    let sw = 0, sx = 0, reported = 0;
    bw.forEach((r) => {
      const m = num(r.dem_margin);
      if (m === null) return;
      reported += 1;
      sw += share(r);
      sx += share(r) * (m - num(r.wave_line));
    });
    const pace = sw > 0 ? round1(sx / sw) : null;
    // Under a uniform pace, half the bellwethers reach their tsunami line once the pace passes this gap.
    const gaps = bw.map((r) => num(r.tsunami_line) - num(r.wave_line)).sort((a, b) => a - b);
    const tsunamiNeed = gaps.length ? gaps[Math.ceil(gaps.length / 2) - 1] : null;

    // Projection: the count so far, filled out at tonight's pace for the rest of the vote.
    const projectOf = (r) => {
      const m = num(r.dem_margin);
      const fill = pace === null || num(r.wave_line) === null ? null : num(r.wave_line) + pace;
      if (m === null) return fill;
      if (fill === null) return m;
      const p = share(r);
      return p * m + (1 - p) * fill;
    };
    const projected = new Map(bw.map((r) => {
      const pm = projectOf(r);
      const m = num(r.dem_margin);
      return [r.id, {
        projected: round1(pm),
        status: statusOf(pm, num(r.wave_line), num(r.tsunami_line)),
        pastWave: m === null ? null : round1(m - num(r.wave_line))
      }];
    }));
    const heading = verdictOf([...projected.values()].map((p) => p.status));
    const called = bw.filter((r) => r.called_for && num(r.dem_margin) !== null);
    const calledVerdict = verdictOf(called.map((r) => status.get(r.id)));
    const counted = round1(sw);
    const confidence = sw === 0 ? 'no votes counted yet'
      : called.length * 2 >= bw.length && calledVerdict === heading ? 'confirmed'
      : sw < EARLY_BELOW ? 'early signs'
      : 'firming up';

    // Senate path.
    const us = chambers.find((c) => c.id === 'US-SEN') || {};
    const notUpD = num(us.not_up_d) || 0;
    const target = num(us.target) || 53;
    const need = target - notUpD;
    const senRows = races.filter((r) => r.office === 'Senate').map((r) => {
      const left = r.dem_party === 'I' ? 'I' : 'D';
      const side = (v) => (v > 0 ? left : v < 0 ? 'R' : null);
      const m = num(r.dem_margin);
      const pm = r.bellwether === true ? projectOf(r) : m;
      const kind = r.called_for ? 'called' : m !== null ? 'leading' : pm !== null ? 'projected' : 'waiting';
      const sideNow = r.called_for || (m !== null ? side(m) : null);
      const sideProj = r.called_for || (pm !== null ? side(pm) : r.favored || null);
      const strength = sideProj === 'I' ? -2000
        : kind === 'called' ? (sideProj === 'D' ? 1000 : -1000) + (m || 0)
        : pm !== null ? pm
        : sideProj === 'D' ? 500 : sideProj === 'R' ? -500 : 0;
      return { id: r.id, state: String(r.id).split('-')[0], race: r, kind, sideNow, sideProj, margin: m, projected: round1(pm), strength };
    }).sort((a, b) => b.strength - a.strength).map((r, i) => ({ ...r, rank: i + 1, pivot: i + 1 === need }));
    const cnt = (f) => senRows.filter(f).length;
    const calledD = cnt((r) => r.kind === 'called' && r.sideNow === 'D');
    const leadD = cnt((r) => r.kind === 'leading' && r.sideNow === 'D');
    const senate = {
      rows: senRows,
      notUpD, target, need, up: senRows.length,
      calledD, leadD,
      calledR: cnt((r) => r.kind === 'called' && r.sideNow === 'R'),
      nowD: notUpD + calledD + leadD,
      projectedD: notUpD + cnt((r) => r.sideProj === 'D')
    };

    // Wisconsin trifecta.
    const fm = (v) => (v === 0 ? 'Even' : (v > 0 ? 'D+' : 'R+') + Math.round(Math.abs(v) * 10) / 10);
    const parts = [];
    const gov = races.find((r) => r.id === 'WI-GOV');
    if (gov) {
      const m = num(gov.dem_margin), p = num(gov.reporting);
      const pg = projected.get('WI-GOV');
      const pm = pg ? pg.projected : null;
      let st, detail;
      if (gov.called_for === 'D') { st = 'Democrats won'; detail = `${gov.dem || 'The Democrat'} wins, called by ${gov.called_by || 'a decision desk'}`; }
      else if (gov.called_for === 'R') { st = 'Republicans won'; detail = `${gov.rep || 'The Republican'} wins, called by ${gov.called_by || 'a decision desk'}`; }
      else if (m === null) { st = 'Waiting'; detail = pm === null ? `Polls close at ${gov.closes_ct} Central` : `Projected ${fm(pm)} at tonight's pace`; }
      else { st = m > 0 ? 'Democrats ahead' : m < 0 ? 'Republicans ahead' : 'Too close'; detail = `${fm(m)} with ${p === null ? 'some of the vote' : Math.round(p) + '%'} counted`; }
      parts.push({ part: 'gov', name: 'Governor', status: st, detail });
    }
    // Each chamber: seats safe for a party (not up, unopposed or safe) plus the battleground seats as they count.
    const wiSeats = {};
    [['WI-SEN', 'sen', 'State Senate', 'WI Senate'], ['WI-ASM', 'asm', 'State Assembly', 'WI Assembly']].forEach(([id, part, name, office]) => {
      const c = chambers.find((x) => x.id === id);
      if (!c) return;
      const seats = races.filter((r) => r.office === office).sort((a, b) => num(a.order) - num(b.order));
      wiSeats[part] = seats;
      const won = (s) => seats.filter((r) => r.called_for === s).length;
      const lead = (s) => seats.filter((r) => {
        const m = num(r.dem_margin);
        return !r.called_for && m !== null && (s === 'D' ? m > 0 : m < 0);
      }).length;
      const maj = num(c.majority) || 0, safeD = num(c.safe_d) || 0, safeR = num(c.safe_r) || 0;
      const dSure = safeD + won('D'), rSure = safeR + won('R');
      const dNow = dSure + lead('D'), rNow = rSure + lead('R');
      const any = seats.some((r) => r.called_for || num(r.dem_margin) !== null);
      const st = c.control_called === 'D' || dSure >= maj ? 'Democrats won'
        : c.control_called === 'R' || rSure >= maj ? 'Republicans won'
        : !any ? 'Waiting'
        : dNow >= maj ? 'Democrats ahead'
        : rNow >= maj ? 'Republicans ahead'
        : 'Too close';
      const detail = any
        ? `Democrats at ${dNow} of the ${maj} needed: ${safeD} safe, ${won('D')} won, ${lead('D')} leading`
        : `Democrats need ${maj - safeD} of the ${seats.length} battleground seats`;
      parts.push({ part, name, status: st, detail, needD: maj - safeD, battlegrounds: seats.length });
    });
    const sts = parts.map((d) => d.status);
    const all = sts.length < 3 ? 'waiting for results'
      : sts.every((s) => s === 'Democrats won') ? 'won'
      : sts.some((s) => s === 'Republicans won') ? 'out of reach tonight'
      : sts.every((s) => s === 'Democrats won' || s === 'Democrats ahead') ? 'on track'
      : sts.every((s) => s === 'Waiting') ? 'waiting for results'
      : 'not yet';
    const trifecta = { parts, all, seats: wiSeats, ballot: races.filter((r) => r.office === 'WI AG' || r.office === 'WI Question').sort((a, b) => num(a.order) - num(b.order)) };

    // Pace at each sample, from the latest count each race had at that time.
    const waveOf = new Map(bw.map((r) => [r.id, num(r.wave_line)]));
    const sorted = samples.filter((s) => s.at).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const times = [...new Set(sorted.map((s) => s.at))];
    const latest = new Map();
    let i = 0;
    const history = times.map((t) => {
      while (i < sorted.length && sorted[i].at <= t) { latest.set(sorted[i].id, sorted[i]); i += 1; }
      let w = 0, x = 0;
      latest.forEach((s, id) => {
        const m = num(s.dem_margin);
        if (!waveOf.has(id) || m === null) return;
        const sh = share(s);
        w += sh;
        x += sh * (m - waveOf.get(id));
      });
      return { at: t, pace: w > 0 ? round1(x / w) : null, counted: round1(w) };
    });

    return {
      bw, status, tally, regions, projected,
      pace: { pace, counted, reported, bellwethers: bw.length, tsunamiNeed },
      forecast: { heading, confidence, calledN: called.length, calledVerdict, earlyBelow: EARLY_BELOW },
      senate, trifecta, history,
      sampledAt: (data && data.sampled_at) || null
    };
  }

  const api = { compute, num, EARLY_BELOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TW = api;
})(typeof window !== 'undefined' ? window : globalThis);
