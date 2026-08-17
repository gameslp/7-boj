// Settebello — jedyne źródło prawdy o zawodnikach, dyscyplinach i punktacji.
// Serwer liczy z tego klasyfikację, a przeglądarka dostaje to samo przez /api/config.

// Kolejność w tej tablicy to identyfikatory zawodników w bazie.
// Dopisanie kogoś na końcu jest bezpieczne; przestawienie kolejności w trakcie
// turnieju przypisze zapisane wyniki do innych osób.
export const PLAYERS = [
  { name: 'Maciek',   mono: 'MA', c1: '#7B1E2B', c2: '#D8AE34' },
  { name: 'Pola',     mono: 'PO', c1: '#C9971F', c2: '#1F5C8B' },
  { name: 'Blanka',   mono: 'BL', c1: '#3E8FBA', c2: '#EFEADA' },
  { name: 'Milo',     mono: 'MI', c1: '#D2712A', c2: '#EFEADA' },
  { name: 'Marcin C', mono: 'MC', c1: '#2B2B24', c2: '#D2712A' },
  { name: 'Marcin Z', mono: 'MZ', c1: '#6B2233', c2: '#1F5C8B' },
  { name: 'Kate',     mono: 'KA', c1: '#2F6B3E', c2: '#D2712A' },
  { name: 'Aga',      mono: 'AG', c1: '#B9941F', c2: '#2B2B24' },
  { name: 'Maja',     mono: 'MJ', c1: '#1F6F72', c2: '#EFEADA' },
];

// Punkty za miejsca 1–9. Skala jest przypisana do miejsca, nie do liczby startujących:
// pierwsze miejsce zawsze daje 12 punktów, również gdy w dyscyplinie startuje pięć osób.
export const SCALE = [12, 10, 8, 6, 5, 4, 3, 2, 1];

// Water polo jest drużynowe, więc ma własną punktację.
export const WP_POINTS = { win: 9, draw: 6, loss: 3, mvp: 2 };

export const GENERAL_RULES = [
  'W każdej dyscyplinie miejsca dają punkty: 12 – 10 – 8 – 6 – 5 – 4 – 3 – 2 – 1. Skala jest ta sama wszędzie, więc żadna dyscyplina nie waży więcej od innych.',
  'Z każdej dyscypliny można zrezygnować i nikt nie musi się tłumaczyć. Rezygnacja oznacza zero punktów z tej dyscypliny — bez wyrównywania i bez przeliczania skali dla tych, którzy zostali.',
  'Punkty są przypisane do miejsca, nie do liczby startujących. Kto wygrywa dyscyplinę, w której gra pięć osób, dostaje te same 12 punktów co zwycięzca pełnej dziewiątki.',
  'Przed każdą dyscypliną losujemy od nowa: grupy, heaty, drabinki i kolejność strzałów. Ten sam pech nie ciągnie się przez cały turniej.',
  'Wszystko liczy się na bieżąco. Po każdym meczu, każdym strzale i każdym koszu klasyfikacja przelicza się u wszystkich na telefonach.',
  'Remis w klasyfikacji generalnej: wygrywa ten, kto ma więcej pierwszych miejsc. Dalej — więcej drugich. Jeśli nadal remis, baraż: jeden strzał z łuku, kto bliżej środka.',
];

export const DISCIPLINES = [
  {
    id: 'tenis',
    roman: 'I',
    name: 'Tenis',
    engine: 'bracket',
    format: 'Drabinka pucharowa',
    time: '~2 h',
    // Parametry silnika: co wpisujemy po meczu i do ilu się gra.
    params: { unit: 'punkty', target: 11, thirdPlace: true },
    rules: [
      'Drabinka pucharowa, rozstawienie losowane. Przy liczbie graczy innej niż potęga dwójki część osób zaczyna od rundy wstępnej, a reszta wchodzi wyżej.',
      'Cały mecz to jeden tie-break do 11 punktów. Przy stanie 10:10 gra się na dwa punkty przewagi.',
      'Serwis zmienia się co 2 punkty, a strony boiska po każdych 6 punktach.',
      'Przegrani półfinaliści grają mecz o 3. miejsce.',
      'Miejsca 1–4 ustalają finał i mecz o 3. miejsce. Pozostałych porównuje wynik meczu, w którym odpadli, niezależnie od losowej rundy startowej. Przy identycznym wyniku wyżej jest osoba, która przegrała z przeciwnikiem dochodzącym dalej.',
    ],
  },
  {
    id: 'pingpong',
    roman: 'II',
    name: 'Ping pong',
    engine: 'groups',
    format: 'Dwie grupy, potem puchar',
    time: '~1,5 h',
    params: { unit: 'punkty', target: 11 },
    rules: [
      'Dwie grupy (losowanie), w grupie każdy z każdym: jeden set do 11, serwis zmienia się co 2 punkty.',
      'Po dwie najlepsze osoby z grupy wychodzą do półfinałów na krzyż: pierwszy z grupy A gra z drugim z grupy B i odwrotnie.',
      'Półfinały, finał i mecz o 3. miejsce rozgrywamy do dwóch wygranych setów — wpisujemy wynik decydującego seta.',
      'W grupie kolejność ustala liczba zwycięstw, potem różnica małych punktów, potem punkty zdobyte.',
      'Jeśli startuje pięć osób albo mniej, grają jedną grupą każdy z każdym i to od razu ustala miejsca.',
    ],
  },
  {
    id: 'luk',
    roman: 'III',
    name: 'Łuk',
    engine: 'arrows',
    format: 'Trzy serie po trzy strzały',
    time: '~40 min',
    params: { series: 3, perSeries: 2, maxArrow: 10 },
    rules: [
      'Wszyscy strzelają z tej samej odległości i z tego samego łuku. Linię ustalamy raz, przed pierwszym strzałem.',
      'Mamy dwie strzały, więc seria to 2 strzały: podchodzisz, strzelasz dwa razy, idziesz po strzały i oddajesz łuk następnej osobie.',
      '2 strzały próbne (nieliczone), a potem 3 serie po 2 strzały — razem 6 strzałów liczonych.',
      'Kolejność strzelania jest losowana i widoczna na stronie. Strona pilnuje, kto strzela teraz i który to strzał w serii.',
      'Suma punktów z tarczy daje kolejność. Remis: wygrywa więcej dziesiątek, potem wyższy pojedynczy strzał, a na końcu jeden strzał barażowy.',
      'Nikt nie podchodzi do tarczy, dopóki łuk nie jest odłożony.',
    ],
  },
  {
    id: 'kosz',
    roman: 'IV',
    name: 'Kosz — „21”',
    engine: 'heats',
    format: 'Heaty, potem finał czwórki',
    time: '~45 min',
    // Zerowanie za pudło w powietrze zapisujemy jako osobny przycisk „0”.
    params: { heatTarget: 15, finalTarget: 21, values: [1, 2], unit: 'pkt', allowZero: true },
    rules: [
      'Eliminacje: heaty po 4 osoby (losowanie), gra do 15 punktów. Każdy sam za siebie.',
      'Rzut ze środka = 1 punkt. Rzut po zbiórce, z miejsca gdzie piłka wpadła w ręce = 2 punkty.',
      'Kto trafi za 2 punkty, przechodzi na środek i rzuca dalej, dopóki nie spudłuje.',
      'Nie ma wolnej piłki. Zbiera zawsze następna osoba w wylosowanej kolejności i z tego miejsca rzuca.',
      'Kto nie trafi ani w kosz, ani w tablicę, traci wszystkie swoje punkty i wraca do zera.',
      'Jeśli piłki dotknie ktoś, kto nie jest w tym momencie w kolejności, osoba która miała zbierać rzuca z miejsca dotknięcia albo z miejsca, w którym sama zebrała — jak jej wygodniej.',
      'Finał: po dwie najlepsze osoby z każdego heatu grają do 21 punktów. To rozstrzyga czołowe miejsca.',
      'Dalsze miejsca ustala liczba punktów zdobytych w heacie.',
    ],
  },
  {
    id: 'bule',
    roman: 'V',
    name: 'Bule',
    engine: 'heats',
    format: 'Heaty, potem finał czwórki',
    time: '~55 min',
    params: { heatTarget: 7, finalTarget: 5, values: [1, 2, 3], unit: 'pkt', order: true },
    rules: [
      'Heaty po 4 osoby (losowanie), każdy sam za siebie, gra do 7 punktów.',
      'Punkt zdobywa bula najbliższa cochonneta po wyrzuceniu wszystkich bul w rundzie. Za dwie i trzy bule bliżej niż wszystkie cudze liczymy odpowiednio 2 i 3 punkty.',
      'Wybijanie bul przeciwników jest jak najbardziej w porządku.',
      'Finał: po dwie najlepsze osoby z każdego heatu grają do 5 punktów.',
      'Dalsze miejsca ustala liczba punktów z heatu. Przy remisie jeden rzut na celność — kto bliżej cochonneta.',
    ],
  },
  {
    id: 'waterpolo',
    roman: 'VI',
    name: 'Water polo',
    engine: 'teams',
    format: 'Jeden mecz, dwie drużyny',
    time: '~40 min',
    params: { halves: 2, minutes: 8, goalCap: 6 },
    rules: [
      'Losujemy dwóch kapitanów. Wybierają wężykiem, w kolejności A – B – B – A – A – B, żeby pierwszy wybór nie dawał przewagi. Drużyny mogą się różnić najwyżej jedną osobą.',
      'Mecz: 2 × 8 minut czasu ciągłego albo do 6 goli — co nastąpi pierwsze. Przerwa między połowami maksymalnie 2 minuty.',
      'Gol liczy się tylko z rzutu z wody. Piłkę wolno chwytać. Topić nie wolno.',
      'Każdy gol zapisujemy z nazwiskiem strzelca, więc na stronie leci lista strzelców na bieżąco.',
      'Bramkarz może się rotować — wystarczy zapowiedzieć zmianę.',
    ],
    pointsNote:
      'Wygrana drużyna: 9 punktów dla każdego. Przegrana: 3 punkty. Remis: 6 punktów dla wszystkich. MVP meczu dodatkowo +2 punkty — głosują wszyscy, nie można zagłosować na siebie.',
  },
  {
    id: 'poker',
    roman: 'VII',
    name: 'Poker',
    engine: 'elimination',
    format: 'Turniej jednego stołu',
    time: '~2 h',
    params: {},
    rules: [
      'Texas Hold’em, jeden stół. Stack startowy 500 żetonów na osobę — tyle mamy.',
      'Wejście 10/20. Poziomy po 12 minut: 10/20 → 15/30 → 25/50 → 40/80 → 60/120 → 100/200, dalej podwajamy.',
      'Startujemy z 25 dużymi ciemnymi, więc poziomy są dłuższe niż zwykle — inaczej turniej rozstrzygnęłoby się losowo w pół godziny.',
      'Kto wypada, ten zajmuje najniższe wolne miejsce — strona pokazuje na bieżąco, o co gra się przy stole.',
      'Jeśli kończymy, zanim zostanie jedna osoba, wyklikujemy pozostałych w kolejności od najmniejszego stacka.',
      'Grywamy na koniec dnia — to jedyna dyscyplina, w której zmęczenie nie przeszkadza.',
    ],
  },
];

export const DISCIPLINE_IDS = DISCIPLINES.map((d) => d.id);

export function disciplineById(id) {
  return DISCIPLINES.find((d) => d.id === id) ?? null;
}

/**
 * Klasyfikacja generalna z gotowych miejsc w dyscyplinach.
 *
 * placements: { [disciplineId]: { places: number[], withdrawn: number[], teamPoints?: {playerIndex: pkt} } }
 *   places      — indeksy zawodników w kolejności od 1. miejsca; miejsca jeszcze nieustalone pomijamy
 *   withdrawn   — kto zrezygnował (0 punktów, bez miejsca)
 *   teamPoints  — dyscypliny drużynowe podają punkty wprost, bez miejsc
 */
export function computeStandings(placements) {
  const rows = PLAYERS.map((player, index) => ({
    index,
    player,
    points: {},     // { [disciplineId]: punkty }
    places: {},     // { [disciplineId]: miejsce }
    withdrew: {},   // { [disciplineId]: true }
    total: 0,
    firsts: 0,
    seconds: 0,
  }));

  for (const def of DISCIPLINES) {
    const result = placements[def.id];
    if (!result) continue;

    for (const playerIndex of result.withdrawn ?? []) {
      rows[playerIndex].withdrew[def.id] = true;
      rows[playerIndex].points[def.id] = 0;
    }

    if (result.teamPoints) {
      for (const [key, value] of Object.entries(result.teamPoints)) {
        rows[Number(key)].points[def.id] = value;
      }
      continue;
    }

    (result.places ?? []).forEach((playerIndex, slot) => {
      const row = rows[playerIndex];
      row.points[def.id] = SCALE[slot] ?? 0;
      row.places[def.id] = slot + 1;
      if (slot === 0) row.firsts += 1;
      if (slot === 1) row.seconds += 1;
    });
  }

  for (const row of rows) {
    row.total = Object.values(row.points).reduce((a, b) => a + b, 0);
  }

  rows.sort(
    (a, b) => b.total - a.total || b.firsts - a.firsts || b.seconds - a.seconds || a.index - b.index,
  );

  // Równe sumy i równe rozstrzygnięcia dzielą to samo miejsce.
  let rank = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const tied =
      prev && prev.total === row.total && prev.firsts === row.firsts && prev.seconds === row.seconds;
    if (!tied) rank = i + 1;
    row.rank = rank;
    row.tied = Boolean(tied);
  });

  return rows;
}
