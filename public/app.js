// Settebello — powłoka aplikacji: routing, klasyfikacja, zasady, strony dyscyplin.
// Stan przychodzi z serwera strumieniem SSE; przeglądarka nigdy nie liczy punktów sama.

import { setPlayers, el, flag, who, playerName, button, chip, statusChip, clockOf } from './dom.js';
import { renderBoard } from './views.js';

const TOKEN_KEY = 'settebello.token';

const app = {
  config: null,
  state: { disciplines: {}, standings: [], played: 0, started: 0, total: 7, updatedAt: 0, now: 0 },
  token: localStorage.getItem(TOKEN_KEY) ?? '',
  admin: false,
  route: { view: 'klasyfikacja', id: null },
  draft: {},        // roboczy skład dyscypliny, zanim sędzia go zapisze
  editing: {},      // które dyscypliny sędzia właśnie przestawia
  seenDraws: {},    // ostatnio zobaczone losowanie każdej dyscypliny
  history: [],
};

const $ = (id) => document.getElementById(id);
const allPlayers = () => app.config.players.map((_, i) => i);

// ── Komunikacja z serwerem ──────────────────────────────────────────────────

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(app.token ? { Authorization: `Bearer ${app.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Błąd ${response.status}`);
  return data;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const node = $('toast');
  node.textContent = message;
  node.dataset.kind = kind;
  node.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.dataset.show = 'false';
  }, 3400);
}

async function send(promise, okMessage) {
  try {
    await promise;
    if (okMessage) toast(okMessage);
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
}

const verb = (id, name, body) => api('POST', `/api/discipline/${id}/${name}`, body);
const dispatchFor = (id) => (action) => send(verb(id, 'action', { action }));

// ── Routing ─────────────────────────────────────────────────────────────────

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('d/')) {
    const id = raw.slice(2);
    if (app.config?.disciplines.some((d) => d.id === id)) return { view: 'discipline', id };
  }
  if (['dyscypliny', 'zasady', 'sedzia'].includes(raw)) return { view: raw, id: null };
  return { view: 'klasyfikacja', id: null };
}

function go(hash) {
  location.hash = hash;
}

// ── Klasyfikacja ────────────────────────────────────────────────────────────

/** Jedno zdanie o tym, co się właśnie dzieje w danej dyscyplinie. */
function liveSummary(outcome) {
  const b = outcome.board;
  switch (b.kind) {
    case 'setup':
      return 'Skład ustawiony, czeka na losowanie';
    case 'bracket': {
      const all = b.rounds.flatMap((r) => r.matches);
      return `Rozegrane ${all.filter((m) => m.sa !== null).length} z ${all.length} meczów`;
    }
    case 'groups': {
      const all = [...b.matches, ...b.playoff];
      return `Rozegrane ${all.filter((m) => m.sa !== null).length} z ${all.length} meczów`;
    }
    case 'arrows':
      return b.shooter === null
        ? 'Wszyscy wystrzelali'
        : `Na linii ${playerName(b.shooter)} — seria ${b.seriesIndex + 1} z ${b.series}`;
    case 'heats': {
      const stageName =
        b.stage === 'final' ? (b.straightFinal ? 'Gra' : 'Finał') : `Heat ${b.stage + 1}`;
      if (b.rotation && b.turn) {
        return `${stageName} — rzuca ${playerName(b.turn.player)} ${b.turn.fromLine ? 'z linii' : 'po zbiórce'}`;
      }
      const table = b.stage === 'final' ? b.finalTable : b.heatTables[b.stage];
      const lead = table?.[0];
      return lead
        ? `${stageName} — prowadzi ${playerName(lead.player)} ${lead.score}/${b.target}`
        : stageName;
    }
    case 'teams':
      return b.ready ? `Wynik ${b.scoreA} : ${b.scoreB}` : 'Kapitanowie wybierają składy';
    case 'elimination':
      return `Zostało ${b.remaining.length} z ${b.total} — gra się o ${b.nextPlace}. miejsce`;
    default:
      return null;
  }
}

/** Skrót na ekranie głównym: wejście prosto na planszę tego, co się właśnie toczy. */
function nowPlayingCard() {
  const open = app.config.disciplines.filter((def) => {
    const outcome = app.state.disciplines[def.id];
    return outcome && outcome.status !== 'done';
  });
  if (open.length === 0) return null;

  return el(
    'div',
    { class: 'now-playing' },
    el('p', { class: 'eyebrow', text: open.length > 1 ? 'Teraz w toku' : 'Teraz gramy' }),
    ...open.map((def) => {
      const outcome = app.state.disciplines[def.id];
      return el(
        'a',
        { class: 'now-playing__row', href: `#/d/${def.id}` },
        el('span', { class: 'now-playing__roman', text: def.roman }),
        el(
          'span',
          { class: 'now-playing__body' },
          el('span', { class: 'now-playing__name', text: def.name }),
          el('span', { class: 'hint', text: liveSummary(outcome) }),
        ),
        el('span', { class: 'now-playing__go', text: '→' }),
      );
    }),
  );
}

function standingsView() {
  const { standings, played, total } = app.state;
  const disciplines = app.config.disciplines;
  const anyPoints = standings.some((row) => row.total > 0);

  const head = el(
    'tr',
    {},
    el('th', { class: 'col-rank', text: '#' }),
    el('th', { class: 'col-who', text: 'Zawodnik' }),
    ...disciplines.map((def) => {
      const outcome = app.state.disciplines[def.id];
      return el(
        'th',
        {
          class: 'col-disc',
          title: `${def.name}${outcome ? ` — ${outcome.status === 'done' ? 'rozegrane' : 'w trakcie'}` : ''}`,
        },
        el('a', { class: 'col-disc__link', href: `#/d/${def.id}`, text: def.roman }),
        outcome && outcome.status !== 'done' && outcome.status !== 'setup'
          ? el('span', { class: 'col-disc__live', title: 'w trakcie' })
          : null,
      );
    }),
    el('th', { class: 'col-total', text: 'Σ' }),
  );

  const body = standings.map((row) =>
    el(
      'tr',
      { 'data-leader': String(row.rank === 1 && anyPoints) },
      el('td', {
        class: 'col-rank',
        text: !anyPoints ? '—' : row.tied ? `=${row.rank}` : String(row.rank),
      }),
      el('td', { class: 'col-who' }, who(row.index)),
      ...disciplines.map((def) => {
        const outcome = app.state.disciplines[def.id];
        if (row.withdrew[def.id]) {
          return el('td', { class: 'cell cell--out', text: '—', title: `${def.name}: rezygnacja` });
        }
        const points = row.points[def.id];
        if (points === undefined) {
          return el('td', { class: 'cell cell--empty', text: '·', title: `${def.name}: przed nami` });
        }
        const place = row.places[def.id];
        const provisional = outcome?.provisional ?? false;
        return el('td', {
          class: `cell${provisional ? ' cell--provisional' : ''}`,
          'data-place': place ? String(place) : null,
          text: String(points),
          title: `${def.name}: ${place ? `${place}. miejsce` : `${points} pkt`}${provisional ? ' (jeszcze się zmieni)' : ''}`,
        });
      }),
      el('td', { class: 'col-total num', text: String(row.total) }),
    ),
  );

  const podium =
    anyPoints
      ? el(
          'div',
          { class: 'podium' },
          ...standings.slice(0, 3).map((row) =>
            el(
              'div',
              { class: 'podium__card', 'data-place': String(row.rank) },
              el('div', { class: 'podium__rank', text: `${row.rank}.` }),
              el('div', { class: 'podium__row' }, flag(row.index, 'lg'), el('div', { class: 'podium__name', text: row.player.name })),
              el(
                'div',
                { class: 'podium__row' },
                el('span', { class: 'podium__total num', text: `${row.total} pkt` }),
                row.firsts > 0 ? el('span', { class: 'hint', text: `${row.firsts}× pierwsze miejsce` }) : null,
              ),
            ),
          ),
        )
      : el(
          'div',
          { class: 'empty' },
          el('strong', { text: 'Turniej się jeszcze nie zaczął' }),
          'Pierwsze punkty pojawią się tu w tej samej sekundzie, w której sędzia je zapisze.',
        );

  return el(
    'div',
    { class: 'stack' },
    nowPlayingCard(),
    podium,
    el(
      'div',
      {},
      sectionHead('Klasyfikacja generalna', `Rozegrane ${played} z ${total}`),
      el(
        'div',
        { class: 'table-scroll' },
        el('table', { class: 'standings' }, el('thead', {}, head), el('tbody', {}, ...body)),
      ),
      el('p', {
        class: 'hint',
        style: 'margin-top:.75rem',
        text: 'Złotą liczbą oznaczone jest pierwsze miejsce. Kursywą — punkty z dyscypliny, która jeszcze trwa, więc mogą się zmienić. Kreska to rezygnacja: zero punktów, bez wyrównywania.',
      }),
    ),
  );
}

function sectionHead(title, eyebrow) {
  return el(
    'div',
    { class: 'section-head' },
    el('h2', { text: title }),
    eyebrow ? el('p', { class: 'eyebrow', text: eyebrow }) : null,
  );
}

// ── Lista dyscyplin ─────────────────────────────────────────────────────────

function disciplineListView() {
  const cards = app.config.disciplines.map((def) => {
    const outcome = app.state.disciplines[def.id];
    const leader = outcome?.places?.[0];

    return el(
      'a',
      { class: 'disc-card', href: `#/d/${def.id}` },
      el('span', { class: 'disc-card__roman', text: def.roman }),
      el(
        'span',
        { class: 'disc-card__body' },
        el('span', { class: 'disc-card__name', text: def.name }),
        el('span', { class: 'disc-card__facts' }, chip(def.format), chip(def.time), statusChip(outcome?.status)),
        outcome && leader !== undefined
          ? el(
              'span',
              { class: 'disc-card__lead' },
              el('span', { class: 'hint', text: outcome.status === 'done' ? 'Wygrywa: ' : 'Prowadzi: ' }),
              who(leader),
            )
          : outcome?.withdrawn?.length
            ? el('span', { class: 'hint', text: `Nie gra: ${outcome.withdrawn.map(playerName).join(', ')}` })
            : null,
      ),
      el('span', { class: 'disc-card__go', text: '→' }),
    );
  });

  return el(
    'div',
    { class: 'stack' },
    el('div', {}, sectionHead('Siedem dyscyplin', 'Kliknij, żeby wejść na planszę'), el('div', { class: 'disc-list' }, ...cards)),
  );
}

// ── Strona jednej dyscypliny ────────────────────────────────────────────────

function disciplineView(id) {
  const def = app.config.disciplines.find((d) => d.id === id);
  const outcome = app.state.disciplines[id];
  const parts = [];

  parts.push(
    el(
      'div',
      { class: 'disc-head' },
      el('span', { class: 'disc-head__roman', text: def.roman }),
      el(
        'div',
        {},
        el('h2', { text: def.name }),
        el('div', { class: 'disc-head__facts' }, chip(def.format), chip(def.time), statusChip(outcome?.status)),
      ),
    ),
  );

  if (!outcome) {
    parts.push(
      el(
        'div',
        { class: 'empty' },
        el('strong', { text: 'Dyscyplina jeszcze nie otwarta' }),
        app.admin
          ? 'Ustaw poniżej, kto gra, i otwórz ją dla wszystkich.'
          : 'Sędzia jeszcze jej nie otworzył. Kiedy to zrobi, pojawi się tu na żywo.',
      ),
    );
    if (app.admin) parts.push(participantsPanel(def, null));
  } else if (outcome.phase === 'setup') {
    parts.push(setupPanel(def, outcome));
    if (app.admin) parts.push(participantsPanel(def, outcome));
  } else {
    parts.push(renderBoard(def, outcome, { admin: app.admin, dispatch: dispatchFor(id) }));
    parts.push(rankingPanel(def, outcome));
    if (app.admin) parts.push(adminTools(def, outcome));
  }

  parts.push(rulesPanel(def));
  return el('div', { class: 'stack' }, ...parts);
}

/** Faza przed losowaniem — widzą ją wszyscy, więc nikt nie podejrzewa ustawki. */
function setupPanel(def, outcome) {
  return el(
    'section',
    { class: 'panel panel--draw' },
    el('header', { class: 'panel__head' }, el('h3', { text: 'Czekamy na losowanie' })),
    el(
      'div',
      {},
      el('p', {
        class: 'lead',
        text: `Startuje ${outcome.participants.length} ${outcome.participants.length === 1 ? 'osoba' : 'osób'}. Rozstawienia nie zna jeszcze nikt — wylosuje je serwer, u wszystkich naraz.`,
      }),
      el('div', { class: 'flag-row' }, ...outcome.participants.map((i) => who(i))),
      outcome.withdrawn.length
        ? el(
            'p',
            { class: 'hint' },
            `Nie gra: ${outcome.withdrawn.map(playerName).join(', ')} — zero punktów z tej dyscypliny.`,
          )
        : null,
      app.admin
        ? el(
            'div',
            { class: 'actions' },
            button('Losuj', {
              onClick: () => send(verb(def.id, 'draw'), null),
            }),
            el('span', { class: 'hint', text: 'Losowanie odpali się na wszystkich telefonach w tej samej sekundzie.' }),
          )
        : null,
    ),
  );
}

function participantsPanel(def, outcome) {
  const key = def.id;
  if (!app.draft[key]) {
    app.draft[key] = new Set(outcome ? outcome.participants : allPlayers());
  }
  const chosen = app.draft[key];

  const rows = allPlayers().map((player) => {
    const playing = chosen.has(player);
    return el(
      'div',
      { class: 'pick-row', 'data-playing': String(playing) },
      who(player),
      el(
        'span',
        { class: 'segmented' },
        el('button', {
          type: 'button',
          'aria-pressed': String(playing),
          text: 'gra',
          onclick: () => {
            chosen.add(player);
            render();
          },
        }),
        el('button', {
          type: 'button',
          'aria-pressed': String(!playing),
          text: 'nie gra',
          onclick: () => {
            chosen.delete(player);
            render();
          },
        }),
      ),
    );
  });

  const participants = [...chosen].sort((a, b) => a - b);
  const tooFew = participants.length < 2;

  const save = async () => {
    const ok = outcome
      ? await send(verb(def.id, 'participants', { participants }), 'Skład zapisany. Teraz losowanie.')
      : await send(verb(def.id, 'start', { participants }), 'Dyscyplina otwarta. Teraz losowanie.');
    if (ok) {
      delete app.draft[key];
      delete app.editing[key];
    }
  };

  return el(
    'section',
    { class: 'panel' },
    el(
      'header',
      { class: 'panel__head' },
      el('h3', { text: outcome ? 'Skład' : 'Otwarcie dyscypliny' }),
      el('p', { class: 'panel__hint', text: 'Rezygnacja to zero punktów z tej dyscypliny — bez wyrównywania.' }),
    ),
    el(
      'div',
      {},
      el('div', { class: 'pick-list' }, ...rows),
      el(
        'div',
        { class: 'actions' },
        button(outcome ? 'Zapisz skład' : 'Otwórz dyscyplinę', { onClick: save, disabled: tooFew }),
        tooFew ? el('span', { class: 'hint hint--warn', text: 'Muszą startować co najmniej dwie osoby.' }) : null,
      ),
    ),
  );
}

/** Bieżąca kolejność w tej dyscyplinie i punkty, które z niej lecą. */
function rankingPanel(def, outcome) {
  if (outcome.board.kind === 'teams') {
    const points = outcome.teamPoints ?? {};
    const rows = Object.keys(points)
      .map(Number)
      .sort((a, b) => points[b] - points[a] || a - b);
    if (rows.length === 0) return el('span');
    return el(
      'section',
      { class: 'panel' },
      el(
        'header',
        { class: 'panel__head' },
        el('h3', { text: 'Punkty z tej dyscypliny' }),
        outcome.provisional ? el('p', { class: 'panel__hint', text: 'Mecz trwa — jeszcze się zmienią.' }) : null,
      ),
      el(
        'ol',
        { class: 'rank-list' },
        ...rows.map((player) =>
          el('li', { class: 'rank-list__item' }, who(player), el('span', { class: 'num rank-list__pts', text: `${points[player]} pkt` })),
        ),
        ...outcome.withdrawn.map((player) =>
          el('li', { class: 'rank-list__item', 'data-out': 'true' }, who(player, { muted: true }), el('span', { class: 'hint', text: 'rezygnacja' })),
        ),
      ),
    );
  }

  return el(
    'section',
    { class: 'panel' },
    el(
      'header',
      { class: 'panel__head' },
      el('h3', { text: outcome.status === 'done' ? 'Wynik dyscypliny' : 'Kolejność na tę chwilę' }),
      outcome.provisional
        ? el('p', { class: 'panel__hint', text: 'Rozgrywka trwa, więc kolejność jeszcze się przetasuje.' })
        : null,
    ),
    el(
      'ol',
      { class: 'rank-list' },
      ...outcome.places.map((player, slot) =>
        el(
          'li',
          { class: 'rank-list__item' },
          el('span', { class: 'num rank-list__place', text: `${slot + 1}.` }),
          who(player),
          el('span', { class: 'num rank-list__pts', text: `${app.config.scale[slot] ?? 0} pkt` }),
        ),
      ),
      ...outcome.withdrawn.map((player) =>
        el(
          'li',
          { class: 'rank-list__item', 'data-out': 'true' },
          el('span', { class: 'num rank-list__place', text: '—' }),
          who(player, { muted: true }),
          el('span', { class: 'hint', text: 'rezygnacja · 0 pkt' }),
        ),
      ),
    ),
  );
}

function adminTools(def, outcome) {
  const editing = Boolean(app.editing[def.id]);
  const canRedraw = ['ready', 'setup'].includes(outcome.status);

  return el(
    'section',
    { class: 'panel panel--admin' },
    el(
      'header',
      { class: 'panel__head' },
      el('h3', { text: 'Sędzia' }),
      el('p', { class: 'panel__hint', text: `Losowanie nr ${outcome.drawCount} o ${clockOf(outcome.drawnAt)}` }),
    ),
    el(
      'div',
      {},
      el(
        'div',
        { class: 'actions' },
        canRedraw
          ? button('Losuj ponownie', {
              kind: 'ghost',
              onClick: () => send(verb(def.id, 'draw'), 'Wylosowane od nowa.'),
            })
          : el('span', { class: 'hint', text: 'Rozgrywka się zaczęła, więc losowania nie da się już przekręcić.' }),
        button(editing ? 'Nie zmieniaj składu' : 'Zmień skład', {
          kind: 'ghost',
          onClick: () => {
            if (!editing && !confirm(`Zmiana składu wyrzuca wyniki dyscypliny „${def.name}” i każe losować od nowa. Na pewno?`)) return;
            app.editing[def.id] = !editing;
            delete app.draft[def.id];
            render();
          },
        }),
        button('Wyczyść dyscyplinę', {
          kind: 'danger',
          onClick: () => {
            if (!confirm(`Usunąć całą rozgrywkę dyscypliny „${def.name}”?`)) return;
            send(verb(def.id, 'clear'), `${def.name}: wyczyszczone.`);
          },
        }),
      ),
      editing ? participantsPanel(def, outcome) : null,
    ),
  );
}

function rulesPanel(def) {
  return el(
    'section',
    { class: 'panel' },
    el('header', { class: 'panel__head' }, el('h3', { text: 'Zasady' })),
    el(
      'div',
      {},
      el('ul', { class: 'rules' }, ...def.rules.map((rule) => el('li', { text: rule }))),
      def.pointsNote ? el('p', { class: 'note', text: def.pointsNote }) : null,
    ),
  );
}

// ── Zasady ──────────────────────────────────────────────────────────────────

function rulesView() {
  const scale = el(
    'div',
    { class: 'scale' },
    ...app.config.scale.map((points, i) =>
      el(
        'div',
        { class: 'scale__cell' },
        el('span', { class: 'scale__place', text: `${i + 1}. miejsce` }),
        el('span', { class: 'scale__pts num', text: String(points) }),
      ),
    ),
  );

  return el(
    'div',
    { class: 'stack' },
    el('div', {}, sectionHead('Punktacja', 'Ta sama skala w każdej dyscyplinie'), scale),
    el(
      'div',
      {},
      sectionHead('Zasady ogólne', 'Obowiązują wszędzie'),
      el('ul', { class: 'creed' }, ...app.config.generalRules.map((rule) => el('li', { text: rule }))),
    ),
    el(
      'div',
      {},
      sectionHead('Siedem dyscyplin', 'Łącznie około 8 godzin'),
      el(
        'div',
        { class: 'stack stack--tight' },
        ...app.config.disciplines.map((def) =>
          el(
            'article',
            { class: 'discipline' },
            el('div', { class: 'discipline__roman', text: def.roman }),
            el(
              'div',
              {},
              el(
                'div',
                { class: 'discipline__head' },
                el('h3', {}, el('a', { class: 'plain-link', href: `#/d/${def.id}`, text: def.name })),
              ),
              el('div', { class: 'discipline__facts' }, chip(def.format), chip(def.time), statusChip(app.state.disciplines[def.id]?.status)),
              el('ul', { class: 'rules' }, ...def.rules.map((rule) => el('li', { text: rule }))),
              def.pointsNote ? el('p', { class: 'note', text: def.pointsNote }) : null,
            ),
          ),
        ),
      ),
    ),
  );
}

// ── Sędzia ──────────────────────────────────────────────────────────────────

function judgeView() {
  if (!app.admin) return el('div', { class: 'stack' }, sectionHead('Wejście dla sędziego', 'PIN'), loginCard());

  const phrase = app.config.resetPhrase;
  const input = el('input', {
    type: 'text',
    class: 'text-input',
    'data-key': 'reset-phrase',
    placeholder: phrase,
    'aria-label': `Wpisz „${phrase}”, żeby potwierdzić`,
    oninput: () => {
      confirmButton.disabled = input.value.trim() !== phrase;
    },
  });

  const confirmButton = button('Wyczyść cały turniej', {
    kind: 'danger',
    disabled: true,
    onClick: async () => {
      const ok = await send(api('POST', '/api/reset', { confirm: input.value.trim() }), 'Turniej wyczyszczony.');
      if (ok) {
        input.value = '';
        confirmButton.disabled = true;
        app.draft = {};
        loadHistory();
      }
    },
  });

  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      {},
      sectionHead('Sędzia', 'Widzisz to tylko ty'),
      el(
        'section',
        { class: 'panel' },
        el('header', { class: 'panel__head' }, el('h3', { text: 'Jak prowadzić dyscyplinę' })),
        el(
          'ol',
          { class: 'steps' },
          el('li', { text: 'Wejdź na dyscyplinę i ustaw, kto gra, a kto rezygnuje.' }),
          el('li', { text: 'Otwórz ją — od tej chwili wszyscy widzą skład i czekają.' }),
          el('li', { text: 'Kliknij Losuj. Rozstawienie wylosuje serwer i animacja odpali się u wszystkich naraz.' }),
          el('li', { text: 'Zapisuj na bieżąco: wyniki meczów, strzały, kosze, gole. Klasyfikacja przelicza się sama.' }),
        ),
      ),
    ),
    el(
      'div',
      {},
      sectionHead('Historia zmian', 'Ostatnie 60 wpisów'),
      el(
        'ul',
        { class: 'history' },
        ...(app.history.length === 0
          ? [el('li', { text: 'Jeszcze nic się nie działo.' })]
          : app.history.map((entry) => {
              const def = app.config.disciplines.find((d) => d.id === entry.discipline);
              return el(
                'li',
                {},
                el('span', { text: clockOf(Number(entry.at)) }),
                el('span', { text: def ? def.name : 'cały turniej' }),
                el('span', { text: ACTION_LABEL[entry.action] ?? entry.action }),
              );
            })),
      ),
    ),
    el(
      'div',
      {},
      sectionHead('Wyczyszczenie turnieju', 'Nie da się tego cofnąć'),
      el(
        'section',
        { class: 'panel panel--danger' },
        el(
          'div',
          {},
          el('p', { class: 'lead', text: `Usuwa wszystkie dyscypliny i wszystkie punkty. Żeby potwierdzić, wpisz „${phrase}”.` }),
          el('div', { class: 'login' }, input, confirmButton),
        ),
      ),
    ),
  );
}

const ACTION_LABEL = {
  start: 'otwarcie dyscypliny',
  participants: 'zmiana składu',
  draw: 'losowanie',
  clear: 'wyczyszczenie dyscypliny',
  reset: 'reset turnieju',
  score: 'wynik meczu',
  arrow: 'strzał',
  undoArrow: 'cofnięty strzał',
  point: 'punkt',
  undo: 'cofnięty punkt',
  goal: 'gol',
  undoGoal: 'cofnięty gol',
  mvp: 'MVP',
  finish: 'koniec meczu',
  unfinish: 'wznowienie meczu',
  bust: 'wypadnięcie z pokera',
  undoBust: 'cofnięte wypadnięcie',
  teams: 'składy',
};

function loginCard() {
  const input = el('input', {
    type: 'password',
    class: 'text-input',
    placeholder: 'PIN sędziego',
    autocomplete: 'current-password',
  });

  const submit = async () => {
    try {
      const { token } = await api('POST', '/api/login', { pin: input.value });
      app.token = token;
      app.admin = true;
      localStorage.setItem(TOKEN_KEY, token);
      await loadHistory();
      toast('Jesteś sędzią. Możesz prowadzić rozgrywkę.');
      render();
    } catch (error) {
      toast(error.message, 'error');
      input.select();
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return el(
    'section',
    { class: 'panel' },
    el('header', { class: 'panel__head' }, el('h3', { text: 'PIN sędziego' })),
    el(
      'div',
      { class: 'login' },
      input,
      button('Wejdź', { onClick: submit }),
      el('p', {
        class: 'hint',
        text: 'PIN wypisuje się w terminalu przy starcie serwera. Zmienisz go, uruchamiając serwer ze SETTEBELLO_PIN=twoj-pin.',
      }),
    ),
  );
}

async function loadHistory() {
  if (!app.admin) return;
  try {
    const { entries } = await api('GET', '/api/history');
    app.history = entries;
  } catch {
    app.history = [];
  }
}

// ── Animacja losowania ──────────────────────────────────────────────────────

let drawing = false;

function playDraw(def, outcome) {
  if (drawing) return;
  drawing = true;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slot = el('div', { class: 'draw__slot' });
  const overlay = el(
    'div',
    { class: 'draw', 'data-show': 'true' },
    el(
      'div',
      { class: 'draw__card' },
      el('p', { class: 'draw__roman', text: def.roman }),
      el('p', { class: 'draw__label', text: 'Losowanie' }),
      el('h2', { class: 'draw__name', text: def.name }),
      slot,
      el('p', { class: 'draw__hint', text: drawSubject(def) }),
    ),
  );
  document.body.append(overlay);

  const pool = outcome.participants;
  const finish = () => {
    slot.replaceChildren(el('p', { class: 'draw__done', text: 'Wylosowane!' }));
    setTimeout(() => {
      overlay.dataset.show = 'false';
      setTimeout(() => {
        overlay.remove();
        drawing = false;
        render();
      }, 400);
    }, 900);
  };

  if (reduced) {
    slot.replaceChildren(el('div', { class: 'flag-row' }, ...pool.map((i) => flag(i, 'lg'))));
    finish();
    return;
  }

  let ticks = 0;
  const spin = setInterval(() => {
    const picks = Array.from({ length: 3 }, () => pool[Math.floor(Math.random() * pool.length)]);
    slot.replaceChildren(el('div', { class: 'draw__reel' }, ...picks.map((i) => flag(i, 'lg'))));
    ticks += 1;
    if (ticks > 20) {
      clearInterval(spin);
      finish();
    }
  }, 85);
}

const DRAW_SUBJECT = {
  bracket: 'Rozstawienie drabinki',
  groups: 'Podział na grupy',
  arrows: 'Kolejność strzelania',
  heats: 'Podział na heaty i kolejność',
  teams: 'Dwóch kapitanów',
  elimination: 'Miejsca przy stole',
};

function drawSubject(def) {
  return DRAW_SUBJECT[def.engine] ?? 'Rozstawienie';
}

/** Nowe losowanie poznajemy po zmianie znacznika; świeżość mierzymy zegarem serwera. */
function checkDraws(next) {
  for (const def of app.config.disciplines) {
    const outcome = next.disciplines[def.id];
    if (!outcome?.drawnAt) continue;
    const seen = app.seenDraws[def.id];
    const changed = seen !== undefined && seen !== outcome.drawnAt;
    const freshOnFirstSight = seen === undefined && next.now - outcome.drawnAt < 6000;
    app.seenDraws[def.id] = outcome.drawnAt;
    if (changed || freshOnFirstSight) {
      playDraw(def, outcome);
      if (app.route.view !== 'discipline' || app.route.id !== def.id) go(`#/d/${def.id}`);
      return;
    }
  }
}

// ── Rysowanie ───────────────────────────────────────────────────────────────

function captureFocus() {
  const node = document.activeElement;
  if (!node?.dataset?.key) return null;
  return {
    key: node.dataset.key,
    value: node.value,
    start: node.selectionStart,
    end: node.selectionEnd,
  };
}

function restoreFocus(snapshot) {
  if (!snapshot) return;
  const node = document.querySelector(`[data-key="${snapshot.key}"]`);
  if (!node) return;
  node.value = snapshot.value;
  node.focus();
  try {
    node.setSelectionRange(snapshot.start, snapshot.end);
  } catch {
    /* pola number nie zawsze wspierają zaznaczanie */
  }
}

const VIEWS = {
  klasyfikacja: standingsView,
  dyscypliny: disciplineListView,
  zasady: rulesView,
  sedzia: judgeView,
  discipline: () => disciplineView(app.route.id),
};

function render() {
  const snapshot = captureFocus();
  app.route = parseRoute();

  for (const tab of document.querySelectorAll('.tab')) {
    const active =
      tab.dataset.view === app.route.view ||
      (tab.dataset.view === 'dyscypliny' && app.route.view === 'discipline');
    tab.setAttribute('aria-selected', String(active));
  }

  $('progress-label').textContent = `Rozegrane ${app.state.played} z ${app.state.total}`;
  $('admin-flag').hidden = !app.admin;

  $('main-slot').replaceChildren(el('div', { class: 'wrap' }, VIEWS[app.route.view]()));
  restoreFocus(snapshot);
}

function applyState(next) {
  const previous = app.state;
  app.state = next;
  if (previous.now !== 0) checkDraws(next);
  else for (const def of app.config.disciplines) {
    const outcome = next.disciplines[def.id];
    if (outcome?.drawnAt) app.seenDraws[def.id] = outcome.drawnAt;
  }
  if (!drawing) render();
}

function openStream() {
  const pill = $('live-pill');
  const source = new EventSource('/api/stream');

  const alive = () => {
    pill.dataset.live = 'on';
    $('live-label').textContent = 'na żywo';
  };

  source.addEventListener('open', alive);
  source.addEventListener('state', (event) => {
    alive();
    applyState(JSON.parse(event.data));
  });
  source.addEventListener('error', () => {
    pill.dataset.live = 'off';
    $('live-label').textContent = 'wznawiam…';
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

async function boot() {
  $('foot-year').textContent = String(new Date().getFullYear());

  app.config = await api('GET', '/api/config');
  setPlayers(app.config.players);

  $('drappellone').replaceChildren(
    ...app.config.players.map((p) => el('span', { style: `background:${p.c1}`, title: p.name })),
  );

  if (app.token) {
    const { admin } = await api('GET', '/api/session');
    app.admin = admin;
    if (!admin) {
      app.token = '';
      localStorage.removeItem(TOKEN_KEY);
    } else {
      await loadHistory();
    }
  }

  // Pierwszy stan bierzemy prosto, żeby strona nie mrugała pustką.
  const first = await api('GET', '/api/state');
  app.state = first;
  for (const def of app.config.disciplines) {
    const outcome = first.disciplines[def.id];
    if (outcome?.drawnAt) app.seenDraws[def.id] = outcome.drawnAt;
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => go(`#/${tab.dataset.view === 'klasyfikacja' ? '' : tab.dataset.view}`));
  }
  window.addEventListener('hashchange', render);

  render();
  openStream();
}

boot().catch((error) => {
  $('main-slot').replaceChildren(
    el(
      'div',
      { class: 'wrap' },
      el('p', { class: 'empty' }, el('strong', { text: 'Nie udało się połączyć z serwerem' }), error.message),
    ),
  );
});
