// Silniki rozgrywki. Każda dyscyplina trzyma żywy stan (drabinkę, strzały, gole),
// a kolejność miejsc jest z tego wyliczana — nie wpisywana ręcznie.
//
// Wspólny kontrakt:
//   createState(def, participants)  → świeży stan dyscypliny
//   applyAction(def, state, action) → nowy stan (rzuca Error przy niepoprawnej akcji)
//   derive(def, state)              → { status, provisional, places, withdrawn, teamPoints, board }
//
// `places` to zawsze pełna kolejność startujących — dopóki dyscyplina trwa, jest to
// najlepsze przybliżenie (provisional: true), więc klasyfikacja generalna żyje na bieżąco.

import { PLAYERS, WP_POINTS } from './config.mjs';

const PLAYER_COUNT = PLAYERS.length;

// ── Drobne narzędzia ────────────────────────────────────────────────────────

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Przeplata dwie listy, żeby zwycięzcy rundy wstępnej nie trafili wyłącznie na siebie. */
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function fail(message) {
  throw new Error(message);
}

function requireParticipants(participants) {
  if (!Array.isArray(participants)) fail('Lista startujących musi być tablicą.');
  const unique = new Set(participants);
  if (unique.size !== participants.length) fail('Zawodnik powtarza się na liście startujących.');
  if (participants.some((i) => !Number.isInteger(i) || i < 0 || i >= PLAYER_COUNT)) {
    fail('Na liście startujących jest nieznany zawodnik.');
  }
  if (participants.length < 2) fail('Do dyscypliny muszą wystartować co najmniej dwie osoby.');
  return [...participants];
}

function withdrawnFrom(participants) {
  return PLAYERS.map((_, i) => i).filter((i) => !participants.includes(i));
}

/** Sortowanie po kilku kluczach malejąco, z ostatnim kluczem rozstrzygającym remis. */
function byKeys(getKeys) {
  return (a, b) => {
    const ka = getKeys(a);
    const kb = getKeys(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return 0;
  };
}

// ══ Drabinka pucharowa (tenis) ══════════════════════════════════════════════
//
// Slot meczu wskazuje albo zawodnika, albo wynik innego meczu:
//   { k: 'p', i }        — konkretny zawodnik
//   { k: 'w', m: 'm3' }  — zwycięzca meczu m3
//   { k: 'l', m: 'm3' }  — przegrany meczu m3

function setupBracket(participants) {
  const field = shuffle(participants);
  const n = field.length;
  const matches = [];
  let counter = 0;
  const nextId = () => `m${counter++}`;

  // Runda wstępna wyrównuje pole do najbliższej potęgi dwójki.
  const base = 2 ** Math.floor(Math.log2(n));
  const prelim = n - base;
  const direct = field.slice(0, n - 2 * prelim).map((i) => ({ k: 'p', i }));
  const prelimField = field.slice(n - 2 * prelim);

  const advancing = [];
  for (let i = 0; i < prelim; i += 1) {
    const match = {
      id: nextId(),
      round: 0,
      a: { k: 'p', i: prelimField[2 * i] },
      b: { k: 'p', i: prelimField[2 * i + 1] },
      sa: null,
      sb: null,
    };
    matches.push(match);
    advancing.push({ k: 'w', m: match.id });
  }

  let level = interleave(direct, advancing);
  let round = 1;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const match = { id: nextId(), round, a: level[i], b: level[i + 1], sa: null, sb: null };
      matches.push(match);
      next.push({ k: 'w', m: match.id });
    }
    level = next;
    round += 1;
  }

  // Mecz o 3. miejsce ma sens tylko wtedy, gdy finał wyrasta z dwóch półfinałów.
  const final = matches[matches.length - 1];
  let thirdId = null;
  if (final && final.a.k === 'w' && final.b.k === 'w') {
    const third = {
      id: 'third',
      round: final.round,
      a: { k: 'l', m: final.a.m },
      b: { k: 'l', m: final.b.m },
      sa: null,
      sb: null,
    };
    matches.push(third);
    thirdId = third.id;
  }

  return { matches, thirdId, finalId: final?.id ?? null };
}

function matchById(state, id) {
  return state.matches.find((m) => m.id === id) ?? null;
}

function decided(match) {
  return match && match.sa !== null && match.sb !== null;
}

function resolveSlot(state, slot) {
  if (!slot) return null;
  if (slot.k === 'p') return slot.i;
  const match = matchById(state, slot.m);
  if (!decided(match)) return null;
  const winner = match.sa > match.sb ? resolveSlot(state, match.a) : resolveSlot(state, match.b);
  const loser = match.sa > match.sb ? resolveSlot(state, match.b) : resolveSlot(state, match.a);
  return slot.k === 'w' ? winner : loser;
}

function bracketWinner(state, id) {
  return resolveSlot(state, { k: 'w', m: id });
}

function bracketLoser(state, id) {
  return resolveSlot(state, { k: 'l', m: id });
}

/** Po zmianie zwycięzcy dalsze mecze przestają mieć sens — czyścimy je. */
function clearDownstream(state, id) {
  for (const match of state.matches) {
    if (match.a?.m !== id && match.b?.m !== id) continue;
    if (decided(match)) {
      match.sa = null;
      match.sb = null;
    }
    clearDownstream(state, match.id);
  }
}

function gamesWon(state, playerIndex) {
  let total = 0;
  for (const match of state.matches) {
    if (!decided(match)) continue;
    if (resolveSlot(state, match.a) === playerIndex) total += match.sa;
    if (resolveSlot(state, match.b) === playerIndex) total += match.sb;
  }
  return total;
}

/** Do której rundy ktoś doszedł — im wyżej, tym lepsze miejsce. */
function roundReached(state, playerIndex) {
  let best = -1;
  for (const match of state.matches) {
    if (match.id === state.thirdId) continue;
    const inMatch =
      resolveSlot(state, match.a) === playerIndex || resolveSlot(state, match.b) === playerIndex;
    if (inMatch) best = Math.max(best, match.round);
  }
  return best;
}

/** Wynik meczu, w którym zawodnik odpadł z drabinki. Każdy poza zwycięzcą ma jeden. */
function eliminationResult(state, playerIndex) {
  for (const match of state.matches) {
    if (match.id === state.thirdId || !decided(match)) continue;
    const a = resolveSlot(state, match.a);
    const b = resolveSlot(state, match.b);
    if (a !== playerIndex && b !== playerIndex) continue;
    if (bracketWinner(state, match.id) === playerIndex) continue;
    return {
      scored: a === playerIndex ? match.sa : match.sb,
      conceded: a === playerIndex ? match.sb : match.sa,
      opponent: bracketWinner(state, match.id),
    };
  }
  return null;
}

/**
 * Poza pierwszą czwórką runda nie może rozstrzygać miejsca: przy niepełnej
 * drabince zależy ona od losowego wolnego losu. Porównujemy więc mecz eliminacyjny,
 * a przy identycznym wyniku premiujemy grę z przeciwnikiem, który zaszedł dalej.
 */
function eliminationKeys(state, playerIndex) {
  const loss = eliminationResult(state, playerIndex);
  if (!loss) return [-1, -Infinity, -1, -1, -playerIndex];
  return [
    loss.scored,
    loss.scored - loss.conceded,
    roundReached(state, loss.opponent),
    gamesWon(state, loss.opponent),
    -playerIndex,
  ];
}

function deriveBracket(def, state) {
  const { participants } = state;
  const final = state.finalId ? matchById(state, state.finalId) : null;
  const third = state.thirdId ? matchById(state, state.thirdId) : null;

  const podium = [];
  if (decided(final)) {
    podium.push(bracketWinner(state, final.id), bracketLoser(state, final.id));
  }
  if (decided(third)) {
    podium.push(bracketWinner(state, third.id), bracketLoser(state, third.id));
  }

  const playable = state.matches.filter((m) => m.id !== state.thirdId);
  const done = decided(final) && (!third || decided(third));

  const rest = participants
    .filter((i) => !podium.includes(i))
    .sort(
      byKeys((i) =>
        done ? eliminationKeys(state, i) : [roundReached(state, i), gamesWon(state, i)],
      ),
    );

  return {
    status: done ? 'done' : playable.some(decided) ? 'live' : 'ready',
    provisional: !done,
    places: [...podium, ...rest],
    board: {
      kind: 'bracket',
      thirdId: state.thirdId,
      finalId: state.finalId,
      rounds: groupRounds(state),
      games: Object.fromEntries(participants.map((i) => [i, gamesWon(state, i)])),
    },
  };
}

function groupRounds(state) {
  const byRound = new Map();
  for (const match of state.matches) {
    const key = match.id === state.thirdId ? 'third' : match.round;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push({
      id: match.id,
      a: resolveSlot(state, match.a),
      b: resolveSlot(state, match.b),
      sa: match.sa,
      sb: match.sb,
    });
  }
  const rounds = [...byRound.entries()]
    .filter(([key]) => key !== 'third')
    .sort((x, y) => x[0] - y[0])
    .map(([round, matches]) => ({ round, matches }));
  if (byRound.has('third')) rounds.push({ round: 'third', matches: byRound.get('third') });
  return rounds;
}

function reduceBracket(def, state, action) {
  if (action.type !== 'score') fail(`Drabinka nie zna akcji „${action.type}”.`);
  const match = matchById(state, action.match);
  if (!match) fail('Nie ma takiego meczu.');
  if (match.id === state.thirdId && !def.params.thirdPlace) fail('Ten mecz nie jest rozgrywany.');

  const a = resolveSlot(state, match.a);
  const b = resolveSlot(state, match.b);
  if (a === null || b === null) fail('Ten mecz jeszcze nie ma obu zawodników.');

  const { sa, sb } = action;
  if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) {
    fail('Wynik meczu to dwie liczby całkowite.');
  }
  if (sa === sb) fail('Mecz nie może skończyć się remisem — ktoś musi wygrać.');

  const previousWinner = decided(match) ? bracketWinner(state, match.id) : null;
  match.sa = sa;
  match.sb = sb;
  if (previousWinner !== null && bracketWinner(state, match.id) !== previousWinner) {
    clearDownstream(state, match.id);
  }
  return state;
}

// ══ Grupy plus puchar (ping pong) ═══════════════════════════════════════════

function setupGroups(participants) {
  const field = shuffle(participants);
  const single = field.length <= 5;
  const groups = single ? [field] : [[], []];
  if (!single) field.forEach((player, i) => groups[i % 2].push(player));

  const matches = [];
  let counter = 0;
  groups.forEach((group, groupIndex) => {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        matches.push({
          id: `g${counter++}`,
          group: groupIndex,
          a: group[i],
          b: group[j],
          sa: null,
          sb: null,
        });
      }
    }
  });

  const playoff = single
    ? []
    : [
        { id: 'sf1', kind: 'sf', a: { k: 'g', group: 0, place: 0 }, b: { k: 'g', group: 1, place: 1 }, sa: null, sb: null },
        { id: 'sf2', kind: 'sf', a: { k: 'g', group: 1, place: 0 }, b: { k: 'g', group: 0, place: 1 }, sa: null, sb: null },
        { id: 'final', kind: 'final', a: { k: 'w', m: 'sf1' }, b: { k: 'w', m: 'sf2' }, sa: null, sb: null },
        { id: 'third', kind: 'third', a: { k: 'l', m: 'sf1' }, b: { k: 'l', m: 'sf2' }, sa: null, sb: null },
      ];

  return { groups, matches, playoff };
}

function groupTable(state, groupIndex) {
  const group = state.groups[groupIndex];
  const stats = new Map(group.map((i) => [i, { player: i, wins: 0, scored: 0, lost: 0, played: 0 }]));

  for (const match of state.matches) {
    if (match.group !== groupIndex || !decided(match)) continue;
    const rowA = stats.get(match.a);
    const rowB = stats.get(match.b);
    rowA.played += 1;
    rowB.played += 1;
    rowA.scored += match.sa;
    rowA.lost += match.sb;
    rowB.scored += match.sb;
    rowB.lost += match.sa;
    if (match.sa > match.sb) rowA.wins += 1;
    else rowB.wins += 1;
  }

  return [...stats.values()].sort(byKeys((r) => [r.wins, r.scored - r.lost, r.scored]));
}

function groupComplete(state, groupIndex) {
  return state.matches.filter((m) => m.group === groupIndex).every(decided);
}

function resolvePlayoffSlot(state, slot) {
  if (!slot) return null;
  if (slot.k === 'g') {
    if (!groupComplete(state, slot.group)) return null;
    return groupTable(state, slot.group)[slot.place]?.player ?? null;
  }
  const match = state.playoff.find((m) => m.id === slot.m);
  if (!decided(match)) return null;
  const winner =
    match.sa > match.sb ? resolvePlayoffSlot(state, match.a) : resolvePlayoffSlot(state, match.b);
  const loser =
    match.sa > match.sb ? resolvePlayoffSlot(state, match.b) : resolvePlayoffSlot(state, match.a);
  return slot.k === 'w' ? winner : loser;
}

function deriveGroups(def, state) {
  const tables = state.groups.map((_, i) => groupTable(state, i));
  const allGroupsDone = state.groups.every((_, i) => groupComplete(state, i));
  const anyPlayed = state.matches.some(decided);

  // Jedna grupa — tabela od razu ustala miejsca.
  if (state.playoff.length === 0) {
    return {
      status: allGroupsDone ? 'done' : anyPlayed ? 'live' : 'ready',
      provisional: !allGroupsDone,
      places: tables[0].map((r) => r.player),
      board: { kind: 'groups', tables, matches: state.matches, playoff: [], single: true },
    };
  }

  const finalMatch = state.playoff.find((m) => m.id === 'final');
  const thirdMatch = state.playoff.find((m) => m.id === 'third');

  const podium = [];
  if (decided(finalMatch)) {
    podium.push(
      resolvePlayoffSlot(state, { k: 'w', m: 'final' }),
      resolvePlayoffSlot(state, { k: 'l', m: 'final' }),
    );
  }
  if (decided(thirdMatch)) {
    podium.push(
      resolvePlayoffSlot(state, { k: 'w', m: 'third' }),
      resolvePlayoffSlot(state, { k: 'l', m: 'third' }),
    );
  }

  // Dopóki puchar trwa, prowizorycznie wyżej stoją ci, którzy wyszli z grup.
  const ranked = [];
  tables.forEach((table) => table.slice(0, 2).forEach((r) => ranked.push(r)));
  tables.forEach((table) => table.slice(2).forEach((r) => ranked.push(r)));
  const rest = ranked
    .filter((r) => !podium.includes(r.player))
    .sort(byKeys((r) => [r.wins, r.scored - r.lost, r.scored]))
    .map((r) => r.player);

  const qualifiers = new Set(tables.flatMap((t) => t.slice(0, 2).map((r) => r.player)));
  const orderedRest = allGroupsDone
    ? [...rest.filter((p) => qualifiers.has(p)), ...rest.filter((p) => !qualifiers.has(p))]
    : rest;

  const done = decided(finalMatch) && decided(thirdMatch);
  return {
    status: done ? 'done' : anyPlayed ? 'live' : 'ready',
    provisional: !done,
    places: [...podium, ...orderedRest],
    board: {
      kind: 'groups',
      tables,
      matches: state.matches,
      single: false,
      groupsDone: allGroupsDone,
      playoff: state.playoff.map((m) => ({
        id: m.id,
        kind: m.kind,
        a: resolvePlayoffSlot(state, m.a),
        b: resolvePlayoffSlot(state, m.b),
        sa: m.sa,
        sb: m.sb,
      })),
    },
  };
}

function reduceGroups(def, state, action) {
  if (action.type !== 'score') fail(`Grupy nie znają akcji „${action.type}”.`);
  const { sa, sb } = action;
  if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) {
    fail('Wynik seta to dwie liczby całkowite.');
  }
  if (sa === sb) fail('Set nie może skończyć się remisem.');

  const groupMatch = state.matches.find((m) => m.id === action.match);
  if (groupMatch) {
    groupMatch.sa = sa;
    groupMatch.sb = sb;
    // Zmiana w grupie może przetasować, kto wychodzi do półfinałów.
    for (const match of state.playoff) {
      match.sa = null;
      match.sb = null;
    }
    return state;
  }

  const playoffMatch = state.playoff.find((m) => m.id === action.match);
  if (!playoffMatch) fail('Nie ma takiego meczu.');
  if (
    resolvePlayoffSlot(state, playoffMatch.a) === null ||
    resolvePlayoffSlot(state, playoffMatch.b) === null
  ) {
    fail('Ten mecz jeszcze nie ma obu zawodników — dokończcie grupy.');
  }

  const previous = decided(playoffMatch)
    ? resolvePlayoffSlot(state, { k: 'w', m: playoffMatch.id })
    : null;
  playoffMatch.sa = sa;
  playoffMatch.sb = sb;
  if (
    playoffMatch.kind === 'sf' &&
    previous !== null &&
    resolvePlayoffSlot(state, { k: 'w', m: playoffMatch.id }) !== previous
  ) {
    for (const match of state.playoff) {
      if (match.kind === 'final' || match.kind === 'third') {
        match.sa = null;
        match.sb = null;
      }
    }
  }
  return state;
}

// ══ Strzały seriami (łuk) ═══════════════════════════════════════════════════

function setupArrows(participants) {
  return { order: shuffle(participants), arrows: {} };
}

function arrowsOf(state, playerIndex) {
  return state.arrows[playerIndex] ?? [];
}

/**
 * Kolejka strzelania. Mamy tylko dwie strzały, więc rotacja idzie seriami, nie
 * pojedynczymi strzałami: kto zaczął serię, kończy ją i dopiero potem idzie po strzały.
 */
function currentShooter(state, total, perSeries) {
  // Ktoś jest w środku serii — kończy ją pierwszy.
  for (const player of state.order) {
    const shot = arrowsOf(state, player).length;
    if (shot < total && shot % perSeries !== 0) return player;
  }
  // Nikt nie stoi na linii: idzie pierwsza osoba w kolejności z najmniejszą liczbą serii.
  let best = null;
  let fewest = Infinity;
  for (const player of state.order) {
    const shot = arrowsOf(state, player).length;
    if (shot >= total) continue;
    if (shot < fewest) {
      fewest = shot;
      best = player;
    }
  }
  return best;
}

function deriveArrows(def, state) {
  const { series, perSeries } = def.params;
  const total = series * perSeries;

  const rows = state.order.map((player) => {
    const values = arrowsOf(state, player);
    return {
      player,
      values,
      total: values.reduce((a, b) => a + b, 0),
      tens: values.filter((v) => v === def.params.maxArrow).length,
      best: values.length ? Math.max(...values) : 0,
      shot: values.length,
    };
  });

  const shooter = currentShooter(state, total, perSeries);
  const done = shooter === null;
  const anyShot = rows.some((r) => r.shot > 0);
  const shotSoFar = done ? 0 : arrowsOf(state, shooter).length;

  return {
    status: done ? 'done' : anyShot ? 'live' : 'ready',
    provisional: !done,
    places: [...rows].sort(byKeys((r) => [r.total, r.tens, r.best])).map((r) => r.player),
    board: {
      kind: 'arrows',
      rows,
      shooter,
      total,
      series,
      perSeries,
      seriesIndex: done ? series : Math.floor(shotSoFar / perSeries),
      arrowInSeries: done ? 0 : (shotSoFar % perSeries) + 1,
    },
  };
}

function reduceArrows(def, state, action) {
  const total = def.params.series * def.params.perSeries;

  if (action.type === 'arrow') {
    const { player, value } = action;
    if (!state.order.includes(player)) fail('Ten zawodnik nie startuje w łuku.');
    if (!Number.isInteger(value) || value < 0 || value > def.params.maxArrow) {
      fail(`Strzał to liczba od 0 do ${def.params.maxArrow}.`);
    }
    const values = arrowsOf(state, player);
    if (values.length >= total) fail('Ten zawodnik wystrzelał już wszystkie strzały.');
    state.arrows[player] = [...values, value];
    return state;
  }

  if (action.type === 'undoArrow') {
    const values = arrowsOf(state, action.player);
    if (values.length === 0) fail('Ten zawodnik nie ma jeszcze żadnego strzału.');
    state.arrows[action.player] = values.slice(0, -1);
    return state;
  }

  fail(`Łuk nie zna akcji „${action.type}”.`);
}

// ══ Heaty plus finał (kosz, bule) ═══════════════════════════════════════════

function setupHeats(participants) {
  const field = shuffle(participants);
  // Do pięciu osób nie ma sensu dzielić — gramy jeden bieg od razu o wszystko.
  if (field.length <= 5) return { heats: [field], log: [], straightFinal: true };
  const heats = [[], []];
  field.forEach((player, i) => heats[i % 2].push(player));
  return { heats, log: [], straightFinal: false };
}

function heatScores(state, stage) {
  const scores = new Map();
  for (const entry of state.log) {
    if (entry.stage !== stage) continue;
    // Pudło w powietrze zeruje dorobek — log zostaje nietknięty, żeby dało się cofnąć.
    if (entry.reset) scores.set(entry.player, 0);
    else scores.set(entry.player, (scores.get(entry.player) ?? 0) + entry.value);
  }
  return scores;
}

function heatTable(state, stage, field) {
  const scores = heatScores(state, stage);
  return field
    .map((player) => ({ player, score: scores.get(player) ?? 0 }))
    .sort(byKeys((r) => [r.score]));
}

function stageReached(def, state) {
  if (state.straightFinal) {
    const table = heatTable(state, 'final', state.heats[0]);
    return { stage: 'final', field: state.heats[0], target: def.params.finalTarget, done: table[0]?.score >= def.params.finalTarget };
  }
  for (let i = 0; i < state.heats.length; i += 1) {
    const table = heatTable(state, i, state.heats[i]);
    if (!(table[0]?.score >= def.params.heatTarget)) {
      return { stage: i, field: state.heats[i], target: def.params.heatTarget, done: false };
    }
  }
  const finalists = state.heats.flatMap((heat, i) => heatTable(state, i, heat).slice(0, 2).map((r) => r.player));
  const table = heatTable(state, 'final', finalists);
  return {
    stage: 'final',
    field: finalists,
    target: def.params.finalTarget,
    done: table[0]?.score >= def.params.finalTarget,
  };
}

function deriveHeats(def, state) {
  const current = stageReached(def, state);
  const heatTables = state.straightFinal
    ? []
    : state.heats.map((heat, i) => heatTable(state, i, heat));
  const finalists = current.stage === 'final' ? current.field : [];
  const finalTable = finalists.length ? heatTable(state, 'final', finalists) : [];

  let places;
  if (state.straightFinal) {
    places = heatTable(state, 'final', state.heats[0]).map((r) => r.player);
  } else if (finalists.length) {
    const nonFinalists = heatTables
      .flatMap((table) => table.filter((r) => !finalists.includes(r.player)))
      .sort(byKeys((r) => [r.score]))
      .map((r) => r.player);
    places = [...finalTable.map((r) => r.player), ...nonFinalists];
  } else {
    // Heaty jeszcze trwają — porównujemy surowe wyniki między biegami.
    places = heatTables
      .flat()
      .sort(byKeys((r) => [r.score]))
      .map((r) => r.player);
  }

  const done = current.stage === 'final' && current.done;
  return {
    status: done ? 'done' : state.log.length > 0 ? 'live' : 'ready',
    provisional: !done,
    places,
    board: {
      kind: 'heats',
      straightFinal: state.straightFinal,
      heats: state.heats,
      heatTables,
      heatTarget: def.params.heatTarget,
      finalTarget: def.params.finalTarget,
      values: def.params.values,
      unit: def.params.unit,
      allowZero: Boolean(def.params.allowZero),
      stage: current.stage,
      field: current.field,
      target: current.target,
      finalTable,
      lastEntry: state.log[state.log.length - 1] ?? null,
      logLength: state.log.length,
    },
  };
}

function reduceHeats(def, state, action) {
  /** Wspólne sprawdzenie: bieg trwa i ten zawodnik w nim gra. */
  const stageFor = (player) => {
    const current = stageReached(def, state);
    if (current.done) fail('Ta dyscyplina jest już rozstrzygnięta.');
    if (!current.field.includes(player)) fail('Ten zawodnik nie gra w aktualnym biegu.');
    return current;
  };

  if (action.type === 'point') {
    const current = stageFor(action.player);
    if (!def.params.values.includes(action.value)) {
      fail(`Można dopisać tylko: ${def.params.values.join(', ')} ${def.params.unit}.`);
    }
    state.log.push({ stage: current.stage, player: action.player, value: action.value });
    return state;
  }

  // Zerowanie (kosz): pudło w powietrze zabiera cały dorobek. Log zostaje nietknięty,
  // więc cofnięcie przywraca punkty.
  if (action.type === 'zero') {
    if (!def.params.allowZero) fail('W tej dyscyplinie nie zeruje się punktów.');
    const current = stageFor(action.player);
    state.log.push({ stage: current.stage, player: action.player, value: 0, reset: true });
    return state;
  }

  if (action.type === 'undo') {
    if (state.log.length === 0) fail('Nie ma czego cofać.');
    state.log.pop();
    return state;
  }

  fail(`Heaty nie znają akcji „${action.type}”.`);
}

// ══ Drużyny (water polo) ════════════════════════════════════════════════════

function setupTeams(participants) {
  // Losowanie wyłania dwóch kapitanów — resztę składów wybierają oni sami wężykiem.
  const [captainA, captainB] = shuffle(participants);
  return {
    captains: [captainA, captainB],
    teamA: [captainA],
    teamB: [captainB],
    goals: [],
    mvp: null,
    finished: false,
  };
}

function deriveTeams(def, state) {
  const { teamA, teamB, goals, mvp, finished } = state;
  const unassigned = state.participants.filter((i) => !teamA.includes(i) && !teamB.includes(i));
  // Dopóki kapitanowie nie skończą wybierać, nie ma meczu ani punktów.
  const ready = teamA.length > 0 && teamB.length > 0 && unassigned.length === 0;
  const scoreA = goals.filter((g) => teamA.includes(g.player)).length;
  const scoreB = goals.filter((g) => teamB.includes(g.player)).length;

  let teamPoints;
  if (ready) {
    teamPoints = {};
    const award = (list, value) => list.forEach((player) => { teamPoints[player] = value; });
    if (scoreA === scoreB) {
      award(teamA, WP_POINTS.draw);
      award(teamB, WP_POINTS.draw);
    } else if (scoreA > scoreB) {
      award(teamA, WP_POINTS.win);
      award(teamB, WP_POINTS.loss);
    } else {
      award(teamA, WP_POINTS.loss);
      award(teamB, WP_POINTS.win);
    }
    if (mvp !== null && teamPoints[mvp] !== undefined) teamPoints[mvp] += WP_POINTS.mvp;
  }

  return {
    status: finished ? 'done' : !ready ? 'setup' : goals.length > 0 ? 'live' : 'ready',
    provisional: !finished,
    places: [],
    teamPoints,
    board: {
      kind: 'teams',
      teamA,
      teamB,
      scoreA,
      scoreB,
      goals,
      mvp,
      finished,
      ready,
      captains: state.captains ?? [],
      unassigned,
      points: WP_POINTS,
      params: def.params,
    },
  };
}

function reduceTeams(def, state, action) {
  if (action.type === 'teams') {
    const { teamA, teamB } = action;
    if (!Array.isArray(teamA) || !Array.isArray(teamB)) fail('Składy muszą być tablicami.');
    const combined = [...teamA, ...teamB];
    if (new Set(combined).size !== combined.length) fail('Zawodnik jest w obu drużynach.');
    if (combined.some((i) => !state.participants.includes(i))) {
      fail('W składzie jest ktoś, kto nie startuje w water polo.');
    }
    if (state.participants.some((i) => !combined.includes(i))) {
      fail('Ktoś startujący nie został przypisany do drużyny.');
    }
    if (teamA.length === 0 || teamB.length === 0) fail('Obie drużyny muszą mieć zawodników.');
    if (Math.abs(teamA.length - teamB.length) > 1) {
      fail('Drużyny mogą się różnić najwyżej jedną osobą.');
    }
    state.teamA = [...teamA];
    state.teamB = [...teamB];
    state.goals = state.goals.filter((g) => combined.includes(g.player));
    if (state.mvp !== null && !combined.includes(state.mvp)) state.mvp = null;
    return state;
  }

  if (action.type === 'goal') {
    if (state.finished) fail('Mecz jest już zakończony.');
    const assigned = [...state.teamA, ...state.teamB];
    if (state.participants.some((i) => !assigned.includes(i))) {
      fail('Najpierw kapitanowie muszą skończyć wybierać składy.');
    }
    const inTeam = state.teamA.includes(action.player) || state.teamB.includes(action.player);
    if (!inTeam) fail('Ten zawodnik nie jest w żadnej drużynie.');
    state.goals.push({ player: action.player });
    return state;
  }

  if (action.type === 'undoGoal') {
    if (state.goals.length === 0) fail('Nie ma jeszcze żadnego gola.');
    state.goals.pop();
    return state;
  }

  if (action.type === 'mvp') {
    const { player } = action;
    if (player !== null && !state.teamA.includes(player) && !state.teamB.includes(player)) {
      fail('MVP musi być kimś, kto grał.');
    }
    state.mvp = player;
    return state;
  }

  if (action.type === 'finish') {
    if (state.teamA.length === 0 || state.teamB.length === 0) fail('Najpierw ustalcie składy.');
    state.finished = true;
    return state;
  }

  if (action.type === 'unfinish') {
    state.finished = false;
    return state;
  }

  fail(`Water polo nie zna akcji „${action.type}”.`);
}

// ══ Kolejność wypadania (poker) ═════════════════════════════════════════════

function setupElimination(participants) {
  // Losowanie ustala miejsca przy stole.
  return { seats: shuffle(participants), busted: [] };
}

function deriveElimination(def, state) {
  const remaining = state.participants.filter((i) => !state.busted.includes(i));
  const done = remaining.length === 1;

  return {
    status: done ? 'done' : state.busted.length > 0 ? 'live' : 'ready',
    provisional: !done,
    places: [...remaining, ...[...state.busted].reverse()],
    board: {
      kind: 'elimination',
      seats: state.seats ?? state.participants,
      remaining,
      busted: state.busted,
      total: state.participants.length,
      nextPlace: remaining.length,
    },
  };
}

function reduceElimination(def, state, action) {
  if (action.type === 'bust') {
    if (!state.participants.includes(action.player)) fail('Ten zawodnik nie siedzi przy stole.');
    if (state.busted.includes(action.player)) fail('Ten zawodnik już wypadł.');
    const remaining = state.participants.filter((i) => !state.busted.includes(i));
    if (remaining.length <= 1) fail('Turniej jest już rozstrzygnięty.');
    state.busted.push(action.player);
    return state;
  }

  if (action.type === 'undoBust') {
    if (state.busted.length === 0) fail('Nikt jeszcze nie wypadł.');
    state.busted.pop();
    return state;
  }

  fail(`Poker nie zna akcji „${action.type}”.`);
}

// ══ Wspólne wejście ═════════════════════════════════════════════════════════

const ENGINES = {
  bracket: { setup: setupBracket, reduce: reduceBracket, derive: deriveBracket },
  groups: { setup: setupGroups, reduce: reduceGroups, derive: deriveGroups },
  arrows: { setup: setupArrows, reduce: reduceArrows, derive: deriveArrows },
  heats: { setup: setupHeats, reduce: reduceHeats, derive: deriveHeats },
  teams: { setup: setupTeams, reduce: reduceTeams, derive: deriveTeams },
  elimination: { setup: setupElimination, reduce: reduceElimination, derive: deriveElimination },
};

function engineFor(def) {
  const engine = ENGINES[def.engine];
  if (!engine) fail(`Nieznany silnik „${def.engine}”.`);
  return engine;
}

/**
 * Dyscyplina rodzi się w fazie ustawiania: znamy startujących, ale rozstawienia
 * jeszcze nie ma. Nikt — łącznie z sędzią — nie zna go przed losowaniem.
 */
export function createState(def, participants) {
  const clean = requireParticipants(participants);
  return {
    participants: clean,
    withdrawn: withdrawnFrom(clean),
    phase: 'setup',
    drawnAt: null,
    drawCount: 0,
  };
}

/** Zmiana listy startujących wraca do fazy ustawiania — trzeba losować od nowa. */
export function setParticipants(def, state, participants) {
  const clean = requireParticipants(participants);
  return {
    participants: clean,
    withdrawn: withdrawnFrom(clean),
    phase: 'setup',
    drawnAt: null,
    drawCount: state.drawCount ?? 0,
  };
}

/**
 * Losowanie. Wykonuje się na serwerze, więc nikt nie mógł ustawić kolejności
 * wcześniej, a wszyscy dostają je w tej samej sekundzie.
 */
export function drawState(def, state, at = Date.now()) {
  // Powtórka wolna, dopóki nic nie zostało zapisane. „setup” po losowaniu ma tylko
  // water polo, gdzie kapitanowie jeszcze nie skończyli wybierać składów.
  if (state.phase === 'live' && !['ready', 'setup'].includes(derive(def, state).status)) {
    fail('Rozgrywka już się zaczęła — losowania nie da się powtórzyć.');
  }
  return {
    participants: state.participants,
    withdrawn: state.withdrawn,
    phase: 'live',
    drawnAt: at,
    drawCount: (state.drawCount ?? 0) + 1,
    ...engineFor(def).setup(state.participants),
  };
}

export function applyAction(def, state, action) {
  if (!action || typeof action.type !== 'string') fail('Akcja musi mieć typ.');
  if (state.phase !== 'live') fail('Najpierw trzeba wylosować rozstawienie.');
  const next = structuredClone(state);
  const result = engineFor(def).reduce(def, next, action);
  return result ?? next;
}

export function derive(def, state) {
  const base = {
    participants: state.participants,
    withdrawn: state.withdrawn ?? [],
    phase: state.phase ?? 'live',
    drawnAt: state.drawnAt ?? null,
    drawCount: state.drawCount ?? 0,
  };

  if (base.phase !== 'live') {
    return {
      ...base,
      status: 'setup',
      provisional: true,
      places: [],
      board: { kind: 'setup' },
    };
  }

  const result = engineFor(def).derive(def, state);

  // Wylosowane, ale jeszcze nierozegrane: kolejność byłaby czystym przypadkiem
  // (wszyscy mają zero), więc nie rozdajemy za nią punktów.
  if (result.status === 'ready') {
    return { ...base, ...result, places: [], teamPoints: undefined };
  }

  return { ...base, teamPoints: undefined, ...result };
}
