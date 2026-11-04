/* Tsunami watch scoring rules. Shared by index.html (in the browser) and tools/apply.js (in node),
   so the page and the sampler always agree on every status, count and verdict.
   Black and white: each bellwether is a tsunami sign, a wave sign, short, or waiting, from its margin against its
   two lines. A Democratic win is always at least a wave sign. No projections. */
(function (root) {
  const REGIONS = ['East Coast', 'South', 'Midwest', 'Wisconsin', 'Minnesota', 'West'];

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  const statusOf = (m, wl, tl) => (m === null ? 'Waiting' : m >= tl ? 'Tsunami sign' : m >= wl ? 'Wave sign' : 'Short of wave');

  // Tsunami seats are the ones a good night shouldn't win; wave seats are the battlegrounds it does.
  const isTsunamiSeat = (r) => r.rule !== 'Competitive';
  const demWon = (r) => {
    if (r.called_for) return r.called_for === 'D' || r.called_for === 'I';
    const m = num(r.dem_margin);
    return m !== null && m > 0;
  };
  // The verdict, over the races with results: Democrats winning half or more of the tsunami seats is tsunami pace;
  // winning half or more of the wave seats is wave pace; anything less is short of the wave. Before any wave seat
  // reports (the first hour), Democrats close (within 5) or winning in half the tsunami seats reads as wave pace.
  const verdictOf = (list, statusOfRace) => {
    const got = list.filter((r) => statusOfRace(r) !== 'Waiting');
    if (!got.length) return 'waiting for results';
    const ts = got.filter(isTsunamiSeat);
    const wv = got.filter((r) => !isTsunamiSeat(r));
    if (ts.length && ts.filter(demWon).length * 2 >= ts.length) return 'tsunami pace';
    if (wv.length) return wv.filter(demWon).length * 2 >= wv.length ? 'wave pace' : 'short of the wave';
    return ts.filter((r) => statusOfRace(r) !== 'Short of wave').length * 2 >= ts.length ? 'wave pace' : 'short of the wave';
  };
  const seatCounts = (list, statusOfRace) => {
    const ts = list.filter((r) => isTsunamiSeat(r) && statusOfRace(r) !== 'Waiting');
    const wv = list.filter((r) => !isTsunamiSeat(r) && statusOfRace(r) !== 'Waiting');
    return { tsN: ts.length, tsWon: ts.filter(demWon).length, wvN: wv.length, wvWon: wv.filter(demWon).length };
  };

  const countStatuses = (list) => {
    const n = (s) => list.filter((x) => x === s).length;
    return { tsunami: n('Tsunami sign'), wave: n('Wave sign'), short: n('Short of wave'), waiting: n('Waiting') };
  };

  // Which side a race favors right now: the call if there is one, else the leader in the count.
  const sideNowOf = (r) => {
    if (r.called_for) return r.called_for;
    const m = num(r.dem_margin);
    if (m === null || m === 0) return null;
    return m > 0 ? (r.dem_party === 'I' ? 'I' : 'D') : 'R';
  };

  function compute(data) {
    const races = (data && data.races) || [];
    const chambers = (data && data.chambers) || [];
    const samples = (data && data.samples) || [];
    const bw = races.filter((r) => r.bellwether === true).sort((a, b) => num(a.order) - num(b.order));

    // Counting so far: every bellwether with results, on its current count.
    const status = new Map(bw.map((r) => [r.id, statusOf(num(r.dem_margin), num(r.wave_line), num(r.tsunami_line))]));
    const st = (r) => status.get(r.id);
    const tally = { ...countStatuses([...status.values()]), ...seatCounts(bw, st), verdict: verdictOf(bw, st) };
    tally.reported = tally.tsunami + tally.wave + tally.short;

    // Called so far: only races a decision desk has called, on the count at the call.
    const calledRaces = bw.filter((r) => r.called_for && num(r.dem_margin) !== null);
    const called = { ...countStatuses(calledRaces.map(st)), ...seatCounts(calledRaces, st), n: calledRaces.length, verdict: verdictOf(calledRaces, st) };

    const regions = REGIONS.filter((g) => bw.some((r) => r.region === g))
      .map((region) => ({ region, ...countStatuses(bw.filter((r) => r.region === region).map((r) => status.get(r.id))) }));

    // Senate path: called or leading, toward the hope.
    const us = chambers.find((c) => c.id === 'US-SEN') || {};
    const notUpD = num(us.not_up_d) || 0;
    const target = num(us.target) || 53;
    const need = target - notUpD;
    const senRows = races.filter((r) => r.office === 'Senate').map((r) => {
      const m = num(r.dem_margin);
      const sideNow = sideNowOf(r);
      const kind = r.called_for ? 'called' : m !== null ? 'leading' : 'waiting';
      // Order: called Democratic seats, then the count, then waiting races by their final polls or ratings.
      const lean = num(r.poll) !== null ? num(r.poll) : r.favored === 'D' ? 30 : r.favored === 'R' ? -30 : 0;
      const strength = sideNow === 'I' || (kind === 'waiting' && r.dem_party === 'I') ? -2000
        : kind === 'called' ? (sideNow === 'D' ? 1000 : -1000) + (m || 0)
        : kind === 'leading' ? m
        : lean;
      return { id: r.id, state: String(r.id).split('-')[0], race: r, kind, sideNow, margin: m, strength };
    }).sort((a, b) => b.strength - a.strength).map((r, i) => ({ ...r, rank: i + 1, pivot: i + 1 === need }));
    const cnt = (f) => senRows.filter(f).length;
    const dHeld = senRows.filter((r) => r.race.seat_now === 'D');
    const rHeld = senRows.filter((r) => r.race.seat_now === 'R');
    const senate = {
      rows: senRows,
      notUpD, target, need, up: senRows.length,
      calledD: cnt((r) => r.kind === 'called' && r.sideNow === 'D'),
      leadD: cnt((r) => r.kind === 'leading' && r.sideNow === 'D'),
      calledR: cnt((r) => r.kind === 'called' && r.sideNow === 'R'),
      dHeldN: dHeld.length,
      holds: dHeld.filter((r) => r.sideNow === 'D').length,
      lost: dHeld.filter((r) => r.sideNow && r.sideNow !== 'D').length,
      flipsNeeded: Math.max(0, need - dHeld.length),
      flips: rHeld.filter((r) => r.sideNow === 'D').length,
      flipRows: rHeld.filter((r) => r.race.bellwether === true)
    };
    senate.nowD = notUpD + senate.calledD + senate.leadD;
    senate.calledTotalD = notUpD + senate.calledD;
    senate.leadR = cnt((r) => r.kind === 'leading' && r.sideNow === 'R');
    senate.ind = cnt((r) => r.sideNow === 'I');
    senate.waiting = senate.up - senate.calledD - senate.leadD - senate.calledR - senate.leadR - senate.ind;
    senate.waveAt = num(us.wave_at) || 51;
    senate.tsunamiAt = num(us.tsunami_at) || 53;
    // The Senate read: tsunami at the tsunami mark (53), wave at a majority, short below it.
    const tier = (n) => (n >= senate.tsunamiAt ? 'tsunami' : n >= senate.waveAt ? 'wave' : 'short of the wave');
    senate.nowTier = tier(senate.nowD);
    senate.calledTier = tier(senate.calledTotalD);

    // Wisconsin trifecta.
    const fm = (v) => (v === 0 ? 'Even' : (v > 0 ? 'D+' : 'R+') + Math.round(Math.abs(v) * 10) / 10);
    const parts = [];
    const gov = races.find((r) => r.id === 'WI-GOV');
    if (gov) {
      const m = num(gov.dem_margin), p = num(gov.reporting);
      let st, detail;
      if (gov.called_for === 'D') { st = 'Democrats won'; detail = `${gov.dem || 'The Democrat'} wins, called by ${gov.called_by || 'a decision desk'}`; }
      else if (gov.called_for === 'R') { st = 'Republicans won'; detail = `${gov.rep || 'The Republican'} wins, called by ${gov.called_by || 'a decision desk'}`; }
      else if (m === null) { st = 'Waiting'; detail = `Polls close at ${gov.closes_ct} Central`; }
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
      const lead = (s) => seats.filter((r) => !r.called_for && sideNowOf(r) === s).length;
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
      const counts = any
        ? `Democrats at ${dNow} of the ${maj} needed: ${safeD} safe, ${won('D')} won, ${lead('D')} leading`
        : `Democrats need ${maj - safeD} of the ${seats.length} battleground seats`;
      const party = c.control_called === 'D' ? 'Democratic' : c.control_called === 'R' ? 'Republican' : '';
      const detail = party && c.control_called_by ? `${party} control reported by ${c.control_called_by}. ${counts}` : counts;
      parts.push({ part, name, status: st, detail, needD: maj - safeD, battlegrounds: seats.length, dBattle: won('D') + lead('D') });
    });
    const sts = parts.map((d) => d.status);
    const all = sts.length < 3 ? 'waiting for results'
      : sts.every((s) => s === 'Democrats won') ? 'won'
      : sts.some((s) => s === 'Republicans won') ? 'out of reach tonight'
      : sts.every((s) => s === 'Democrats won' || s === 'Democrats ahead') ? 'on track'
      : sts.every((s) => s === 'Waiting') ? 'waiting for results'
      : 'not yet';
    const ballot = races.filter((r) => r.office === 'WI AG' || r.office === 'WI Question').sort((a, b) => num(a.order) - num(b.order));
    const trifecta = { parts, all, seats: wiSeats, ballot };

    // Signs through the night: the status counts at each sample, from the latest count each race had then.
    const byId = new Map(bw.map((r) => [r.id, r]));
    const sorted = samples.filter((s) => s.at).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const times = [...new Set(sorted.map((s) => s.at))];
    const latest = new Map();
    let i = 0;
    const history = times.map((t) => {
      while (i < sorted.length && sorted[i].at <= t) { latest.set(sorted[i].id, sorted[i]); i += 1; }
      const then = [];
      latest.forEach((s, id) => {
        const r = byId.get(id);
        if (r) then.push({ ...r, dem_margin: s.dem_margin, called_for: '' });
      });
      const stThen = (r) => statusOf(num(r.dem_margin), num(r.wave_line), num(r.tsunami_line));
      const c = countStatuses(then.map(stThen));
      return { at: t, tsunami: c.tsunami, wave: c.wave, short: c.short, ...seatCounts(then, stThen), verdict: verdictOf(then, stThen) };
    });

    return {
      bw, status, tally, called, regions, senate, trifecta, history,
      sampledAt: (data && data.sampled_at) || null
    };
  }

  const api = { compute, num, statusOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TW = api;
})(typeof window !== 'undefined' ? window : globalThis);
