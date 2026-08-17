// Test silników rozgrywki — przechodzi każdą dyscyplinę od startu do rozstrzygnięcia.
import assert from 'node:assert/strict';
import { PLAYERS, DISCIPLINES, disciplineById, computeStandings } from '../config.mjs';
import { createState, setParticipants, drawState, applyAction, derive } from '../engines.mjs';

const ALL = PLAYERS.map((_, i) => i);
const names = (list) => list.map((i) => PLAYERS[i].name).join(' > ');
let checks = 0;
const ok = (label) => { checks += 1; console.log('  ✓', label); };

/** Otwarcie dyscypliny plus losowanie — normalna droga sędziego. */
const begin = (def, participants) => drawState(def, createState(def, participants));

function playAllMatches(def, state, pick = 'a') {
  // Rozgrywa każdy mecz, który ma już obu zawodników, dopóki takie istnieją.
  for (let guard = 0; guard < 200; guard += 1) {
    const board = derive(def, state).board;
    const pending = [];
    if (board.kind === 'bracket') {
      for (const round of board.rounds) {
        for (const m of round.matches) {
          if (m.a !== null && m.b !== null && m.sa === null) pending.push(m.id);
        }
      }
    } else {
      for (const m of board.matches) if (m.sa === null) pending.push(m.id);
      for (const m of board.playoff) {
        if (m.a !== null && m.b !== null && m.sa === null) pending.push(m.id);
      }
    }
    if (pending.length === 0) return state;
    for (const id of pending) {
      state = applyAction(def, state, {
        type: 'score',
        match: id,
        sa: pick === 'a' ? 4 : 2,
        sb: pick === 'a' ? 2 : 4,
      });
    }
  }
  throw new Error('Rozgrywka się nie kończy — pętla w drabince?');
}

console.log('\n── I. Tenis: drabinka na 9 osób ───────────────────────────────');
{
  const def = disciplineById('tenis');
  let state = begin(def, ALL);
  const first = derive(def, state);
  assert.equal(first.status, 'ready');
  assert.equal(first.withdrawn.length, 0);
  const matchCount = first.board.rounds.flatMap((r) => r.matches).length;
  assert.equal(matchCount, 9, 'runda wstępna + 4 + 2 + finał + mecz o 3.');
  ok(`9 zawodników → ${matchCount} meczów, w tym runda wstępna`);

  // Nikt nie może trafić na pustego przeciwnika.
  const prelim = first.board.rounds[0].matches;
  assert.equal(prelim.length, 1);
  assert.ok(prelim[0].a !== null && prelim[0].b !== null);
  ok('runda wstępna ma dwóch realnych zawodników, brak walkowerów');

  state = playAllMatches(def, state);
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(done.provisional, false);
  assert.equal(new Set(done.places).size, 9, 'każdy startujący ma dokładnie jedno miejsce');
  ok(`rozstrzygnięte: ${names(done.places.slice(0, 4))} …`);

  // Korekta wyniku półfinału musi wyczyścić finał.
  // Uwaga: rounds ma na końcu mecz o 3. miejsce, więc półfinał szukamy po numerze rundy.
  const finalRound = done.board.rounds.find((r) =>
    r.matches.some((m) => m.id === done.board.finalId),
  ).round;
  const semi = done.board.rounds.find((r) => r.round === finalRound - 1).matches[0];
  const flipped = applyAction(def, state, { type: 'score', match: semi.id, sa: 2, sb: 4 });
  const after = derive(def, flipped);
  assert.equal(after.status, 'live', 'finał czeka na ponowne rozegranie');
  ok('zmiana zwycięzcy półfinału czyści finał i mecz o 3. miejsce');

  assert.throws(() => applyAction(def, state, { type: 'score', match: 'm0', sa: 3, sb: 3 }), /remis/);
  ok('remis w meczu odrzucony');
}

console.log('\n── II. Ping pong: dwie grupy z dziewiątki ─────────────────────');
{
  const def = disciplineById('pingpong');
  let state = begin(def, ALL);
  const start = derive(def, state);
  assert.equal(start.board.tables.length, 2);
  const sizes = start.board.tables.map((t) => t.length).sort();
  assert.deepEqual(sizes, [4, 5], 'dziewiątka dzieli się na 4 i 5');
  ok(`grupy po ${sizes.join(' i ')} osoby, ${start.board.matches.length} meczów grupowych`);

  state = playAllMatches(def, state);
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(new Set(done.places).size, 9);
  ok(`rozstrzygnięte: ${names(done.places.slice(0, 4))} …`);
}

console.log('\n── II. Ping pong: piątka gra jedną grupą ──────────────────────');
{
  const def = disciplineById('pingpong');
  let state = begin(def, [0, 1, 2, 4, 8]);
  const start = derive(def, state);
  assert.equal(start.board.single, true);
  assert.equal(start.board.matches.length, 10, 'każdy z każdym w piątce');
  state = playAllMatches(def, state);
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(done.places.length, 5);
  assert.deepEqual(done.withdrawn.sort((a, b) => a - b), [3, 5, 6, 7]);
  ok('jedna grupa, 4 osoby na rezygnacji poza klasyfikacją miejsc');
}

console.log('\n── III. Łuk: kolejność i serie ────────────────────────────────');
{
  const def = disciplineById('luk');
  let state = begin(def, ALL);
  let board = derive(def, state).board;
  assert.equal(board.total, 6, '3 serie po 2 strzały');
  assert.equal(board.perSeries, 2);
  assert.equal(board.arrowInSeries, 1);
  const firstShooter = board.shooter;
  assert.ok(firstShooter !== null);
  ok(`kolejność wylosowana, pierwszy strzela ${PLAYERS[firstShooter].name}`);

  // Mamy dwie strzały, więc kto zaczął serię, oddaje oba strzały, a dopiero potem
  // idzie po strzały i przekazuje łuk następnej osobie.
  state = applyAction(def, state, { type: 'arrow', player: firstShooter, value: 9 });
  board = derive(def, state).board;
  assert.equal(board.shooter, firstShooter, 'ta sama osoba oddaje drugi strzał serii');
  assert.equal(board.arrowInSeries, 2);
  ok('rotacja idzie seriami: drugi strzał oddaje ta sama osoba');

  state = applyAction(def, state, { type: 'arrow', player: firstShooter, value: 7 });
  board = derive(def, state).board;
  assert.notEqual(board.shooter, firstShooter, 'po pełnej serii łuk idzie dalej');
  assert.equal(board.arrowInSeries, 1);
  ok('po dwóch strzałach kolejka przechodzi do następnej osoby');

  // Dostrzeliwujemy wszystkich: im dalej w kolejności, tym słabiej.
  for (let guard = 0; guard < 100; guard += 1) {
    const now = derive(def, state).board;
    if (now.shooter === null) break;
    const value = Math.max(0, 10 - now.rows.findIndex((r) => r.player === now.shooter));
    state = applyAction(def, state, { type: 'arrow', player: now.shooter, value });
  }
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(done.places.length, 9);
  assert.ok(done.board.rows.every((r) => r.shot === 6), 'każdy oddał dokładnie 6 strzałów');
  ok(`wszyscy wystrzelali 6 strzałów, czoło: ${names(done.places.slice(0, 3))}`);

  assert.throws(() => applyAction(def, state, { type: 'arrow', player: 0, value: 5 }), /wystrzelał/);
  ok('siódmy strzał odrzucony');
  assert.throws(() => applyAction(def, state, { type: 'arrow', player: 0, value: 11 }), /od 0 do 10/);
  ok('strzał poza tarczę odrzucony');
}

console.log('\n── IV. Kosz: +1, +2 i zerowanie ──────────────────────────────');
{
  const def = disciplineById('kosz');
  let state = begin(def, ALL);
  let board = derive(def, state).board;
  assert.equal(board.stage, 0);
  assert.equal(board.target, 15);
  assert.deepEqual(board.values, [1, 2]);
  assert.equal(board.allowZero, true);
  ok(`dwa heaty (${board.heats.map((h) => h.length).join(' i ')} osoby), gra do 15 po 1 i 2 pkt`);

  const scoreOf = (player) => {
    const b = derive(def, state).board;
    const table = b.stage === 'final' ? b.finalTable : b.heatTables[b.stage];
    return table.find((r) => r.player === player)?.score ?? 0;
  };

  const [first, second] = board.field;

  state = applyAction(def, state, { type: 'point', player: first, value: 1 });
  state = applyAction(def, state, { type: 'point', player: first, value: 2 });
  state = applyAction(def, state, { type: 'point', player: second, value: 2 });
  assert.equal(scoreOf(first), 3, 'rzut ze środka 1 plus rzut po zbiórce 2');
  assert.equal(scoreOf(second), 2);
  ok('punkty dopisują się po 1 i po 2');

  // Pudło w powietrze zabiera cały dorobek, ale tylko rzucającemu.
  state = applyAction(def, state, { type: 'zero', player: first });
  assert.equal(scoreOf(first), 0, 'zerowanie czyści dorobek');
  assert.equal(scoreOf(second), 2, 'i nie rusza pozostałych');
  ok('zerowanie zabiera punkty tylko tej jednej osobie');

  const restored = applyAction(def, state, { type: 'undo' });
  const restoredScore = (() => {
    const b = derive(def, restored).board;
    return b.heatTables[b.stage].find((r) => r.player === first)?.score ?? 0;
  })();
  assert.equal(restoredScore, 3, 'cofnięcie zerowania przywraca punkty');
  ok('cofnięcie zerowania przywraca dorobek');

  // Po zerowaniu można normalnie zbierać dalej.
  state = applyAction(def, state, { type: 'point', player: first, value: 2 });
  assert.equal(scoreOf(first), 2, 'liczymy od zera w górę');
  ok('po zerowaniu punkty rosną od nowa');

  assert.throws(() => applyAction(def, state, { type: 'point', player: first, value: 3 }), /Można dopisać/);
  ok('kosz przyjmuje tylko 1 i 2 punkty');

  // Dogrywamy do końca po 2 punkty na osobę prowadzącą w danym biegu.
  for (let guard = 0; guard < 400; guard += 1) {
    const out = derive(def, state);
    if (out.status === 'done') break;
    state = applyAction(def, state, { type: 'point', player: out.board.field[0], value: 2 });
  }
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(new Set(done.places).size, 9);
  ok(`rozstrzygnięte: ${names(done.places.slice(0, 4))} …`);

  assert.throws(() => applyAction(def, state, { type: 'point', player: 0, value: 1 }), /rozstrzygnięta/);
  ok('dopisanie punktu po rozstrzygnięciu odrzucone');

  const bule = disciplineById('bule');
  const buleState = begin(bule, ALL);
  assert.throws(
    () => applyAction(bule, buleState, { type: 'zero', player: derive(bule, buleState).board.field[0] }),
    /nie zeruje/,
  );
  ok('bule nie mają zerowania — tylko kosz');
}

console.log('\n── IV. Kosz: piątka gra od razu finał ────────────────────────');
{
  const def = disciplineById('kosz');
  const state = begin(def, [0, 1, 2, 3, 4]);
  const out = derive(def, state);
  assert.equal(out.board.straightFinal, true);
  assert.equal(out.board.stage, 'final');
  assert.equal(out.board.target, 21);
  ok('do pięciu osób nie ma heatów, od razu jedna gra do 21');
}

console.log('\n── V. Bule: własne wartości punktowe ─────────────────────────');
{
  const def = disciplineById('bule');
  const state = begin(def, ALL);
  const out = derive(def, state);
  assert.deepEqual(out.board.values, [1, 2, 3]);
  assert.equal(out.board.target, 7);
  const next = applyAction(def, state, { type: 'point', player: out.board.field[0], value: 3 });
  assert.equal(derive(def, next).board.heatTables[0].find((r) => r.player === out.board.field[0]).score, 3);
  ok('bule liczą po 1, 2 i 3 punkty, heat do 7');
}

console.log('\n── VI. Water polo: 5 na 4 z golami i MVP ─────────────────────');
{
  const def = disciplineById('waterpolo');
  let state = begin(def, ALL);
  assert.equal(derive(def, state).status, 'setup');

  const teamA = [0, 1, 2, 3, 4];
  const teamB = [5, 6, 7, 8];
  assert.throws(() => applyAction(def, state, { type: 'teams', teamA: [0, 1], teamB: [2, 3] }), /nie został przypisany/);
  ok('niepełny podział składów odrzucony');
  assert.throws(() => applyAction(def, state, { type: 'teams', teamA: [0, 1, 2, 3, 4, 5, 6], teamB: [7, 8] }), /jedną osobą/);
  ok('drużyny 7 na 2 odrzucone');

  state = applyAction(def, state, { type: 'teams', teamA, teamB });
  state = applyAction(def, state, { type: 'goal', player: 0 });
  state = applyAction(def, state, { type: 'goal', player: 0 });
  state = applyAction(def, state, { type: 'goal', player: 5 });
  state = applyAction(def, state, { type: 'mvp', player: 5 });
  state = applyAction(def, state, { type: 'finish' });

  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(done.board.scoreA, 2);
  assert.equal(done.board.scoreB, 1);
  assert.equal(done.teamPoints[0], 9, 'zwycięzca 9 punktów');
  assert.equal(done.teamPoints[6], 3, 'przegrany 3 punkty');
  assert.equal(done.teamPoints[5], 5, 'przegrany z MVP: 3 + 2');
  ok(`2:1 dla A, MVP z przegranej drużyny dostaje 3+2=${done.teamPoints[5]}`);

  const undone = applyAction(def, applyAction(def, state, { type: 'unfinish' }), { type: 'undoGoal' });
  const tie = derive(def, undone);
  assert.equal(tie.board.scoreA, 2);
  assert.equal(tie.board.scoreB, 0);
  ok('cofnięcie gola przelicza wynik');
}

console.log('\n── VII. Poker: kolejność wypadania ───────────────────────────');
{
  const def = disciplineById('poker');
  let state = begin(def, ALL);
  assert.equal(derive(def, state).board.nextPlace, 9, 'pierwszy wypadający zajmuje 9. miejsce');

  for (const player of [3, 7, 1, 8, 0, 6, 2]) {
    state = applyAction(def, state, { type: 'bust', player });
  }
  const nearlyDone = derive(def, state);
  assert.equal(nearlyDone.status, 'live');
  assert.equal(nearlyDone.board.remaining.length, 2);

  state = applyAction(def, state, { type: 'bust', player: nearlyDone.board.remaining[1] });
  const done = derive(def, state);
  assert.equal(done.status, 'done');
  assert.equal(done.places.at(-1), 3, 'kto wypadł pierwszy, ten ostatni');
  ok(`zwycięzca: ${PLAYERS[done.places[0]].name}, ostatni: ${PLAYERS[done.places.at(-1)].name}`);

  assert.throws(() => applyAction(def, state, { type: 'bust', player: done.places[0] }), /rozstrzygnięty/);
  ok('wyklikanie ostatniego gracza odrzucone');
}

console.log('\n── Klasyfikacja: rezygnacja to zero bez handicapu ────────────');
{
  const luk = disciplineById('luk');
  const kosz = disciplineById('kosz');

  // Łuk: startuje tylko trójka, Maja wygrywa.
  let arrows = begin(luk, [8, 0, 1]);
  for (let guard = 0; guard < 60; guard += 1) {
    const shooter = derive(luk, arrows).board.shooter;
    if (shooter === null) break;
    arrows = applyAction(luk, arrows, { type: 'arrow', player: shooter, value: shooter === 8 ? 10 : 1 });
  }
  const lukOut = derive(luk, arrows);
  assert.equal(lukOut.status, 'done');
  assert.equal(lukOut.places[0], 8);

  const standings = computeStandings({ luk: lukOut });
  const maja = standings.find((r) => r.index === 8);
  const blanka = standings.find((r) => r.index === 2);
  assert.equal(maja.points.luk, 12, 'zwycięstwo w trójce warte tyle samo co w dziewiątce');
  assert.equal(maja.total, 12);
  assert.equal(blanka.withdrew.luk, true);
  assert.equal(blanka.points.luk, 0);
  assert.equal(blanka.total, 0);
  ok('Maja wygrywa łuk w trójce → 12 pkt; kto zrezygnował → 0 pkt i rezygnacja w tabeli');

  assert.throws(() => createState(kosz, [4]), /co najmniej dwie/);
  ok('dyscyplina z jedną osobą odrzucona');
}


console.log('\n── Losowanie: faza ustawiania przed rozstawieniem ────────────');
{
  const def = disciplineById('tenis');
  const fresh = createState(def, ALL);
  const before = derive(def, fresh);
  assert.equal(before.status, 'setup');
  assert.equal(before.phase, 'setup');
  assert.equal(before.drawnAt, null);
  assert.deepEqual(before.places, [], 'przed losowaniem nikt nie ma miejsca');
  assert.equal(before.board.kind, 'setup');
  ok('otwarta dyscyplina czeka w fazie ustawiania, bez rozstawienia');

  // Klasyfikacja nie może dostać punktów z dyscypliny, która nie wystartowała.
  const standings = computeStandings({ tenis: before });
  assert.ok(standings.every((r) => r.total === 0));
  ok('faza ustawiania nie daje nikomu punktów');

  assert.throws(
    () => applyAction(def, fresh, { type: 'score', match: 'm0', sa: 4, sb: 2 }),
    /wylosować/,
  );
  ok('zapis wyniku przed losowaniem odrzucony');

  const drawn = drawState(def, fresh, 1_700_000_000_000);
  assert.equal(drawn.phase, 'live');
  assert.equal(drawn.drawnAt, 1_700_000_000_000);
  assert.equal(drawn.drawCount, 1);
  assert.equal(derive(def, drawn).status, 'ready');
  ok('losowanie znaczy stan czasem serwera, więc animacja odpala się u wszystkich naraz');

  // Póki nic nie rozegrano, można losować od nowa — ale już nie później.
  const redrawn = drawState(def, drawn, 1_700_000_050_000);
  assert.equal(redrawn.drawCount, 2);
  ok('powtórne losowanie dozwolone, dopóki nie ma ani jednego wyniku');

  const firstMatch = derive(def, redrawn).board.rounds[0].matches[0];
  const played = applyAction(def, redrawn, { type: 'score', match: firstMatch.id, sa: 4, sb: 1 });
  assert.throws(() => drawState(def, played), /nie da się powtórzyć/);
  ok('po pierwszym wyniku losowania nie da się przekręcić');

  // Zmiana listy startujących cofa do ustawiania i wymusza nowe losowanie.
  const reduced = setParticipants(def, played, [0, 1, 2, 3]);
  assert.equal(reduced.phase, 'setup');
  assert.equal(derive(def, reduced).status, 'setup');
  assert.deepEqual(derive(def, reduced).withdrawn.sort((a, b) => a - b), [4, 5, 6, 7, 8]);
  ok('zmiana składu wraca do ustawiania i każe losować od nowa');
}

console.log('\n── Losowanie: co dokładnie losuje każda dyscyplina ───────────');
{
  const wp = disciplineById('waterpolo');
  const teams = drawState(wp, createState(wp, ALL));
  const wpBoard = derive(wp, teams).board;
  assert.equal(wpBoard.captains.length, 2);
  assert.notEqual(wpBoard.captains[0], wpBoard.captains[1]);
  assert.deepEqual(wpBoard.teamA, [wpBoard.captains[0]]);
  assert.deepEqual(wpBoard.teamB, [wpBoard.captains[1]]);
  assert.equal(wpBoard.unassigned.length, 7, 'kapitanowie mają jeszcze siedmiu do wybrania');
  assert.equal(derive(wp, teams).status, 'setup', 'niepełne składy to jeszcze nie mecz');
  assert.equal(derive(wp, teams).teamPoints, undefined, 'żadnych punktów przed kompletnymi składami');
  ok(`water polo losuje kapitanów: ${names(wpBoard.captains)}`);

  const poker = disciplineById('poker');
  const seated = drawState(poker, createState(poker, ALL));
  const seats = derive(poker, seated).board.seats;
  assert.equal(seats.length, 9);
  assert.equal(new Set(seats).size, 9);
  ok('poker losuje miejsca przy stole');

  const luk = disciplineById('luk');
  const shooting = drawState(luk, createState(luk, ALL));
  const order = derive(luk, shooting).board.rows.map((r) => r.player);
  assert.equal(new Set(order).size, 9);
  ok('łuk losuje kolejność strzelania');
}


console.log('\n── Water polo: nic się nie liczy przed kompletnymi składami ───');
{
  const wp = disciplineById('waterpolo');
  const drawn = drawState(wp, createState(wp, ALL));
  const captain = derive(wp, drawn).board.captains[0];
  assert.throws(() => applyAction(wp, drawn, { type: 'goal', player: captain }), /skończyć wybierać/);
  ok('gol przed skończeniem wyboru składów odrzucony');

  // Póki nic nie zapisano, kapitanów można wylosować od nowa.
  const again = drawState(wp, drawn);
  assert.equal(again.drawCount, 2);
  ok('powtórne losowanie kapitanów dozwolone, dopóki nie ma gola');

  const full = applyAction(wp, drawn, { type: 'teams', teamA: [0, 1, 2, 3, 4], teamB: [5, 6, 7, 8] });
  assert.equal(derive(wp, full).status, 'ready');
  const scored = applyAction(wp, full, { type: 'goal', player: 0 });
  assert.throws(() => drawState(wp, scored), /nie da się powtórzyć/);
  ok('po pierwszym golu losowania kapitanów już nie da się przekręcić');
}


console.log('\n── Wylosowane, ale nierozegrane: zero punktów ─────────────────');
{
  const luk = disciplineById('luk');
  const drawn = begin(luk, ALL);
  const out = derive(luk, drawn);
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.places, [], 'przy zerowych wynikach kolejność byłaby losowa');
  assert.ok(computeStandings({ luk: out }).every((r) => r.total === 0));
  ok('samo losowanie nie rozdaje punktów, choć plansza już stoi');

  // Pierwszy strzał uruchamia prowizoryczną kolejność.
  const shooter = out.board.shooter;
  const live = applyAction(luk, drawn, { type: 'arrow', player: shooter, value: 10 });
  const liveOut = derive(luk, live);
  assert.equal(liveOut.status, 'live');
  assert.equal(liveOut.places[0], shooter);
  assert.equal(computeStandings({ luk: liveOut }).find((r) => r.index === shooter).points.luk, 12);
  ok('pierwszy strzał otwiera punktację i prowadzi ten, kto trafił');

  // Water polo: kompletne składy bez gola to jeszcze nie remis do rozliczenia.
  const wp = disciplineById('waterpolo');
  const teams = applyAction(wp, drawState(wp, createState(wp, ALL)), {
    type: 'teams', teamA: [0, 1, 2, 3, 4], teamB: [5, 6, 7, 8],
  });
  const wpOut = derive(wp, teams);
  assert.equal(wpOut.status, 'ready');
  assert.equal(wpOut.teamPoints, undefined);
  assert.ok(computeStandings({ waterpolo: wpOut }).every((r) => r.total === 0));
  ok('składy gotowe, ale przed pierwszym golem nikt nie ma punktów');

  // Mecz zakończony bez gola to prawdziwy remis i punkty się należą.
  const finished = applyAction(wp, teams, { type: 'finish' });
  const finishedOut = derive(wp, finished);
  assert.equal(finishedOut.status, 'done');
  assert.equal(finishedOut.teamPoints[0], 6, 'zakończone 0:0 to remis');
  ok('zakończony mecz 0:0 rozlicza się jako remis po 6 pkt');
}

console.log(`\n✓ ${checks} sprawdzeń przeszło\n`);
