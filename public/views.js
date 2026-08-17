// Plansze dyscyplin. Każda rysuje żywy stan rozgrywki tak, żeby dało się przy niej
// grać: kto z kim, kto strzela, ile brakuje do celu. Sędzia dostaje na tej samej
// planszy przyciski do zapisu — reszta ekipy widzi dokładnie to samo, tylko bez nich.

import { el, flag, who, playerName, button, chip } from './dom.js';

// ── Wspólne klocki ──────────────────────────────────────────────────────────

function panel(title, body, { hint = null, wide = false } = {}) {
  return el(
    'section',
    { class: `panel${wide ? ' panel--wide' : ''}` },
    el(
      'header',
      { class: 'panel__head' },
      el('h3', { text: title }),
      hint ? el('p', { class: 'panel__hint', text: hint }) : null,
    ),
    body,
  );
}

/** Dwa pola na wynik meczu plus zapis. Walidacja siedzi na serwerze. */
function scoreEntry(match, ctx) {
  // data-key pozwala przywrócić ognisko i wpisaną wartość po odświeżeniu na żywo,
  // żeby wynik przychodzący z innej dyscypliny nie kasował tego, co sędzia pisze.
  const field = (value, label, key) =>
    el('input', {
      class: 'score-input',
      type: 'number',
      min: '0',
      max: '99',
      inputmode: 'numeric',
      value: value ?? '',
      'aria-label': label,
      'data-key': key,
    });

  const inA = field(match.sa, `${playerName(match.a)} — wynik`, `score:${match.id}:a`);
  const inB = field(match.sb, `${playerName(match.b)} — wynik`, `score:${match.id}:b`);

  return el(
    'div',
    { class: 'score-entry' },
    inA,
    el('span', { class: 'score-entry__sep', text: ':' }),
    inB,
    button(match.sa === null ? 'Zapisz' : 'Popraw', {
      kind: 'small',
      onClick: () =>
        ctx.dispatch({
          type: 'score',
          match: match.id,
          sa: Number(inA.value),
          sb: Number(inB.value),
        }),
    }),
  );
}

function matchCard(match, ctx, { label = null } = {}) {
  const pending = match.a === null || match.b === null;
  const decided = match.sa !== null && match.sb !== null;
  const winner = decided ? (match.sa > match.sb ? match.a : match.b) : null;

  const side = (player, score) =>
    el(
      'div',
      { class: 'match__side', 'data-winner': String(decided && player === winner) },
      player === null
        ? el('span', { class: 'who who--muted' }, el('span', { class: 'flag flag--empty', text: '?' }), el('span', { class: 'who__name', text: 'czeka' }))
        : who(player),
      el('span', { class: 'match__score', text: score === null ? '–' : String(score) }),
    );

  return el(
    'article',
    { class: 'match', 'data-state': decided ? 'done' : pending ? 'pending' : 'open' },
    label ? el('p', { class: 'match__label', text: label }) : null,
    side(match.a, match.sa),
    side(match.b, match.sb),
    ctx.admin && !pending ? scoreEntry(match, ctx) : null,
  );
}

/** Pasek postępu do celu — widać, ile komu brakuje. */
function meter(value, target) {
  const pct = Math.max(0, Math.min(100, Math.round((value / target) * 100)));
  return el(
    'span',
    { class: 'meter', role: 'img', 'aria-label': `${value} z ${target}` },
    el('span', { class: 'meter__fill', style: `width:${pct}%` }),
  );
}

// ── I. Tenis: drabinka ──────────────────────────────────────────────────────

function roundLabel(round, rounds, hasPrelim) {
  if (round === 'third') return 'Mecz o 3. miejsce';
  if (round === 0 && hasPrelim) return 'Runda wstępna';
  const playing = rounds.filter((r) => r.round !== 'third');
  const last = playing[playing.length - 1].round;
  const fromEnd = last - round;
  if (fromEnd === 0) return 'Finał';
  if (fromEnd === 1) return 'Półfinały';
  if (fromEnd === 2) return 'Ćwierćfinały';
  return `1/${2 ** fromEnd} finału`;
}

function bracketBoard(def, outcome, ctx) {
  const { rounds } = outcome.board;
  const hasPrelim =
    rounds.length > 1 && rounds[0].round === 0 && rounds[0].matches.length < rounds[1].matches.length;

  const columns = rounds.map((round) =>
    el(
      'div',
      { class: 'bracket__col' },
      el('p', { class: 'bracket__label', text: roundLabel(round.round, rounds, hasPrelim) }),
      ...round.matches.map((match) => matchCard(match, ctx)),
    ),
  );

  return panel('Drabinka', el('div', { class: 'bracket' }, ...columns), {
    hint: `Mecz do ${def.params.target} gemów, bez przewag. Wpisujemy zdobyte gemy.`,
    wide: true,
  });
}

// ── II. Ping pong: grupy plus puchar ────────────────────────────────────────

function groupsBoard(def, outcome, ctx) {
  const { tables, matches, playoff, single, groupsDone } = outcome.board;
  const groupName = (i) => (single ? 'Tabela' : `Grupa ${'AB'[i]}`);

  const tableNode = (table, groupIndex) =>
    el(
      'div',
      { class: 'group' },
      el('p', { class: 'group__label', text: groupName(groupIndex) }),
      el(
        'table',
        { class: 'mini-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: '#' }),
            el('th', { class: 'mini-table__who', text: 'Zawodnik' }),
            el('th', { text: 'W', title: 'Zwycięstwa' }),
            el('th', { text: '+/−', title: 'Różnica małych punktów' }),
          ),
        ),
        el(
          'tbody',
          {},
          ...table.map((row, i) =>
            el(
              'tr',
              { 'data-through': String(!single && i < 2 && groupsDone) },
              el('td', { class: 'num', text: String(i + 1) }),
              el('td', { class: 'mini-table__who' }, who(row.player)),
              el('td', { class: 'num', text: String(row.wins) }),
              el('td', { class: 'num', text: formatDiff(row.scored - row.lost) }),
            ),
          ),
        ),
      ),
    );

  const groupMatches = tables.map((_, groupIndex) =>
    el(
      'div',
      { class: 'match-list' },
      el('p', { class: 'match-list__label', text: `${groupName(groupIndex)} — mecze` }),
      ...matches.filter((m) => m.group === groupIndex).map((m) => matchCard(m, ctx)),
    ),
  );

  const parts = [
    panel(
      single ? 'Tabela' : 'Grupy',
      el('div', { class: 'group-grid' }, ...tables.map(tableNode)),
      { hint: `Set do ${def.params.target}. Kolejność: zwycięstwa, potem różnica małych punktów.` },
    ),
    panel('Mecze grupowe', el('div', { class: 'group-grid' }, ...groupMatches), { wide: true }),
  ];

  if (!single) {
    const label = { sf: 'Półfinał', final: 'Finał', third: 'Mecz o 3. miejsce' };
    parts.push(
      panel(
        'Puchar',
        el(
          'div',
          { class: 'bracket' },
          el(
            'div',
            { class: 'bracket__col' },
            el('p', { class: 'bracket__label', text: 'Półfinały' }),
            ...playoff.filter((m) => m.kind === 'sf').map((m) => matchCard(m, ctx)),
          ),
          el(
            'div',
            { class: 'bracket__col' },
            el('p', { class: 'bracket__label', text: 'Finał' }),
            ...playoff.filter((m) => m.kind === 'final').map((m) => matchCard(m, ctx)),
            ...playoff
              .filter((m) => m.kind === 'third')
              .map((m) => matchCard(m, ctx, { label: label.third })),
          ),
        ),
        {
          hint: groupsDone
            ? 'Do dwóch wygranych setów — wpisujemy wynik decydującego seta.'
            : 'Pary ułożą się, gdy skończą się wszystkie mecze grupowe.',
          wide: true,
        },
      ),
    );
  }

  return parts;
}

function formatDiff(value) {
  return value > 0 ? `+${value}` : String(value);
}

// ── III. Łuk: strzały ───────────────────────────────────────────────────────

function arrowsBoard(def, outcome, ctx) {
  const { rows, shooter, total, perSeries, seriesIndex, series, arrowInSeries } = outcome.board;

  const nowCard =
    shooter === null
      ? el('div', { class: 'now now--done' }, el('p', { class: 'now__label', text: 'Wszyscy wystrzelali' }))
      : el(
          'div',
          { class: 'now' },
          el('p', {
            class: 'now__label',
            text: `Seria ${Math.min(seriesIndex + 1, series)} z ${series} · strzał ${arrowInSeries} z ${perSeries} — teraz strzela`,
          }),
          el('div', { class: 'now__who' }, who(shooter, { size: 'lg' })),
          ctx.admin
            ? el(
                'div',
                { class: 'keypad' },
                ...Array.from({ length: def.params.maxArrow + 1 }, (_, value) =>
                  button(String(value), {
                    kind: 'pad',
                    onClick: () => ctx.dispatch({ type: 'arrow', player: shooter, value }),
                    title: value === def.params.maxArrow ? 'Dziesiątka' : `${value} punktów`,
                  }),
                ),
              )
            : null,
        );

  const table = el(
    'table',
    { class: 'mini-table mini-table--arrows' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { class: 'mini-table__who', text: 'Kolejność' }),
        ...Array.from({ length: total }, (_, i) =>
          el('th', { class: 'num', text: String(i + 1), 'data-series-start': String(i % perSeries === 0) }),
        ),
        el('th', { class: 'num', text: 'Σ' }),
        ctx.admin ? el('th', { text: '' }) : null,
      ),
    ),
    el(
      'tbody',
      {},
      ...rows.map((row) =>
        el(
          'tr',
          { 'data-shooting': String(row.player === shooter) },
          el('td', { class: 'mini-table__who' }, who(row.player)),
          ...Array.from({ length: total }, (_, i) =>
            el('td', {
              class: `num arrow-cell${row.values[i] === undefined ? ' arrow-cell--empty' : ''}`,
              'data-series-start': String(i % perSeries === 0),
              'data-ten': String(row.values[i] === def.params.maxArrow),
              text: row.values[i] === undefined ? '·' : String(row.values[i]),
            }),
          ),
          el('td', { class: 'num arrow-total', text: String(row.total) }),
          ctx.admin
            ? el(
                'td',
                {},
                row.shot > 0
                  ? button('↩', {
                      kind: 'tiny',
                      title: `Cofnij ostatni strzał: ${playerName(row.player)}`,
                      onClick: () => ctx.dispatch({ type: 'undoArrow', player: row.player }),
                    })
                  : null,
              )
            : null,
        ),
      ),
    ),
  );

  return [
    panel('Na linii', nowCard, {
      hint: `${series} serie po ${perSeries} strzały. Kto zaczął serię, kończy ją i dopiero potem idzie po strzały.`,
    }),
    panel('Tarcza', el('div', { class: 'scroll-x' }, table), { wide: true }),
  ];
}

// ── IV i V. Kosz i bule: heaty ──────────────────────────────────────────────

/** Opis ostatniego zapisu, żeby sędzia widział, co właśnie kliknął. */
function describeEntry(entry) {
  const name = playerName(entry.player);
  return entry.reset ? `Ostatnio: ${name} — punkty na zero` : `Ostatnio: ${name} +${entry.value}`;
}

function heatsBoard(def, outcome, ctx) {
  const board = outcome.board;
  const { stage, field, target, values, unit, allowZero, heatTables, finalTable, straightFinal } =
    board;
  const stageName = stage === 'final' ? (straightFinal ? 'Gra' : 'Finał') : `Heat ${stage + 1}`;
  const currentTable = stage === 'final' ? finalTable : heatTables[stage];
  const finished = outcome.status === 'done';

  const scoreOf = (player) => currentTable.find((r) => r.player === player)?.score ?? 0;

  const liveRows = [...field]
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .map((player) =>
      el(
        'div',
        { class: 'tally' },
        el('div', { class: 'tally__who' }, who(player)),
        el('div', { class: 'tally__bar' }, meter(scoreOf(player), target)),
        el('div', { class: 'tally__score num', text: `${scoreOf(player)}/${target}` }),
        ctx.admin && !finished
          ? el(
              'div',
              { class: 'tally__buttons' },
              ...values.map((value) =>
                button(`+${value}`, {
                  kind: 'pad',
                  onClick: () => ctx.dispatch({ type: 'point', player, value }),
                }),
              ),
              allowZero
                ? button('0', {
                    kind: 'zero',
                    title: `${playerName(player)} — pudło w powietrze, punkty na zero`,
                    onClick: () => ctx.dispatch({ type: 'zero', player }),
                  })
                : null,
            )
          : null,
      ),
    );

  const parts = [
    panel(
      `${stageName} — do ${target} ${unit}`,
      el(
        'div',
        {},
        el('div', { class: 'tally-list' }, ...liveRows),
        // Kolejność ma znaczenie — po każdym rzucie zbiera następna osoba z tej listy.
        el(
          'div',
          { class: 'order-strip' },
          el('span', { class: 'hint', text: 'Kolejność zbiórki:' }),
          ...field.map((player) => el('span', { class: 'order-strip__item' }, flag(player))),
        ),
        ctx.admin
          ? el(
              'div',
              { class: 'actions' },
              button('Cofnij ostatni zapis', {
                kind: 'ghost',
                disabled: board.logLength === 0,
                onClick: () => ctx.dispatch({ type: 'undo' }),
              }),
              board.lastEntry
                ? el('span', { class: 'hint', text: describeEntry(board.lastEntry) })
                : null,
            )
          : null,
      ),
      {
        hint: straightFinal
          ? 'Do pięciu osób gramy jednym biegiem od razu o wszystko.'
          : stage === 'final'
            ? 'Finał czwórki wyłoniony z heatów.'
            : `Kolejność w heacie jest wylosowana. Bieg zamyka się sam, gdy ktoś dobije do ${target}.`,
      },
    ),
  ];

  if (!straightFinal) {
    parts.push(
      panel(
        'Heaty',
        el(
          'div',
          { class: 'group-grid' },
          ...heatTables.map((table, i) =>
            el(
              'div',
              { class: 'group' },
              el('p', {
                class: 'group__label',
                text: `Heat ${i + 1}${stage === i ? ' — w trakcie' : ''}`,
              }),
              el(
                'ol',
                { class: 'order-list' },
                ...table.map((row, place) =>
                  el(
                    'li',
                    { class: 'order-list__item', 'data-through': String(place < 2 && stage === 'final') },
                    who(row.player),
                    el('span', { class: 'num order-list__score', text: String(row.score) }),
                  ),
                ),
              ),
            ),
          ),
        ),
        { hint: 'Po dwie najlepsze osoby z każdego heatu wchodzą do finału.' },
      ),
    );
  }

  return parts;
}

// ── VI. Water polo: składy i gole ───────────────────────────────────────────

/** Wężyk wyborów: A – B – B – A – A – B … żeby pierwszy wybór nie dawał przewagi. */
function snakeOrder(count) {
  const out = [];
  let side = 'A';
  while (out.length < count) {
    out.push(side);
    if (out.length < count) out.push(side === 'A' ? 'B' : 'A');
    side = side === 'A' ? 'B' : 'A';
  }
  return out.slice(0, count);
}

function teamsBoard(def, outcome, ctx) {
  const { teamA, teamB, scoreA, scoreB, goals, mvp, finished, captains, unassigned, ready, points } =
    outcome.board;

  const goalsBy = (player) => goals.filter((g) => g.player === player).length;

  const teamColumn = (list, letter, score) =>
    el(
      'div',
      { class: 'team', 'data-side': letter },
      el(
        'div',
        { class: 'team__head' },
        el('p', { class: 'team__label', text: `Drużyna ${letter}` }),
        el('p', { class: 'team__score num', text: String(score) }),
      ),
      el(
        'ul',
        { class: 'team__list' },
        ...list.map((player) =>
          el(
            'li',
            { class: 'team__row' },
            who(player),
            captains.includes(player) ? chip('kapitan', 'open') : null,
            goalsBy(player) > 0
              ? el('span', { class: 'num team__goals', text: `${goalsBy(player)}×` })
              : null,
            ctx.admin && ready && !finished
              ? el(
                  'span',
                  { class: 'team__buttons' },
                  button('Gol', {
                    kind: 'pad',
                    onClick: () => ctx.dispatch({ type: 'goal', player }),
                  }),
                )
              : null,
          ),
        ),
        list.length === 0 ? el('li', { class: 'hint', text: 'pusto' }) : null,
      ),
    );

  const assign = (player, side) => {
    const nextA = side === 'A' ? [...teamA, player] : teamA.filter((i) => i !== player);
    const nextB = side === 'B' ? [...teamB, player] : teamB.filter((i) => i !== player);
    ctx.dispatch({ type: 'teams', teamA: nextA, teamB: nextB });
  };

  const parts = [];

  if (!ready) {
    const picks = snakeOrder(unassigned.length + (teamA.length - 1) + (teamB.length - 1));
    const madeSoFar = teamA.length - 1 + (teamB.length - 1);
    const nextPick = picks[madeSoFar] ?? null;

    parts.push(
      panel(
        'Kapitanowie wybierają',
        el(
          'div',
          {},
          el(
            'p',
            { class: 'lead' },
            nextPick
              ? `Teraz wybiera kapitan ${nextPick}: `
              : 'Wybór zakończony, ',
            nextPick ? who(nextPick === 'A' ? captains[0] : captains[1]) : 'składy gotowe.',
          ),
          el('p', { class: 'hint', text: `Kolejność wężyka: ${picks.join(' – ') || '—'}` }),
          el(
            'ul',
            { class: 'pool' },
            ...unassigned.map((player) =>
              el(
                'li',
                { class: 'pool__row' },
                who(player),
                ctx.admin
                  ? el(
                      'span',
                      { class: 'segmented' },
                      el('button', { type: 'button', text: 'do A', onclick: () => assign(player, 'A') }),
                      el('button', { type: 'button', text: 'do B', onclick: () => assign(player, 'B') }),
                    )
                  : null,
              ),
            ),
            unassigned.length === 0 ? el('li', { class: 'hint', text: 'Wszyscy przypisani.' }) : null,
          ),
        ),
        { hint: 'Losowanie wybrało kapitanów. Resztę składów wybierają oni sami, na zmianę.' },
      ),
    );
  }

  parts.push(
    panel(
      ready ? `${scoreA} : ${scoreB}` : 'Składy',
      el(
        'div',
        {},
        el('div', { class: 'teams' }, teamColumn(teamA, 'A', scoreA), teamColumn(teamB, 'B', scoreB)),
        ctx.admin && ready
          ? el(
              'div',
              { class: 'actions' },
              button('Cofnij gola', {
                kind: 'ghost',
                disabled: goals.length === 0,
                onClick: () => ctx.dispatch({ type: 'undoGoal' }),
              }),
              button(finished ? 'Wznów mecz' : 'Zakończ mecz', {
                kind: finished ? 'ghost' : '',
                onClick: () => ctx.dispatch({ type: finished ? 'unfinish' : 'finish' }),
              }),
              ctx.admin
                ? el(
                    'label',
                    { class: 'inline-field' },
                    el('span', { class: 'hint', text: 'MVP' }),
                    el(
                      'select',
                      {
                        'aria-label': 'MVP meczu',
                        onchange: (event) =>
                          ctx.dispatch({
                            type: 'mvp',
                            player: event.target.value === '' ? null : Number(event.target.value),
                          }),
                      },
                      el('option', { value: '', text: '— brak —', selected: mvp === null }),
                      ...[...teamA, ...teamB].map((player) =>
                        el('option', {
                          value: String(player),
                          text: playerName(player),
                          selected: mvp === player,
                        }),
                      ),
                    ),
                  )
                : null,
            )
          : null,
        mvp !== null && mvp !== undefined
          ? el('p', { class: 'lead' }, 'MVP meczu: ', who(mvp), el('span', { class: 'hint', text: ` +${points.mvp} pkt` }))
          : null,
      ),
      {
        hint: ready
          ? `Wygrana ${points.win} pkt dla każdego, przegrana ${points.loss}, remis ${points.draw}. Mecz 2 × ${def.params.minutes} min albo do ${def.params.goalCap} goli.`
          : 'Punkty pojawią się, gdy oba składy będą kompletne.',
      },
    ),
  );

  if (goals.length > 0) {
    parts.push(
      panel(
        'Strzelcy',
        el(
          'ol',
          { class: 'goal-log' },
          ...goals.map((goal, i) =>
            el(
              'li',
              { class: 'goal-log__item' },
              el('span', { class: 'num goal-log__no', text: String(i + 1) }),
              who(goal.player),
              chip(teamA.includes(goal.player) ? 'A' : 'B'),
            ),
          ),
        ),
      ),
    );
  }

  return parts;
}

// ── VII. Poker: stół ────────────────────────────────────────────────────────

function eliminationBoard(def, outcome, ctx) {
  const { seats, remaining, busted, total, nextPlace } = outcome.board;
  const finished = outcome.status === 'done';

  const seatRows = seats.map((player) => {
    const bustIndex = busted.indexOf(player);
    const out = bustIndex >= 0;
    const place = out ? total - bustIndex : null;
    return el(
      'li',
      { class: 'seat', 'data-out': String(out) },
      who(player, { muted: out }),
      out
        ? el('span', { class: 'num seat__place', text: `${place}. miejsce` })
        : finished
          ? chip('zwycięzca', 'done')
          : ctx.admin
            ? button('Wypadł', {
                kind: 'tiny',
                onClick: () => ctx.dispatch({ type: 'bust', player }),
              })
            : chip('w grze', 'live'),
    );
  });

  return panel(
    finished ? 'Stół rozbity' : `Gra się o ${nextPlace}. miejsce`,
    el(
      'div',
      {},
      el('ol', { class: 'seats' }, ...seatRows),
      ctx.admin
        ? el(
            'div',
            { class: 'actions' },
            button('Cofnij ostatnie wypadnięcie', {
              kind: 'ghost',
              disabled: busted.length === 0,
              onClick: () => ctx.dispatch({ type: 'undoBust' }),
            }),
            el('span', {
              class: 'hint',
              text: 'Kończycie przed czasem? Wyklikujcie pozostałych od najmniejszego stacka.',
            }),
          )
        : null,
    ),
    {
      hint: `Miejsca przy stole wylosowane. Zostało ${remaining.length} z ${total} osób.`,
    },
  );
}

// ── Rozdzielnik ─────────────────────────────────────────────────────────────

const BOARDS = {
  bracket: bracketBoard,
  groups: groupsBoard,
  arrows: arrowsBoard,
  heats: heatsBoard,
  teams: teamsBoard,
  elimination: eliminationBoard,
};

export function renderBoard(def, outcome, ctx) {
  const renderer = BOARDS[outcome.board.kind];
  if (!renderer) return el('p', { class: 'hint', text: 'Nieznany typ planszy.' });
  const result = renderer(def, outcome, ctx);
  return el('div', { class: 'panels' }, ...[result].flat());
}
